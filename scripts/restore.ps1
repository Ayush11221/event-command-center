param([Parameter(Mandatory=$true)][string]$Backup, [string]$Project = 'slice12-demo', [string]$Database = 'eoc_restore_test')
$ErrorActionPreference = 'Stop'
# Never restore over a running product database or resume SMTP automatically.
if ($Database -notmatch '^eoc_restore_[a-z0-9_]+$') { throw 'Only isolated eoc_restore_* targets are permitted' }
$file = (Resolve-Path -LiteralPath $Backup).Path
$hash = Get-FileHash -LiteralPath $file
$metadata = Get-Content -LiteralPath "$file.json" | ConvertFrom-Json
if ($metadata.sha256 -ne $hash.Hash) { throw 'Backup checksum mismatch' }
$started = (Get-Date).ToUniversalTime()
& docker compose -p $Project exec -T postgres createdb -U eoc_migrator $Database
if ($LASTEXITCODE -ne 0) { throw 'Restore target must be a new isolated database' }
try {
  & docker compose -p $Project cp $file 'postgres:/tmp/restore.dump'
  if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed' }
  & docker compose -p $Project exec -T postgres pg_restore -U eoc_migrator -d $Database --exit-on-error --single-transaction /tmp/restore.dump
  if ($LASTEXITCODE -ne 0) { throw 'Restore failed' }
} finally { & docker compose -p $Project exec -T postgres rm -f /tmp/restore.dump | Out-Null }
@{ database=$Database; restore_seconds=((Get-Date).ToUniversalTime()-$started).TotalSeconds; backup_age_seconds=($started-[DateTimeOffset]::Parse($metadata.backup_started_at).UtcDateTime).TotalSeconds; workers_started=$false; external_effects='UNRECONCILED; do not point the API at this database' } | ConvertTo-Json
