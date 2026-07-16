# Step source of truth (frontend)

## Canonical stores

| Data | Canonical source | Scope |
|------|------------------|--------|
| Daily walk steps (sync + notification) | Redux `raceProgress.todaySteps` via `stepProgressCoordinator` | `userId` + `localDate` |
| Live race steps (sync + notification) | Redux `raceProgress.raceSteps` via coordinator / race sync buffer | `userId` + `raceId` |
| Pedometer lifecycle / permissions / HC | `WalkContext` | session |
| Race phase / UI machine | `RaceContext` | race session |

## Display merge (intentional, temporary)

Some screens still take `Math.max(contextSteps, raceProgressSteps)` so a
briefly-ahead context value is not dropped during migration. This **must not**
invent steps from unrelated users/dates/races.

- Prefer `raceProgress` when `userId` matches the signed-in user.
- Walk total steps and race steps remain separate fields — never mix them.
- Do not reintroduce dead `walkSlice` as a third reader.

## Dead / legacy

- Redux `walkSlice` was write-only and is removed from the store.
- React Query `useTodayWalkSteps` is for goal/cache reads only — not a competing write path.
