# Mirrors EAS Install → JS bundle → prebuild → Gradle before cloud build.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

function Step($name, $script) {
  Write-Host "`n=== $name ===" -ForegroundColor Cyan
  & $script
  if ($LASTEXITCODE -ne 0) { throw "$name failed (exit $LASTEXITCODE)" }
  Write-Host "OK: $name" -ForegroundColor Green
}

Step "1. frozen-lockfile (EAS install)" { npm ci --include=dev }
Step "2. typecheck" { npm run typecheck }
Step "3. android JS bundle export" { npx expo export --platform android --output-dir .verify-export-android }
Step "4. android prebuild" {
  if (Test-Path android) { Remove-Item -Recurse -Force android }
  npx expo prebuild --platform android --no-install
}
Step "5. IAP store flavor in Gradle" {
  $gradle = Get-Content android\app\build.gradle -Raw
  if ($gradle -notmatch "missingDimensionStrategy 'store', 'play'") {
    throw "missingDimensionStrategy not found in android/app/build.gradle"
  }
}
Step "6. Gradle :app:assembleRelease (full native APK)" {
  Set-Location android
  $env:NODE_ENV = "production"
  .\gradlew.bat :app:assembleRelease --no-daemon
  Set-Location ..
}

Write-Host "`nAll local build checks passed." -ForegroundColor Green
Write-Host "APK: android\app\build\outputs\apk\release\app-release.apk" -ForegroundColor Yellow
