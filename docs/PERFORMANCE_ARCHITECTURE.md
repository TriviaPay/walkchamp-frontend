# WalkChamp Performance Architecture

Source of truth for instant-first data delivery. UI, navigation, Lottie timing, race/step/HC/HK/auth/payment rules are unchanged.

## Delivery model

```
L1 in-memory (Redux / Context / screenCache mem)
  → immediate render
L2 disk (screenCache / AsyncStorage)
  → parallel with server when L1 cold
L3 server (authFetch + apiRequestCoordinator)
  → background merge, latest-wins
L4 realtime (realtimeService / sensors)
  → after shell paint; never blocks first paint
```

## State ownership matrix

| Domain | Canonical owner | Cache | Realtime | Network | Notes |
|---|---|---|---|---|---|
| Authenticated user | AuthContext + authSlice | session restore | — | Descope / profile | authGeneration bumps on login/logout |
| Coins | coinsSlice | loginHydration TTL | — | coin balance API | background on Walk focus |
| Track themes | trackThemesSlice | loginHydration TTL | — | themes API | prefetch visible/next |
| Verified today steps | raceProgressSlice + stepProviderManager | stepScopedStorage | HC/HK | /api/walk sync | Never provisional-as-authority |
| Provisional today steps | sensors via provider manager | in-memory | TYPE_STEP_COUNTER / CMPedometer | — | Display only when allowed |
| Classic race steps | raceProgressSlice + RaceContext | race outbox | Pusher + sensors | race progress POST | |
| Active race | RaceContext / raceProgress activeRace | screenCache shells | Pusher | race detail | |
| Unlimited challenge day | unlimited feature + raceProgress | local day key | Pusher | unlimited APIs | |
| Race participants | LiveRaceScreen + coordinator | live-detail cache | Pusher | leaderboard pages | Full board retained |
| Leaderboard | LiveRaceScreen / Ranks | screenCache | Pusher | paginated GETs | Progressive pages |
| Presence | PresenceContext | mem Set equality | Pusher + 8s poll | friends APIs (parallel) | Skip unchanged sets |
| Unread | UnreadContext | — | — | unread APIs | Isolate badge consumers |
| Walk permissions | WalkContext | — | — | HC/HK permission | |
| Profile | Auth + profile screens | screenCache | — | profile GET | SWR |
| Sponsored | WalkScreen | screenCache | — | sponsored APIs | Background |
| Walk today display steps | walkTodayStepsStore (UI) | mirrors WalkContext | — | — | Isolates high-freq ticks |

## Cache matrix

| Data | L1 | L2 | Stale display | Invalidation |
|---|---|---|---|---|
| Challenge cards | WalkScreen state | `walk:challenges:{userId}` | Yes | join/leave/start/finish, force on racePhase, TTL poll |
| Race list (Live) | Live tab state | live list keys | Yes | create/join/leave/start/complete, realtime |
| Live detail shell | screenCache.getSync | `live-race-detail:v1:{user}:{race}` | Yes shell only | race end, logout clearAll |
| Coins / themes | Redux | hydration markers | Yes | purchase / login |
| Profile / groups | screen state | screenCache keys | Yes | profile update, logout |

## Prefetch matrix

| Source | Intent | Target | Data | Cancel |
|---|---|---|---|---|
| Live card | onPressIn | Live Detail | mem shell + theme thumb | superseded by open |
| Live card | onPress | Live Detail | mem+disk shell, navigate, theme full | — |
| Waiting Room | countdown begins | Live Detail | primeSync shell, race GET, theme | account/race change |
| Waiting Room | GO | Live Detail | navigate with warm cache | — |
| Walk | active race visible | Live Detail | shell when navigating | — |
| Startup Lottie | land on Walk | Walk | auth, memory/cache, active race summary | splash route only |

## Realtime matrix

| Domain | Owner | Snapshot | Fallback | Recovery |
|---|---|---|---|---|
| Race progress | realtimeService + LiveRaceScreen | HTTP detail/leaderboard | HTTP poll | reconnect → snapshot if gap |
| Waiting Room roster | matchmaking + Pusher | room poll | poll interval | refetch on reconnect |
| Presence | PresenceContext | friends/online | 8s poll | AppState active refresh |

## Optimistic action matrix

| Action | Policy |
|---|---|
| Like/heart, harmless prefs | Optimistic allowed + rollback |
| Chat outgoing presentation | Optimistic presentation OK |
| Verified steps, prizes, settlement, payment, join/create cash, membership | Never optimistic |
| Race start / leave / create result | Server confirmation required |

## Auth generation

- `bumpAuthGeneration` on auth slice login/logout
- `runCoalescedAuthed` drops results when guard invalid
- Logout: `screenCache.clearAll()`, cancel account work, clear race runtime

## High-frequency isolation

- `todaySteps` removed from WalkContext provider memo deps
- Hot UI uses `useWalkTodaySteps()` (`useSyncExternalStore`)
- Presence online Set: content-equal skip
- Challenge poll: coalesced + TTL; racePhase uses `{ force: true }`
