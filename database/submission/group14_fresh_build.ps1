$ErrorActionPreference = 'Stop'

$targetName = 'group14_blood_donation_demo_20261030'
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$setupUser = Read-Host 'Local MySQL setup user'
if ([string]::IsNullOrWhiteSpace($setupUser)) { throw 'A local setup user is required.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$relativeFiles = @(
  'database/submission/group14_create_schema.sql'
  'database/migrations/001_foundation.sql'
  'database/migrations/002_auth.sql'
  'database/seeds/reference_data.sql'
  'database/migrations/003_donors.sql'
  'database/migrations/004_hospitals.sql'
  'database/migrations/005_eligibility_booking.sql'
  'database/migrations/006_donations.sql'
  'database/migrations/007_inventory.sql'
  'database/migrations/008_blood_requests.sql'
  'database/migrations/009_compatibility_allocation.sql'
  'database/migrations/010_audit.sql'
  'database/migrations/012_request_status_history.sql'
  'database/infrastructure/auth_sessions.sql'
  'database/views/available_inventory.sql'
  'database/routines/inventory_summary_by_group.v1.sql'
  'database/submission/group14_demo_data.sql'
)

# Read and validate every required file before starting the MySQL client.
$sqlParts = [System.Collections.Generic.List[string]]::new()
foreach ($relativeFile in $relativeFiles) {
  $fullPath = Join-Path $repoRoot $relativeFile
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Required SQL file is missing: $relativeFile"
  }
  $sqlText = Get-Content -LiteralPath $fullPath -Raw -Encoding UTF8 -ErrorAction Stop
  if ([string]::IsNullOrWhiteSpace($sqlText)) {
    throw "Required SQL file is empty: $relativeFile"
  }
  $sqlParts.Add($sqlText)
}

$batch = $sqlParts -join [Environment]::NewLine
Write-Host "Creating only the new local schema $targetName. MySQL will prompt for the setup password."
Write-Host 'The script does not use backend/.env and does not change application configuration.'
$batch | & $mysqlExe --host=127.0.0.1 --port=3306 --user=$setupUser --password --default-character-set=utf8mb4 --batch --skip-force
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) {
  throw "Fresh database build failed with client exit code $mysqlExitCode. Do not rerun or drop objects; inspect only the named demo schema and select a new name for any reviewed retry."
}

Write-Host "Fresh Group 14 database created and populated: $targetName"
Write-Host 'This reports successful batch execution only; run the read-only verification queries separately.'
