# WalkChamp Cleanup Quarantine Manifest

Date: 2026-08-30

Files moved here during conservative repository cleanup. These were not deleted because usage could not be proven with 100% confidence, but no static imports or runtime references were found.

| Original path | New path | Reason | Evidence |
|---|---|---|---|
| `utils/sponsoredWalkCard.ts` | `cleanup-quarantine/sponsoredWalkCard.ts` | Unused utility extracted from Walk tab logic but never wired up | Zero imports repo-wide; `mapSponsoredEventsToCardStatus` only defined in this file; WalkScreen inlines equivalent logic |

## Files deleted (100% confirmed unused)

| File | Reason | Evidence |
|---|---|---|
| `assets/lottie/Splash App Icon.json` | Byte-identical duplicate | SHA256 matches `splash-app-icon.json`; only `splash-app-icon.json` referenced in `WalkChampSplash.tsx` |
| `assets/notifications/ic_stat_onesignal_default.svg` | Unused alternate format | Zero references; `app.json` and plugin use PNG/XML variants |
| `services/permissions/stepTrackingNotificationGate.ts` | Deprecated re-export shim | Marked `@deprecated`; zero imports; callers use `notificationGate.ts` directly |
| `utils/authErrors.ts` | Dead code | `SessionExpiredError` never imported; auth uses `authEvents.emitSessionExpired()` |

## Untracked temp files removed from disk

- `tmp-eas-build.json`
- `tmp-eas-log.txt`
- `tmp-eas-log-decoded.txt`
- `tmp-eas-log-url.txt`
- `tmp-test-out.txt`
