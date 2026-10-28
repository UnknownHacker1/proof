<#
.SYNOPSIS
  Saves your YouCam API key into .env (creates .env from .env.example first). Safe to re-run.
.EXAMPLE
  .\setkey.ps1 YOUR_KEY
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Key,
  [switch]$NoCheck
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$envPath = Join-Path $PSScriptRoot '.env'

$Key = $Key.Trim().Trim('"', "'")
if ($Key -match '\s' -or $Key.Length -lt 8) {
  Write-Host 'ERROR: that does not look like an API key (too short or has spaces). Copy it again from the YouCam API console.' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath $envPath)) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.env.example') -Destination $envPath
  Write-Host 'Created .env from .env.example'
}

function New-Secret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

$out = New-Object System.Collections.Generic.List[string]
$keyDone = $false; $secretDone = $false
foreach ($line in [IO.File]::ReadAllLines($envPath)) {
  if ($line -match '^\s*#?\s*YOUCAM_API_KEY\s*=') {
    if (-not $keyDone) { $out.Add("YOUCAM_API_KEY=$Key"); $keyDone = $true }
    continue
  }
  if ($line -match '^\s*RECEIPT_SECRET\s*=\s*\S') { $out.Add($line); $secretDone = $true; continue }
  if ($line -match '^\s*#?\s*RECEIPT_SECRET\s*=') {
    # Keeps scan signatures valid across restarts. Only set once.
    if (-not $secretDone) { $out.Add("RECEIPT_SECRET=$(New-Secret)"); $secretDone = $true }
    continue
  }
  $out.Add($line)
}
if (-not $keyDone) { $out.Add("YOUCAM_API_KEY=$Key") }
if (-not $secretDone) { $out.Add("RECEIPT_SECRET=$(New-Secret)") }
# UTF-8 without BOM, so the server's .env reader sees the first line cleanly.
[IO.File]::WriteAllLines($envPath, $out)

$tail = $Key.Substring($Key.Length - 4)
Write-Host "Saved key ending in ...$tail to .env (git-ignored, never committed)." -ForegroundColor Green
if ($NoCheck) { exit 0 }

Write-Host 'Checking the key with YouCam (free call, 0 units)...'
& node scripts/check-key.js
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host 'Next: .\golive.ps1' -ForegroundColor Cyan
