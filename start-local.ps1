param([switch]$WithWorker,[switch]$StudioOnly)

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
$hermesEnv = Join-Path $root 'app\.runtime-data\hermes.env'
if (Test-Path $hermesEnv) {
  foreach ($line in Get-Content $hermesEnv) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
  }
}

if (!$StudioOnly) {
if (!(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath (Join-Path $pgDir 'pg_ctl.exe') -ArgumentList @('-D', $pgData, '-l', $pgLog, 'start') -WorkingDirectory $root -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2
}
$studioPgReady = $false
for ($studioPgAttempt = 0; $studioPgAttempt -lt 30; $studioPgAttempt++) {
  & (Join-Path $pgDir 'pg_isready.exe') -h 127.0.0.1 -p 5432 | Out-Null
  if ($LASTEXITCODE -eq 0) { $studioPgReady = $true; break }
  Start-Sleep -Seconds 1
}
if (!$studioPgReady) { throw 'Local PostgreSQL did not become ready within 30 seconds. Check app/logs/postgres.log.' }

if (!(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath (Join-Path $nodeDir 'node.exe') -ArgumentList 'apps/api/src/main.ts' -WorkingDirectory $aihotDir -RedirectStandardOutput (Join-Path $logsDir 'aihot-api.log') -RedirectStandardError (Join-Path $logsDir 'aihot-api-error.log') -WindowStyle Hidden | Out-Null
}
if (!(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath (Join-Path $nodeDir 'node.exe') -ArgumentList 'apps/web/server.ts' -WorkingDirectory $aihotDir -RedirectStandardOutput (Join-Path $logsDir 'aihot-web.log') -RedirectStandardError (Join-Path $logsDir 'aihot-web-error.log') -WindowStyle Hidden | Out-Null
}
if ($WithWorker -and !(Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath (Join-Path $nodeDir 'node.exe') -ArgumentList 'apps/worker/src/main.ts' -WorkingDirectory $aihotDir -RedirectStandardOutput (Join-Path $logsDir 'aihot-worker.log') -RedirectStandardError (Join-Path $logsDir 'aihot-worker-error.log') -WindowStyle Hidden | Out-Null
}
}
# Model services follow the user's existing Windows proxy. Node fetch otherwise
# bypasses it and can time out even when the provider works in the browser.
$studioProxyArgs = @()
$studioSystemProxy = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -Name ProxyEnable,ProxyServer -ErrorAction SilentlyContinue
if ($studioSystemProxy.ProxyEnable -eq 1 -and $studioSystemProxy.ProxyServer) {
  $studioProxyEntries = @{}
  foreach ($studioProxyPart in ([string]$studioSystemProxy.ProxyServer).Split(';')) {
    $studioProxyPair = $studioProxyPart.Split('=',2)
    if ($studioProxyPair.Count -eq 2) { $studioProxyEntries[$studioProxyPair[0].Trim()] = $studioProxyPair[1].Trim() }
    else { $studioProxyEntries['default'] = $studioProxyPart.Trim() }
  }
  foreach ($studioProxyProtocol in @('http','https')) {
    $studioProxyAddress = $studioProxyEntries[$studioProxyProtocol]
    if (!$studioProxyAddress) { $studioProxyAddress = $studioProxyEntries['default'] }
    if ($studioProxyAddress) {
      if ($studioProxyAddress -notmatch '^[a-z]+://') { $studioProxyAddress = 'http://' + $studioProxyAddress }
      [Environment]::SetEnvironmentVariable(($studioProxyProtocol.ToUpper() + '_PROXY'), $studioProxyAddress, 'Process')
    }
  }
  $env:NO_PROXY = ((@($env:NO_PROXY -split ',' | Where-Object { $_ }) + @('localhost','127.0.0.1','::1')) | Select-Object -Unique) -join ','
  $studioProxyArgs = @('--use-env-proxy')
}
# Keep public RSS collection running without launching paid editorial processing.
if (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue) {
  $intelCollector = Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'run-intelligence-collector.mjs|worker/src/main.ts' }
  if (!$intelCollector) { Start-Process -FilePath (Join-Path $nodeDir 'node.exe') -ArgumentList ($studioProxyArgs + @('src/run-intelligence-collector.mjs')) -WorkingDirectory $appDir -RedirectStandardOutput (Join-Path $logsDir 'intelligence-collector.log') -RedirectStandardError (Join-Path $logsDir 'intelligence-collector-error.log') -WindowStyle Hidden | Out-Null }
}
# Hermes is a local engine behind Studio; starting it does not submit model requests.
if ($env:LLM_API_KEY -and $env:LLM_BASE_URL -and !(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) {
  $env:HERMES_API_URL = $env:LLM_BASE_URL.TrimEnd('/') + '/chat/completions'
  $env:HERMES_API_KEY = $env:LLM_API_KEY
  $env:HERMES_MODEL = $env:LLM_MODEL
  $hermesMemory = Join-Path $appDir 'data\hermes-memory'
  $hermesMaterials = Join-Path $appDir 'data\hermes-materials.txt'
  New-Item -ItemType Directory -Force $hermesMemory | Out-Null
  if (!(Test-Path -LiteralPath $hermesMaterials)) { Set-Content -LiteralPath $hermesMaterials -Value '' -Encoding utf8 }
  $env:MEMORY_ROOT = $hermesMemory
  $env:MATERIAL_PATH = $hermesMaterials
  Start-Process -FilePath (Join-Path $nodeDir 'node.exe') -ArgumentList ($studioProxyArgs + @('src/run-hermes.mjs')) -WorkingDirectory $appDir -RedirectStandardOutput (Join-Path $logsDir 'hermes.log') -RedirectStandardError (Join-Path $logsDir 'hermes-error.log') -WindowStyle Hidden | Out-Null
}
if ($env:LLM_API_KEY -and $env:LLM_BASE_URL) { $env:HERMES_SERVICE_URL = 'http://127.0.0.1:8787' }

# Pin collection and ASR to the validated interpreter, independent of the service PATH.
if (!$env:STUDIO_PYTHON) { $env:STUDIO_PYTHON = (& python -c 'import sys; print(sys.executable)').Trim() }
& $env:STUDIO_PYTHON -c 'import requests, playwright' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Collection Python requires requests and playwright. Install them into STUDIO_PYTHON before starting.' }

if (!(Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue)) {
  $env:PORT = '4310'
  $env:HOST = '127.0.0.1'
  Start-Process -FilePath (Join-Path $nodeDir 'node.exe') -ArgumentList ($studioProxyArgs + @('src/server.mjs')) -WorkingDirectory $appDir -RedirectStandardOutput (Join-Path $logsDir 'studio.log') -RedirectStandardError (Join-Path $logsDir 'studio-error.log') -WindowStyle Hidden | Out-Null
}

Start-Sleep -Seconds 2
Write-Output 'Local services:'
if (!$StudioOnly) { Write-Output '  AIHOT       http://127.0.0.1:3000' }
Write-Output '  Studio      http://127.0.0.1:4310'
Write-Output '  Hermes      http://127.0.0.1:8787 (local engine, operated through Studio)'
if (!$StudioOnly) { Write-Output '  PostgreSQL  127.0.0.1:5432' }
if (!$WithWorker) { Write-Output '  Worker      not started by this command (use -WithWorker when collection/model processing is enabled)' }
