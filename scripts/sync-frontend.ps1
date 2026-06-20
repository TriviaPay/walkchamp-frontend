# Sync frontend UI fixes between C:\wc and the Downloads Walk-Tracker copy.
# Run from either project:  powershell -File scripts\sync-frontend.ps1
# Optional direction:       powershell -File scripts\sync-frontend.ps1 -Direction wc-to-dl
#                           powershell -File scripts\sync-frontend.ps1 -Direction dl-to-wc

param(
    [ValidateSet("wc-to-dl", "dl-to-wc", "both")]
    [string]$Direction = "both"
)

$wcRoot = "C:\wc"
$dlRoot = "C:\Users\RACHANA\Downloads\Walk-Tracker (7)\Walk-Tracker\frontend"

$files = @(
    "hooks\useSafeLayout.ts",
    "app\rooms\available.tsx",
    "components\BannerAdView.tsx",
    "components\CoinsStoreModal.tsx",
    "services\iapService.ts",
    "app\race\live-detail.tsx",
    "app\(tabs)\walk.tsx",
    # Step provider + live race sync (keep both folders in sync)
    "config\stepSyncConfig.ts",
    "services\StepPollingService.ts",
    "services\RaceStepSyncService.ts",
    "services\raceStepSyncBuffer.ts",
    "services\steps\stepProviderTypes.ts",
    "services\steps\raceBaselineStorage.ts",
    "services\steps\raceBaselineStorage.test.ts",
    "services\steps\stepProviderManager.ts",
    "services\steps\stepProviderManager.test.ts",
    "services\steps\providers\iosHealthKitProvider.ts",
    "services\steps\providers\androidHealthConnectProvider.ts",
    "services\steps\providers\androidLegacySensorProvider.ts",
    "services\steps\androidHealthConnectService.ts",
    "services\steps\androidStepTrackingStatus.ts",
    "context\RaceContext.tsx",
    "context\WalkContext.tsx",
    "components\WearableSetupModal.tsx"
)

function Sync-OneWay([string]$from, [string]$to) {
    foreach ($rel in $files) {
        $src = Join-Path $from $rel
        $dst = Join-Path $to $rel
        if (-not (Test-Path $src)) {
            Write-Warning "Skip (missing source): $src"
            continue
        }
        $dstDir = Split-Path $dst -Parent
        if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
        Copy-Item -Path $src -Destination $dst -Force
        Write-Host "Copied: $rel"
    }
}

if ($Direction -eq "wc-to-dl" -or $Direction -eq "both") {
    Write-Host "`n=== wc -> Downloads ===" -ForegroundColor Cyan
    Sync-OneWay $wcRoot $dlRoot
}
if ($Direction -eq "dl-to-wc" -or $Direction -eq "both") {
    Write-Host "`n=== Downloads -> wc ===" -ForegroundColor Cyan
    Sync-OneWay $dlRoot $wcRoot
}

Write-Host "`nDone. Rebuild the app after syncing:" -ForegroundColor Green
Write-Host "  cd C:\wc"
Write-Host "  npx expo run:android"
