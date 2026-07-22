# Manual Device Permission Checklist

Device / OS permission flows that cannot be fully verified in CI or from this repo alone. All items below are **PENDING (not run)** as of 2026-07-22.

Use a physical device (or a well-configured emulator with Health Connect / Play Services where required). Record build type (Expo Go vs EAS development vs production), OS version, and app version when clearing an item.

---

## Android — Health Connect / activity

| # | Check | Status | Notes |
|---|--------|--------|-------|
| A1 | Health Connect installed / up to date on device | **PENDING (not run)** | |
| A2 | App declares `READ_STEPS` (and related) in manifest; HC SDK initializes | **PENDING (not run)** | |
| A3 | First-run “Enable Step Tracking” requests HC Steps **read** permission | **PENDING (not run)** | |
| A4 | Deny HC permission → app shows settings path; Open HC Settings works | **PENDING (not run)** | |
| A5 | Grant HC permission → today steps hydrate without raw record dumps in logs | **PENDING (not run)** | |
| A6 | `ACTIVITY_RECOGNITION` (if used) requested and reflected in settings | **PENDING (not run)** | |
| A7 | Battery optimization / FGS: ongoing step/race notification survives background | **PENDING (not run)** | |
| A8 | After force-stop + reopen, verified HC source still owns UI (no sensor phantom bumps) | **PENDING (not run)** | |

## iOS — HealthKit / motion

| # | Check | Status | Notes |
|---|--------|--------|-------|
| I1 | HealthKit capability present in production entitlements | **PENDING (not run)** | |
| I2 | First-run Health access prompt for Steps (read) appears | **PENDING (not run)** | |
| I3 | Deny Health → graceful empty/locked state; Open Settings works | **PENDING (not run)** | |
| I4 | Grant Health → today / race steps update from HealthKit | **PENDING (not run)** | |
| I5 | Motion & Fitness / background modes behave as expected for live races | **PENDING (not run)** | |
| I6 | No HealthKit sample payloads logged in device console | **PENDING (not run)** | |

## Push notifications (Android + iOS)

| # | Check | Status | Notes |
|---|--------|--------|-------|
| P1 | Post-login push permission prompt appears once (not spam) | **PENDING (not run)** | |
| P2 | Deny notifications → app continues; no crash; settings deep-link if offered | **PENDING (not run)** | |
| P3 | Grant notifications → OneSignal subscription id registers with backend | **PENDING (not run)** | |
| P4 | Foreground push displays banner; tap routes correctly | **PENDING (not run)** | |
| P5 | Background / killed tap opens correct race / sponsored / wallet route | **PENDING (not run)** | |
| P6 | Push payloads in logs are sanitized (type / ids only — no full JSON PII) | **PENDING (not run)** | |
| P7 | Logout clears / stops associating push with previous user | **PENDING (not run)** | |

## Cross-cutting

| # | Check | Status | Notes |
|---|--------|--------|-------|
| X1 | Fresh install → onboarding permission bootstrap order is acceptable | **PENDING (not run)** | |
| X2 | Account switch: old user’s steps / notifications do not leak into new session | **PENDING (not run)** | |
| X3 | Production build: `__DEV__` / `logger.debug` noise absent from logcat/Xcode | **PENDING (not run)** | |

---

## Sign-off

When an item is executed, replace **PENDING (not run)** with **PASS** or **FAIL**, add date, device model, OS build, and tester initials in Notes.
