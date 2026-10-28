<#
.SYNOPSIS
  Creates the public GitHub repo UnknownHacker1/proof (if missing), pushes main, and prints the
  one-click Render deploy link. Safe to re-run. Refuses to push if .env or photos are tracked.
.EXAMPLE
  .\publish.ps1
.EXAMPLE
  .\publish.ps1 -DryRun    # checks everything, prints the commands, changes nothing
#>
param(
  [string]$Owner = 'UnknownHacker1',
  [string]$Name = 'proof',
  [switch]$DryRun
)
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
function Fail([string]$msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
function Step([string]$msg) { Write-Host ""; Write-Host "== $msg" -ForegroundColor Cyan }
function Run([string]$desc, [scriptblock]$cmd) {
  if ($DryRun) { Write-Host "[dry-run] would run: $desc" -ForegroundColor Yellow; return }
  Write-Host "> $desc" -ForegroundColor DarkGray
  & $cmd
  if ($LASTEXITCODE -ne 0) { Fail "'$desc' failed (exit $LASTEXITCODE). See the lines above." }
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'GitHub CLI (gh) is not installed: https://cli.github.com' }
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Fail 'gh is not logged in. Run: gh auth login' }
$repoUrl = "https://github.com/$Owner/$Name"

Step '1/3 Safety checks'
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { Fail "You are on branch '$branch'. Run: git checkout main" }
$bad = git ls-files -- .env .env.local 'noise-study/*' | Where-Object { $_ }
if ($bad) { Fail "These must never be public but are tracked by git: $($bad -join ', ')" }
$dirty = git status --porcelain --untracked-files=no
if ($dirty) { Write-Host "Note: uncommitted changes are NOT pushed:`n$($dirty -join "`n")" -ForegroundColor Yellow }
Write-Host 'OK: no .env, no photos tracked.'

Step "2/3 GitHub repo $Owner/$Name"
$origin = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0 -and $origin) {
  Write-Host "Remote 'origin' already set: $origin"
} else {
  gh api "repos/$Owner/$Name" --silent 2>$null
  if ($LASTEXITCODE -eq 0) {
    Run "git remote add origin $repoUrl.git" { git remote add origin "$repoUrl.git" }
  } else {
    Run "gh repo create $Owner/$Name --public --source . --remote origin" { gh repo create "$Owner/$Name" --public --source . --remote origin --description 'Proof: run your skincare like a small trial on your own face (YouCam Skin AI)' }
  }
}

Step '3/3 Push main'
Run 'git push -u origin main' { git push -u origin main }

Write-Host ''
Write-Host "Repo: $repoUrl" -ForegroundColor Green
Write-Host "Deploy (one click, then set YOUCAM_API_KEY and LIVE_ACCESS_CODE when Render asks):"
Write-Host "  https://render.com/deploy?repo=$repoUrl" -ForegroundColor Green
if ($DryRun) { Write-Host ''; Write-Host 'DRY RUN: nothing was created or pushed.' -ForegroundColor Yellow }
