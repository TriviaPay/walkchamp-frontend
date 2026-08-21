# Step source of truth (Walk Champ)

Walk Champ separates **verified daily health totals** from **provisional live movement** so daily steps, live animation, backend records, and prize settlement stay consistent.

## Two lanes

| Lane | Android | iOS | Purpose |
|------|---------|-----|---------|
| **Verified daily** | Health Connect | HealthKit | Walk tab authority, Unlimited qualification/settlement, reconciliation, prizes |
| **Provisional live** | `TYPE_STEP_COUNTER` | `CMPedometer` | Responsive live UI (Classic races + Unlimited live experience when HC/HK is delayed) |

> Health Connect / HealthKit are authoritative for verified totals, qualification, and prizes.
> Phone sensors provide provisional live movement only and must never independently decide winners, qualification, or prizes.

**Provisional is not verified.** Android verified totals come only from an unfiltered Health Connect aggregate. Samsung Health is optional (wearables may write into Health Connect) and is never required for phone steps. Sensor tracking continues for live UX even when verification is delayed or unavailable. Android builds require API 34+.

## Mode matrix

| Mode | Live display | Verified authority | Live write | Walk sync while live |
|------|--------------|--------------------|------------|----------------------|
| **Walk tab** | Prefer verified; may show provisional estimate | HC/HK | `POST /api/walk/steps` → `step_daily_totals` | Active |
| **Unlimited** | `displayedLiveSteps = max(verifiedToday, provisionalToday)` | HC/HK | Verified: `/api/walk/steps`; Provisional: `/api/unlimited-challenges/:id/live-progress` (Redis only) | **Always active** |
| **Classic Free / Coins / Cash / Sponsored** | Sensor `raceSteps` | HC/HK reconciliation at end | `POST /api/races/:id/progress` | **Paused** |

## Canonical stores

| Data | Canonical source | Scope |
|------|------------------|--------|
| Daily walk steps (verified) | Redux `verifiedTodaySteps` → `POST /api/walk/steps` → `step_daily_totals` | `userId` + day key |
| Display alias `todaySteps` | `max(verified, provisional)` | Walk UI + daily FGS (91002) |
| Unlimited provisional live | Redis `ul:prov:{challengeId}:{userId}:{challengeDayKey}` | Never labeled verified |
| Classic live race steps | Redux `raceSteps` → `POST /api/races/:id/progress` | `userId` + `raceId` |
| Unlimited settlement | Verified/reconciled HC/HK only | Challenge day windows |

## Unlimited dual-lane fields

```text
verifiedTodaySteps      — HC/HK daily authority (qualification)
provisionalTodaySteps   — sensor estimate for live UX
displayedLiveSteps      — max(verified, provisional) — display/realtime only
totalChallengeSteps     — accumulated finalized days + today's verified (not provisional)
raceSteps               — classic race session only — never Unlimited progress
```

Do **not** blind-`Math.max` across different semantic fields or challenge days.
Do **not** map `totalChallengeSteps` → today’s `currentSteps`.
Do **not** write sensor values into `step_daily_totals` as verified.

## Write paths

### Unlimited must NOT

- Call `RaceContext.startRace()` / `resumeLiveRace` / `setActiveRace` / `ensureActiveRaceInStore`
- Pause `POST /api/walk/steps`
- POST the Unlimited ID to `/api/races/:id/progress`
- Store progress in `race_participants.currentSteps`
- Mark daily completion / prizes from provisional alone

### Unlimited must

- Keep Walk sync active from Walk tab, background, and Live Detail
- Keep TYPE_STEP_COUNTER / CMPedometer provisional tracking for live UX
- Upload provisional via `/api/unlimited-challenges/:id/live-progress` (Redis + realtime)
- Merge realtime by `challengeId + participantId + challengeDayKey`
- Own ongoing notification via **daily steps FGS (91002)**, not classic `race_live`

### Classic must (unchanged)

- Sensor baseline → provisional race delta → progress buffer → `/api/races/:id/progress`
- Keep walk sync on while racing (`POST /api/walk/steps` is daily; race progress is separate)
- Freeze live-race counting at `goalSteps`; daily walk can continue past the goal
- Reconcile with HC/HK before final prizes

## Realtime payload (Unlimited)

Additive fields:

- `displayedLiveSteps`, `provisionalTodaySteps`, `verifiedTodaySteps`
- `progressSource`: `provisional` | `verified` | `mixed`
- `verificationStatus`: `verified` | `syncing` | `verification_delayed` | `unavailable`

Peers may animate from `displayedLiveSteps`. Qualification / badges / prizes use verified fields only.

## Device capability

Central resolver: `platform/steps/stepTrackingCapability.ts`
(Compatibility re-export: `services/steps/stepTrackingCapability.ts`)

- HC ready without external writer → verified + provisional
- HC available but no records → provisional continues; writer/provider may be required
- HC unsupported → provisional only; paid challenges blocked
- No sensor and no HC → no fake progress; paid challenges blocked

## Day identity

- Walk tab: user’s resolved timezone calendar day
- Unlimited: challenge locked IANA timezone / `challengeDayKey`
- Same-day merges are monotonic per lane; new day may accept `0`

## Forbidden

- Treating provisional as verified daily progress
- Summing absolute HC/HK readings from multiple devices instead of absolute daily upsert
- Using multi-day totals or raw boot counters as today’s Unlimited progress
- Routing Unlimited through classic race progress
