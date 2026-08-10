# Migration baseline (Phase 1)

Recorded during feature-oriented reorganization.

## Phase 0

- `app/race/live-detail.tsx` Babel parse: **OK**
- Broken Pusher `start()` wrapper: **not present** (already restored)
- Warm-cache `InteractionManager` deferral for `fetchRace`: **retained**

## Known pre-existing issues (not introduced by migration)

- `tsc` reports errors in large screens (`walk.tsx`, `matchmaking.tsx`) unrelated to folder moves
- Walk launch can fan out duplicate Unlimited/rooms GETs (performance debt)
- Presence `/api/presence/online-ids` may return 410 (falls back to friends)
- Health Connect rate-limit under rapid permission/status polls

## Unit tests (spot check)

- `utils/apiRequestCoordinator.test.ts` — pass
- `utils/screenCache.persistYield.test.ts` — pass

## Scope of this migration

Phases 0–5 + thin route extraction for Walk/Live Detail + ARCHITECTURE.md + confirmed-dead cleanup.
No UI/behavior/API contract changes.
