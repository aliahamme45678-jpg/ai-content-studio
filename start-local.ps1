param([switch]$WithWorker)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeDir = Join-Path $root '.runtime\node-v24.22.1-win-x64'
$pgDir = Join-Path $root '.runtime\postgresql-17.4\pgsql\bin'
$aihotDir = Join-Path $root 'opensource\AIHOT'
$appDir = Join-Path $root 'app'
$logsDir = Join-Path $appDir 'logs'
$pgData = Join-Path $appDir '.runtime-data\postgres'
$pgLog = Join-Path $logsDir 'postgres.log'

New-Item -ItemType Directory -Force $logsDir | Out-Null
$env:PATH = "$nodeDir;$pgDir;$env:PATH"

$envFile = Join-Path $aihotDir '.env'
if (!(Test-Path $envFile)) { throw "AIHOT .env is missing: $envFile" }
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
$localModelEnv = Join-Path $root 'app\.runtime-data\local-model.env'
if (Test-Path $localModelEnv) {
  foreach ($line in Get-Content $localModelEnv) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
  }
}

$env:NODE_ENV = 'development'
$env:API_HOST = '127.0.0.1'
$env:API_PORT = '3001'
$env:WEB_HOST = '127.0.0.1'
$env:WEB_PORT = '3000'
$env:DEV_AUTH_ROLE = 'admin'
$env:DEV_AUTH_DISPLAY_NAME = 'Local Admin'
$env:AIHOT_BASE_URL = 'http://127.0.0.1:3000'
$env:AIHOT_DATABASE_URL = $env:DATABASE_URL

if (!(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath (Join-Path $pgDir 'pg_ctl.exe') -ArgumentList @('-D', $pgData, '-l', $pgLog, 'start') -WorkingDirectory $root -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2
}
& (Join-Path $pgDir 'pg_isready.exe') -h 127.0.0.1 -p 5432 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL did not become ready.' }

if (!(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath (Join-Path $nodeDir 'node.exe') -ArgumentList 'apps/api/src/main.ts' -WorkingDirectory $aihotDir -RedirectStandardOutput (Join-Path $logsDir 'aihot-api.log') -RedirectStandardError (Join-Path $logsDir 'aihot-api-error.log') -WindowStyle Hidden | Out-Null
}
if (!(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath (Join-Path $nodeDir 'node.exe') -ArgumentList 'apps/web/server.ts' -WorkingDirectory $aihotDir -RedirectStandardOutput (Join-Path $logsDir 'aihot-web.log') -RedirectStandardError (Join-Path $logsDir 'aihot-web-error.log') -WindowStyle Hidden | Out-Null
}
if ($WithWorker -and !(Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath (Join-Path $nodeDir 'node.exe') -ArgumentList 'apps/worker/src/main.ts' -WorkingDirectory $aihotDir -RedirectStandardOutput (Join-Path $logsDir 'aihot-worker.log') -RedirectStandardError (Join-Path $logsDir 'aihot-worker-error.log') -WindowStyle Hidden | Out-Null
}
if (!(Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue)) {
  $env:PORT = '4310'
  $env:HOST = '127.0.0.1'
  Start-Process -FilePath (Join-Path $nodeDir 'node.exe') -ArgumentList 'src/server.mjs' -WorkingDirectory $appDir -RedirectStandardOutput (Join-Path $logsDir 'studio.log') -RedirectStandardError (Join-Path $logsDir 'studio-error.log') -WindowStyle Hidden | Out-Null
}

Start-Sleep -Seconds 2
Write-Output 'Local services:'
Write-Output '  AIHOT       http://127.0.0.1:3000'
Write-Output '  Studio      http://127.0.0.1:4310'
Write-Output '  PostgreSQL  127.0.0.1:5432'
if (!$WithWorker) { Write-Output '  Worker      stopped (start with -WithWorker when collection/model processing is explicitly enabled)' }
