# WalkChamp Architecture

This document describes the mobile WalkChamp application layout after the
feature-oriented reorganization. Behavior and Expo Router URLs are unchanged.

## Repository boundaries

| Area | Path | Notes |
|------|------|-------|
| Mobile (Expo Router) | `app/`, `features/`, `shared/`, `core/`, `platform/`, `context/`, `store/`, `components/`, `hooks/`, `utils/`, `config/`, `constants/`, `assets/` | Primary product |
| Local native module | `modules/walkchamp-race-progress/` | FGS / Live Activity bridges |
| Expo plugins | `plugins/` | Config plugins |
| Android project | `android/` | Generated / native |
| Backend | `Backend/` | Separate deployable — do not mix with mobile features |
| Marketing site | `src/` (Vite) + `server/` | Separate from Expo mobile |

## Dependency direction

```
app (routes)
  → features (screens, feature UI, feature API/mappers)
    → core / shared / platform / store / context
```

Do **not** import `app/` or feature screens from `core/`, `shared/`, or `platform/`.

## Folder responsibilities

### `app/`

Expo Router filesystem routes and layouts only. Prefer thin entry files:

- [`app/(tabs)/walk.tsx`](../app/(tabs)/walk.tsx) → `@/features/walk/screens/WalkScreen`
- [`app/race/live-detail.tsx`](../app/race/live-detail.tsx) → `@/features/race/screens/LiveRaceScreen`

**Route paths must stay stable** (`/(tabs)/walk`, `/race/live-detail`, etc.).

### `features/`

Product domains:

- `features/walk` — Walk home screen implementation
- `features/race` — Live Race detail screen implementation
- `features/unlimited` — Unlimited rules, mappers, APIs, guards
- (expand: auth, chat, wallet, leaderboard, … as files are migrated)

### `shared/`

Truly reusable UI, hooks, utils, and types (not feature-specific).

### `core/`

Cross-cutting infrastructure:

- `core/api` — `authFetch`, `apiRequestCoordinator`
- `core/cache` — `screenCache`
- `core/realtime` — Pusher transport (`realtimeService`)
- `core/steps` — `stepProgressCoordinator` (canonical write funnel)

### `platform/`

Device / OS integrations:

- `platform/steps` — Health Connect, HealthKit, sensors, `stepProviderManager`

### `store/`

Active Redux reducers only: `auth`, `coins`, `trackThemes`, `raceProgress`.

`walkSlice` remains on disk because callers still dispatch `walkActions` for
compatibility; the reducer is **not** mounted (pre-existing). Do not reintroduce
unmounted slices without registering them.

### `context/`

Lifecycle orchestration: Auth, Walk, Race, Presence, Unread, etc.

### Compatibility re-exports

During migration, old paths re-export new locations, e.g.:

```ts
// utils/authFetch.ts
export * from "@/core/api/authFetch";
```

Prefer importing the new paths in new code. Remove stubs only when grep shows
zero callers.

## State ownership (canonical)

| Concern | Owner |
|---------|--------|
| Auth user / session | Redux `auth` + `AuthContext` |
| Coins | Redux `coins` |
| Track themes | Redux `trackThemes` |
| Verified / provisional / race steps | Redux `raceProgress` via `stepProgressCoordinator` |
| Walk UX / permissions | `WalkContext` |
| Classic race lifecycle | `RaceContext` |
| Presence / unread | Contexts |
| Screen list SWR | `screenCache` + screen state |
| `/api/walk/today` cache | React Query (existing keys) |

## Step source of truth

See [`STEP_SOURCE_OF_TRUTH.md`](./STEP_SOURCE_OF_TRUTH.md).

Pipeline (unchanged semantics):

Health Connect / HealthKit (verified) + sensors (provisional)
→ `platform/steps/stepProviderManager`
→ WalkContext / RaceContext
→ `core/steps/stepProgressCoordinator`
→ `raceProgress` slice
→ UI / sync / FGS / Live Activity

## Networking & realtime

- HTTP: `core/api/authFetch` (+ `apiRequestCoordinator` for GET coalescing/TTL)
- Pusher: single client in `core/realtime/realtimeService` with channel ref-counting
- Feature helpers may subscribe; they must not create a second Pusher client

## Classic vs Unlimited

Shared Live Race UI + Unlimited adapters/mappers under `features/unlimited`.
Do not fork a second Live Race app. Preserve `unlimitedRaceProgressGuard`.

## Where to add new code

| Need | Location |
|------|----------|
| New Walk UI section | `features/walk/` |
| New race API | `features/race/api/` (create when needed) |
| Unlimited mapper/rule | `features/unlimited/` |
| Health provider | `platform/steps/` |
| Auth HTTP helper | `core/api/` |
| Shared modal | `shared/components/` (or existing `components/` until migrated) |
| New Expo route | `app/` thin file → feature screen |

## Migration notes

See [`MIGRATION_BASELINE.md`](./MIGRATION_BASELINE.md).
