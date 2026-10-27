$ErrorActionPreference = 'Continue'
$ports = 3000, 3001, 3002, 4310
foreach ($port in $ports) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pg = Join-Path $root '.runtime\postgresql-17.4\pgsql\bin\pg_ctl.exe'
$data = Join-Path $root 'app\.runtime-data\postgres'
if (Test-Path $pg) { & $pg -D $data stop -m fast 2>$null | Out-Null }
Write-Output 'Local AIHOT, Studio, and PostgreSQL processes stopped.'
