<#
.SYNOPSIS
  One command to go live: checks the key (0 units), runs the tests, starts Proof in LIVE mode,
  opens http://localhost:3000 and prints what to do in the app. Ctrl+C stops the server.
  Live scan scores (no photos) are logged to noise-study\live-scans.jsonl for the noise study.
.EXAMPLE
  .\golive.ps1
.EXAMPLE
  .\golive.ps1 -DryRun     # whole flow against the mock: no network, no units, no browser
#>
param(
  [switch]$DryRun,
  [switch]$SkipTests,
  [switch]$NoBrowser,
  [int]$Port = 0
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($Port -eq 0) { $Port = if ($DryRun) { 3999 } else { 3000 } }
$base = "http://127.0.0.1:$Port"

function Fail([string]$msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
function Step([string]$msg) { Write-Host ""; Write-Host "== $msg" -ForegroundColor Cyan }
function Get-Json([string]$url) {
  try { return Invoke-RestMethod -Uri $url -TimeoutSec 2 } catch { return $null }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js is not installed. Get the LTS from https://nodejs.org, then rerun.' }

Step '1/4 Key check (free, 0 units)'
if ($DryRun) {
  & node scripts/check-key.js --mock
} else {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.env'))) { Fail 'No .env yet. Run:  .\setkey.ps1 YOUR_KEY' }
  & node scripts/check-key.js
}
if ($LASTEXITCODE -ne 0) { Fail 'Key check failed (see above). Nothing was started, no units used.' }

Step '2/4 Tests'
if ($SkipTests) { Write-Host 'Skipped (-SkipTests).' } else {
  $ErrorActionPreference = 'Continue'   # npm writes to stderr on failure; read the exit code instead
  & npm.cmd test --silent *> "$env:TEMP\proof-golive-test.log"
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  $summary = Select-String -Path "$env:TEMP\proof-golive-test.log" -Pattern '^# (pass|fail) ' | ForEach-Object { $_.Line }
  Write-Host ($summary -join '  ')
  if ($code -ne 0) { Fail "Tests failed. Full log: $env:TEMP\proof-golive-test.log" }
}

Step "3/4 Server on port $Port"
$already = Get-Json "$base/api/config"
if ($already) { Fail "Port $Port is busy (a Proof server in $($already.mode) mode is already running). Close that window or press Ctrl+C there, then rerun. Or: .\golive.ps1 -Port 3001" }
if ($DryRun) { $env:PROOF_MODE = 'mock' } else { Remove-Item Env:PROOF_MODE -ErrorAction SilentlyContinue; $env:SCAN_LOG = '1' }
$env:PORT = "$Port"
$node = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server/index.js' -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
try {
  $cfg = $null
  for ($i = 0; $i -lt 40 -and -not $cfg; $i++) {
    if ($node.HasExited) { Fail "The server stopped right away (exit $($node.ExitCode)). See the lines above." }
    Start-Sleep -Milliseconds 250
    $cfg = Get-Json "$base/api/config"
  }
  if (-not $cfg) { Fail 'The server did not answer within 10 seconds.' }
  $want = if ($DryRun) { 'mock' } else { 'live' }
  if ($cfg.mode -ne $want) { Fail "Server came up in $($cfg.mode) mode, expected $want. Check YOUCAM_API_KEY in .env and that PROOF_MODE is not set." }
  Write-Host "Running in $($cfg.mode.ToUpper()) mode: $($cfg.unitsPerScan) units per photo, $($cfg.concerns.Count) concerns."

  Step '4/4 Open the app'
  $url = "http://localhost:$Port"
  if ($DryRun -or $NoBrowser) { Write-Host "Not opening a browser. URL: $url" } else { Start-Process $url }
  Write-Host ''
  Write-Host 'Do this in the app:' -ForegroundColor Green
  Write-Host '  1. Click "Start a 28-day trial", name the product, pick up to 3 claims, keep "Live YouCam" selected, click "Start calibration".'
  Write-Host '  2. Take all 3 calibration selfies (14 units each). Leave the frame and sit back down between shots. Scores should show after each.'
  Write-Host '  3. That is it for today. Press Ctrl+C here to stop. Any error box: paste its text and this window to Claude.'
  if (-not $DryRun) { Write-Host '  (Scores are logged to noise-study\live-scans.jsonl for the noise study. No photos are saved.)' -ForegroundColor DarkGray }

  if ($DryRun) {
    Write-Host ''
    Write-Host 'DRY RUN OK: key check, tests, server start and mode check all passed. Stopping the server.' -ForegroundColor Green
  } else {
    Wait-Process -Id $node.Id
  }
} finally {
  if (-not $node.HasExited) { Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:SCAN_LOG, Env:PORT -ErrorAction SilentlyContinue
  if ($DryRun) { Remove-Item Env:PROOF_MODE -ErrorAction SilentlyContinue }
}
