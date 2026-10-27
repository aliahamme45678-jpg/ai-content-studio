$ErrorActionPreference='Continue'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$node=Join-Path $root '.runtime\node-v24.22.1-win-x64\node.exe'
$pg=Join-Path $root '.runtime\postgresql-17.4\pgsql\bin\pg_isready.exe'
Write-Output 'AI Content Studio local dependency check'
Write-Output "Node: $(& $node --version 2>$null)"
Write-Output "PostgreSQL: $(& $pg -h 127.0.0.1 -p 5432 2>$null)"
foreach($name in @('AIHOT','Studio')){
  $url=if($name -eq 'AIHOT'){'http://127.0.0.1:3001/api/health'}else{'http://127.0.0.1:4310/api/studio/runtime/status'}
  try{$null=Invoke-RestMethod $url -TimeoutSec 5;Write-Output "${name}: OK"}catch{Write-Output "${name}: unavailable ($($_.Exception.Message))"}
}
try{$h=Invoke-RestMethod 'http://127.0.0.1:4310/api/studio/integrations/hermes/status';Write-Output "Hermes: $($h.mode)"}catch{Write-Output 'Hermes: unavailable'}
Write-Output 'Safety: automatic publishing disabled; Feishu write disabled; unknown receipts are not auto-retried.'
