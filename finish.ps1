<#
.SYNOPSIS
  Fills the link placeholders (README.md, SUBMISSION\devpost.md, SUBMISSION\video_script.md),
  commits and pushes. Pass only what you have; safe to re-run (filled ones are skipped).
.EXAMPLE
  .\finish.ps1 -Live https://proof-skin-trials.onrender.com -Code judge26
.EXAMPLE
  .\finish.ps1 -Video https://youtu.be/XXXX
.EXAMPLE
  .\finish.ps1 -Live https://x.onrender.com -Video https://youtu.be/X -Code c -DryRun   # show, change nothing
#>
param(
  [string]$Live,
  [string]$Video,
  [string]$Code,
  [string]$Repo,
  [switch]$NoPush,
  [switch]$DryRun
)
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
function Fail([string]$msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not ($Live -or $Video -or $Code)) { Fail 'Pass at least one of -Live, -Video, -Code.' }
foreach ($u in @($Live, $Video)) { if ($u -and $u -notmatch '^https://\S+$') { Fail "Not an https link: $u" } }
$Live = if ($Live) { $Live.TrimEnd('/') } else { $null }
if (-not $Repo) {
  $o = git remote get-url origin 2>$null
  $Repo = if ($LASTEXITCODE -eq 0 -and $o) { ($o.Trim() -replace '\.git$', '') } else { 'https://github.com/UnknownHacker1/proof' }
}

# file -> list of (placeholder, value)
$plan = [ordered]@{
  'README.md' = @(
    @('`LIVE_DEMO_URL` (placeholder, see `SUBMISSION/MORNING_STEPS.md`)', $Live),
    @('`VIDEO_URL` (placeholder)', $Video),
    @('git clone <repo-url> proof', $(if ($Repo) { "git clone $Repo.git proof" }))
  )
  'SUBMISSION\devpost.md' = @(
    @('[[LIVE_DEMO_URL]]', $Live), @('[[VIDEO_URL]]', $Video), @('[[REPO_URL]]', $Repo), @('[[LIVE_ACCESS_CODE]]', $Code)
  )
  'SUBMISSION\video_script.md' = @(, @('[[LIVE_DEMO_URL]]', $Live))
}

$changed = @()
foreach ($file in $plan.Keys) {
  $path = Join-Path $PSScriptRoot $file
  if (-not (Test-Path -LiteralPath $path)) { Write-Host "skip (missing): $file"; continue }
  $text = [IO.File]::ReadAllText($path, $utf8)
  $orig = $text
  foreach ($pair in $plan[$file]) {
    $ph, $val = $pair
    if (-not $val) { continue }
    $n = ([regex]::Matches($text, [regex]::Escape($ph))).Count
    if ($n -gt 0) { $text = $text.Replace($ph, $val); Write-Host ("{0}: {1} x {2}" -f $file, $n, $ph) }
  }
  if ($text -ne $orig) {
    $changed += $file
    if (-not $DryRun) { [IO.File]::WriteAllText($path, $text, $utf8) }
  }
}
if (-not $changed) { Write-Host 'Nothing to fill (already done, or values not given).' }

$left = Select-String -Path (Join-Path $PSScriptRoot 'README.md'), (Join-Path $PSScriptRoot 'SUBMISSION\devpost.md') -Pattern '\[\[|LIVE_DEMO_URL`|VIDEO_URL`|<repo-url>' -SimpleMatch:$false
if ($left) {
  Write-Host ''
  Write-Host 'Still to fill (by hand or a later run):' -ForegroundColor Yellow
  $left | ForEach-Object { Write-Host ("  {0}:{1}: {2}" -f (Split-Path $_.Path -Leaf), $_.LineNumber, $_.Line.Substring(0, [Math]::Min(110, $_.Line.Length))) }
}
if ($DryRun) { Write-Host ''; Write-Host 'DRY RUN: no files written, nothing committed or pushed.' -ForegroundColor Yellow; exit 0 }

$tracked = $changed | Where-Object { git ls-files -- ($_ -replace '\\', '/') }
if ($tracked) {
  git add -- $tracked
  git commit -q -m "Fill demo, video and repo links" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  if ($LASTEXITCODE -ne 0) { Fail 'git commit failed.' }
  Write-Host "Committed: $($tracked -join ', ')" -ForegroundColor Green
}
if (-not $NoPush) {
  git remote get-url origin *> $null
  if ($LASTEXITCODE -ne 0) { Write-Host 'No GitHub remote yet: run .\publish.ps1 first, then this again.' -ForegroundColor Yellow; exit 0 }
  git push origin main
  if ($LASTEXITCODE -ne 0) { Fail 'git push failed.' }
  Write-Host 'Pushed. Render redeploys by itself in a minute or two.' -ForegroundColor Green
}
