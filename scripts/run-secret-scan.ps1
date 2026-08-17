# Mirrors GitHub Actions "Secret scan (working tree)" for local pre-push checks.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = "8.24.2"
$tmpdir = Join-Path $env:TEMP "walkchamp-gitleaks-$version"
New-Item -ItemType Directory -Force -Path $tmpdir | Out-Null
$zip = Join-Path $tmpdir "gitleaks.zip"
$exe = Join-Path $tmpdir "gitleaks.exe"

if (-not (Test-Path $exe)) {
  $url = "https://github.com/gitleaks/gitleaks/releases/download/v$version/gitleaks_${version}_windows_x64.zip"
  Write-Host "Downloading gitleaks $version..."
  curl.exe -sSfL $url -o $zip
  Expand-Archive -Force $zip -DestinationPath $tmpdir
}

& $exe detect --no-git --source $root --redact --exit-code 1 --config (Join-Path $root ".gitleaks.toml")
if ($LASTEXITCODE -ne 0) {
  Write-Error "Secret scan failed (exit $LASTEXITCODE). Fix leaks or update .gitleaks.toml allowlist for false positives."
  exit $LASTEXITCODE
}
Write-Host "Secret scan: ok"
