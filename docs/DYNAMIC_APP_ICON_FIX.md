# Dynamic App Icon Fix Report

Date: 2026-07-23 (home-screen Android launcher pattern)

## In-app vs home-screen

| Surface | Mechanism | Status |
|---------|-----------|--------|
| Walk / Home progress icon | JS `PROGRESS_ICON_SOURCES` | Works without native rebuild |
| Android home-screen app icon | Activity-aliases + Kotlin `setLauncherIcon` | Needs **native rebuild** after this fix |
| iOS home-screen app icon | `expo-alternate-app-icons` | Needs release/dev-client rebuild |

## Root cause (Android home screen stuck)

1. **MainActivity had `MAIN`/`LAUNCHER`** while progress aliases were disabled by default. OEM launchers pin `MainActivity`, so toggling aliases often never changes the home-screen icon (in-app icon still updates via JS).
2. **Kotlin still treated bare `MainActivity` as the “default” launcher component** (`MainActivity` + suffix `""`). Enabling/disabling `MainActivity` does not switch icons once only aliases carry `LAUNCHER`.
3. **`getEnabledLauncherIconName` treated enabled `MainActivity` as Progress0**, which is always true for the real activity — native state could look “already Progress0” while no progress alias was the launcher.

## Fix applied

1. `AndroidManifest.xml`: remove `LAUNCHER` from `MainActivity`; default launcher = `.MainActivityWalkChampProgress0` (`enabled="true"`); other progress aliases `enabled="false"`; `roundIcon` on each alias.
2. Config plugin `plugins/withWalkChampLauncherAliases.js` (registered last in `app.json`) so prebuild keeps this pattern.
3. Kotlin: toggle **only** the five `MainActivityWalkChampProgress*` aliases; `null` → `WalkChampProgress0`; never enable/disable `.MainActivity` for icons.
4. Dev Metro: `[DynamicIcon]` queue/apply lines via `console.warn` for diagnosis.

## Identifiers (unchanged)

`WalkChampProgress0` | `WalkChampProgress25` | `WalkChampProgress50` | `WalkChampProgress75` | `WalkChampProgress100`

## Device verification (required)

Metro reload alone is **not** enough. Install a new native build:

```bash
npx expo run:android
```

Then: open app → confirm steps/milestone → press Home → wait ~2s → check launcher icon. Samsung/One UI may cache; try remove+re-add shortcut or reboot if needed.

## Production

Not claimed fixed until physical-device check after native rebuild.
