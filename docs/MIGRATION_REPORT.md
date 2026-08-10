# Feature-Oriented Migration — Final Report

## Before

Mobile code lived in flat `app/`, `components/`, `context/`, `services/`, `utils/`,
`hooks/`, `store/` with mega-screens (`walk.tsx`, `live-detail.tsx` ~6.5k+ lines)
and Unlimited domain files mixed into generic `utils/` / `services/`.

## After (this pass)

```
features/walk/screens/WalkScreen.tsx
features/race/screens/LiveRaceScreen.tsx
features/unlimited/{mappers,rules,api,guards,services}/
core/{api,cache,realtime,steps}/
platform/steps/
shared/ (shells)
app/(tabs)/walk.tsx          → thin re-export
app/race/live-detail.tsx     → thin re-export
```

Old paths keep compatibility `export * from "@/…"` stubs.

## Phase 0

- `live-detail` SyntaxError: confirmed fixed (Babel PARSE_OK)
- Warm-cache `InteractionManager` fetch deferral retained on LiveRaceScreen

## Moved (high level)

| From | To |
|------|-----|
| `utils/authFetch.ts` | `core/api/authFetch.ts` |
| `utils/apiRequestCoordinator.ts` | `core/api/apiRequestCoordinator.ts` |
| `utils/screenCache.ts` | `core/cache/screenCache.ts` |
| `services/realtimeService.ts` | `core/realtime/realtimeService.ts` |
| `services/stepProgressCoordinator.ts` | `core/steps/stepProgressCoordinator.ts` |
| `services/steps/**` | `platform/steps/**` |
| `utils/unlimited*.ts` | `features/unlimited/mappers|rules/**` |
| `services/unlimited*.ts` | `features/unlimited/api|guards|services/**` |
| `app/(tabs)/walk.tsx` body | `features/walk/screens/WalkScreen.tsx` |
| `app/race/live-detail.tsx` body | `features/race/screens/LiveRaceScreen.tsx` |

## Deleted (confirmed)

- `hooks/useWalkScreenBootstrap.ts` — unused
- Unmounted Redux slices with **no** external imports: `racesSlice`, `liveSlice`,
  `chatSlice`, `walletSlice`, `profileSlice`
- **Retained:** `walkSlice.ts` — still dispatched from WalkContext /
  stepProgressCoordinator (reducer still unmounted; documented)

## Docs

- Added `docs/ARCHITECTURE.md`
- Added `docs/MIGRATION_BASELINE.md`
- Updated `docs/STEP_SOURCE_OF_TRUTH.md` path for stepTrackingCapability

## Tests run

- `core/api/apiRequestCoordinator.test.ts` — pass
- `core/cache/screenCache.persistYield.test.ts` — pass
- `features/unlimited/rules/unlimitedGoal.test.ts` — pass
- `features/unlimited/mappers/unlimitedLiveRace.test.ts` — pass (aligned assertion
  with `requireServerLive` detail mapping — no product logic change)
- `features/unlimited/mappers/unlimitedWaitingRoom.test.ts` — pass
- `features/unlimited/mappers/unlimitedLiveUiGate.test.ts` — pass
- `features/unlimited/guards/unlimitedRaceProgressGuard.test.ts` — pass
- `platform/steps/stepProviderManager.test.ts` — pass

## Remaining debt

- Further Walk / Live Detail **section** extraction (header, board, hooks)
- Migrate remaining feature-specific `components/` / `hooks/` into `features/`
- Remove compatibility re-exports once callers updated
- Pre-existing Walk API fan-out / HC rate-limit (performance; out of scope)
- Pre-existing `tsc` errors in matchmaking / unrelated types
- `walkActions` dispatches with unmounted reducer (pre-existing)

## Acceptance (this pass)

| Item | Result |
|------|--------|
| Expo Router paths preserved | Yes |
| UI / business logic / step SoT / API contracts changed | No |
| Feature grouping started | Yes |
| Mega-screens behind thin routes | Yes |
| Dead unused bootstrap removed | Yes |
| Legacy unmounted slices cleaned (except walkSlice) | Yes |
| authFetch / coordinator / screenCache / Pusher / stepProgressCoordinator centralized | Yes |
| Architecture docs updated | Yes |
