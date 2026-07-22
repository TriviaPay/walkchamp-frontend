# Walk screen performance notes

Date: 2026-07-22

## Instrumentation already in tree

- `utils/perfLogger.ts` — render/focus/timer counters (dev)
- `components/perf/LiveClockText.tsx` — isolated 1s ticks
- `hooks/useWalkScreenBootstrap.ts` — coalesced focus bootstrap (**not wired**; parity with Walk focus effects not verified)

## Changes this pass

- Create-challenge Start/End labels use `LiveClockText` (parent no longer re-renders every second for those labels).
- Next Race parent tick only `setState`s when membership/phase signature changes.
- Live Detail info bar uses `RaceClockInfoBar` / `useTickingNow`.

## Pending measurements (device)

Record before/after on a real device:

| Metric | Before | After | Status |
|--------|--------|-------|--------|
| Walk renders / min while idle with Next Race | | | PENDING |
| Focus-triggered request fan-out | | | PENDING |
| Time to first meaningful Walk content | | | PENDING |
| SecureStore / AsyncStorage reads on focus | | | PENDING |
| Active timers on Walk | | | PENDING |

Do not wire `useWalkScreenBootstrap` until those measurements confirm parity.
