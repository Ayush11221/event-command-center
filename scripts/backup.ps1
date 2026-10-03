param([string]$Project = 'slice12-demo', [string]$OutputDirectory = '.artifacts/backups')
$ErrorActionPreference = 'Stop'
$workspace = (Get-Location).Path
$target = [System.IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
if (-not $target.StartsWith($workspace + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Backup output must remain in this workspace' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
if ($IsWindows -or $env:OS -eq 'Windows_NT') {
  & icacls $target /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict backup ACL' }
} else {
  & chmod 700 -- $target
  if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict backup permissions' }
}
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$name = "eoc-$stamp.dump"
$started = (Get-Date).ToUniversalTime()
& docker compose -p $Project exec -T postgres pg_dump -U eoc_migrator -d eoc_demo -Fc -f "/tmp/$name"
if ($LASTEXITCODE -ne 0) { throw 'Backup failed' }
try {
  & docker compose -p $Project cp "postgres:/tmp/$name" (Join-Path $target $name)
  if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed' }
} finally { & docker compose -p $Project exec -T postgres rm -f "/tmp/$name" | Out-Null }
$metadata = @{ backup_started_at=$started.ToString('o'); completed_at=(Get-Date).ToUniversalTime().ToString('o'); sha256=(Get-FileHash -LiteralPath (Join-Path $target $name)).Hash; format='PostgreSQL custom archive'; project=$Project }
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target "$name.json")
Write-Output (Join-Path $target $name)
