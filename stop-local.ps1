$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $root '.runtime\node-v24.22.1-win-x64\node.exe'
$ports = 3000, 3001, 3002, 4310, 8787
foreach ($port in $ports) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $_" -ErrorAction SilentlyContinue
      if ($process.ExecutablePath -eq $node -and $process.CommandLine -match 'server.mjs|run-hermes.mjs|apps/api/src/main.ts|apps/web/server.ts|apps/worker/src/main.ts') { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    }
}
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pg = Join-Path $root '.runtime\postgresql-17.4\pgsql\bin\pg_ctl.exe'
$data = Join-Path $root 'app\.runtime-data\postgres'
if (Test-Path $pg) { & $pg -D $data stop -m fast 2>$null | Out-Null }
Write-Output 'Local AIHOT, Studio, Hermes, and PostgreSQL processes stopped.'
