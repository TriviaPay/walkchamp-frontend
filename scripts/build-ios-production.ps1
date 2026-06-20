# One-time Apple credential setup + production IPA build.
# Run in PowerShell (interactive) — EAS must sign in to Apple Developer.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$env:EXPO_APPLE_ID = "admin@miragaming.com"

Write-Host "Apple Developer login: $env:EXPO_APPLE_ID" -ForegroundColor Cyan
Write-Host "EAS account:" -ForegroundColor Cyan
npx eas-cli@latest whoami

Write-Host "`nStep 1: Configure iOS credentials (answer Yes to log in to Apple)" -ForegroundColor Yellow
npx eas-cli@latest credentials:configure-build --platform ios --profile production

Write-Host "`nStep 2: Start production IPA build" -ForegroundColor Yellow
npx eas-cli@latest build --platform ios --profile production
