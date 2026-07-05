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
    "hooks\useParticipantStepAnimator.ts",
    "hooks\useTabBarHeight.ts",
    "components\ScreenContainer.tsx",
    "components\SkeletonRows.tsx",
    "components\EarnTasksSection.tsx",
    "components\AndroidStepTrackingSetup.tsx",
    "app\rooms\available.tsx",
    "app\rooms\upcoming\[date].tsx",
    "app\groups\index.tsx",
    "app\groups\[groupId].tsx",
    "app\sponsored-events\index.tsx",
    "app\sponsored-events\waiting-room.tsx",
    "app\+not-found.tsx",
    "components\BannerAdView.tsx",
    "components\CoinsStoreModal.tsx",
    "store\slices\coinsSlice.ts",
    "services\iapService.ts",
    "app\walk\step-history.tsx",
    "app\race\live-detail.tsx",
    "app\race\matchmaking.tsx",
    "app\live-races.tsx",
    "app\(tabs)\walk.tsx",
    "app\(tabs)\leaderboard.tsx",
    "app\(tabs)\live.tsx",
    "app\(tabs)\chat.tsx",
    "app\(tabs)\profile.tsx",
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
    "components\WearableSetupModal.tsx",
    "components\RoomInvitationModal.tsx",
    "components\CoinsInfoModal.tsx",
    "components\MyTitlesModal.tsx",
    "components\CoinRewardToast.tsx",
    "components\CoinsBattleModal.tsx",
    "services\voiceService.ts",
    # Cash challenge payment / prize pool UI
    "services\cashChallengeApi.ts",
    "components\CashChallengePaymentBreakdown.tsx",
    "app\race\room.tsx",
    "app\race\index.tsx",
    "app\race\result.tsx",
    "app\spectator\[id].tsx"
)

function Sync-OneWay([string]$from, [string]$to) {
    foreach ($rel in $files) {
        $src = Join-Path $from $rel
        $dst = Join-Path $to $rel
        if (-not (Test-Path -LiteralPath $src)) {
            Write-Warning "Skip (missing source): $src"
            continue
        }
        $dstDir = Split-Path $dst -Parent
        if (-not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
        Copy-Item -LiteralPath $src -Destination $dst -Force
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
