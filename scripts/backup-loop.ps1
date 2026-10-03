param([string]$Project = 'slice12-demo')
$ErrorActionPreference = 'Stop'
while ($true) {
  & "$PSScriptRoot/backup.ps1" -Project $Project
  if (-not $?) { throw 'Backup failed; investigate immediately; RPO evidence invalid' }
  Start-Sleep -Seconds 600
}
