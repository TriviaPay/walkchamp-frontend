# Step source of truth (frontend)

## Canonical stores

| Data | Canonical source | Scope |
|------|------------------|--------|
| Daily walk steps (sync + notification) | Redux `raceProgress.todaySteps` via `stepProgressCoordinator` | `userId` + `localDate` |
| Live race steps (sync + notification) | Redux `raceProgress.raceSteps` via coordinator / race sync buffer | `userId` + `raceId` |
| Pedometer lifecycle / permissions / HC | `WalkContext` | session |
| Race phase / UI machine | `RaceContext` | race session |

## Hybrid lanes (required)

| Lane | Field | Used for |
|------|-------|----------|
| Verified daily | `verifiedTodaySteps` | `/api/walk/steps`, rewards authority |
| Provisional daily | `provisionalSensorTodaySteps` | Walk UI + 91002 only |
| Display alias | `todaySteps` = max(verified, provisional) | Compatibility UI only |
| Live race | `raceSteps` + `liveRaceSessionId` | Provisional race upload |
| Verified race | `verifiedRaceSteps` | HC/HK race-window query |
| Backend accepted | `backendAcceptedLiveSteps` | Server-acked live total |
| Backend reconciled | `backendReconciledSteps` / `finalAuthoritativeSteps` | Final result only when `reconciliationStatus === "finalized"` |

**Forbidden:** `max(local, verified, reconciled)` as final race authority.


## Dead / legacy

- Redux `walkSlice` was write-only and is removed from the store.
- React Query `useTodayWalkSteps` is for goal/cache reads only — not a competing write path.
