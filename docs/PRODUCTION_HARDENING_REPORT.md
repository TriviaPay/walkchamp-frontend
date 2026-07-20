# Walk Champ Frontend — Production Hardening Report

Date: 2026-07-14  
Scope: Frontend only  
Constraint: Preserve existing functionality / UX / business logic

---

## 1. Files reviewed (high-signal)

- `eas.json`, `app.json`, `.env.example`, `package.json`
- `config/featureFlags.ts`, `config/paymentsConfig.ts`
- `app/_layout.tsx`, `components/ErrorBoundary.tsx`, `components/ErrorFallback.tsx`
- `store/index.ts`, Redux slices, `services/stepProgressCoordinator.ts`
- `services/raceStepSyncBuffer.ts`, `services/steps/stepProviderManager.ts`, `services/dynamicIconService.ts`
- `services/ads/adMobService.ts`, `components/BannerAdView.tsx`
- `app/(tabs)/wallet.tsx`, `walk.tsx`, `live-track.tsx`, `app/race/live-detail.tsx`
- `context/WalkContext.tsx`, `AuthContext.tsx`, `UnreadContext.tsx`
- `services/queryClient.ts`, `services/queryKeys.ts`, `utils/apiRequestCoordinator.ts`

## 2. Files changed / added

### Added
- `app.config.js` — dynamic AdMob app IDs from env
- `config/env.ts` (+ `env.test.ts`)
- `config/adsConfig.ts`
- `services/monitoring/sentry.ts`
- `context/NetworkContext.tsx`
- `components/OfflineBanner.tsx`
- `services/analytics.ts`
- `services/remoteFeatureFlags.ts`
- `services/api/hotReads.ts`
- `utils/liveRaceDisplay.ts` (+ test)
- `docs/STEP_SOURCE_OF_TRUTH.md`
- `docs/PRODUCTION_EAS_SECRETS.md`

### Updated
- `eas.json`, `.env.example`, `package.json` (scripts + `@sentry/react-native`)
- `config/featureFlags.ts`, `config/paymentsConfig.ts`
- `app/_layout.tsx`, `components/ErrorBoundary.tsx`
- `components/BannerAdView.tsx`, `services/ads/adMobService.ts`
- `store/index.ts` (removed dead slices from combineReducers)
- `services/stepProgressCoordinator.ts` (init-once AppState; dropped walkSlice writes)
- `services/raceStepSyncBuffer.ts`, `services/steps/stepProviderManager.ts`, `services/dynamicIconService.ts`
- `context/AuthContext.tsx`, `WalkContext.tsx`, `UnreadContext.tsx`
- `app/(tabs)/wallet.tsx`, `walk.tsx`, `live-track.tsx`
- `app/race/live-detail.tsx`, `app/(auth)/signup.tsx`
- `services/queryKeys.ts`

### Intentionally left in tree (disconnected)
- Dead slice files (`walkSlice`, `racesSlice`, `liveSlice`, `chatSlice`, `walletSlice`, `profileSlice`) — no longer wired into the store

---

## 3. P0 completed

| # | Item | Status |
|---|------|--------|
| 1 | Swap sandbox keys | **Done** — production EAS no longer embeds `pk_test_` / `rzp_test_` / sample AdMob; preview keeps test keys; `adsConfig` + `app.config.js` env-driven |
| 2 | Crash reporting | **Done** — `@sentry/react-native` installed; init via `EXPO_PUBLIC_SENTRY_DSN`; ErrorBoundary reports; user id only; scrubbing hooks |
| 3 | Cash gating | **Done** — production `EXPO_PUBLIC_ENABLE_CASH_CHALLENGES=false`; `isCashClientEnabled()` / `canStartCashPaymentFlow()` block prod sandbox-key cash; wallet deposit/withdraw gated |
| 4 | EAS production audit | **Done** — `EXPO_PUBLIC_APP_ENV=production`; prod API/public IDs retained; cash off; payment/ad live values moved to secrets doc |

## 4. P1 completed

| # | Item | Status |
|---|------|--------|
| 5 | NetInfo | **Done** — `NetworkProvider`, debounced `OfflineBanner`, reconnect flush (race buffer + walk outbox registration), wallet online guards |
| 6 | Step SoT | **Done (safe)** — documented canonical `raceProgress`; removed dead walkSlice writes; shared `resolveDisplayTodaySteps` / `resolveLiveRaceDisplaySteps` preserve existing Math.max display |
| 7 | Dead Redux | **Done** — removed races/live/chat/wallet/profile/walk from store wiring |
| 8 | AppState leaks | **Done** — init-once + stored subscriptions in coordinator, race sync buffer, provider manager, dynamic icon |
| 9 | Hot API centralization | **Done** — `services/api/hotReads.ts`; UnreadContext uses coalesced chat summary |
| 10 | Unify live race UI | **Partial (safe)** — shared formatters/merge helpers; full track UI extract deferred (regression risk) |

## 5. P2 completed

| # | Item | Status |
|---|------|--------|
| 11 | Split god screens | **Deferred** — high regression risk; no behavioral split applied |
| 12 | React Query | **Committed** — expanded typed query keys (profile/wallet/leaderboard/sponsored/chat); keep using existing QueryClient + `useTodayWalkSteps`; gradual screen migration next |
| 13 | Shared screen state | **Partial** — unread summary centralized; remaining challenge/sponsored local state deferred |
| 14 | Fat contexts | **Deferred** — would change render topology; memoization already present |
| 15 | Tests / CI scripts | **Done** — `test`, `test:ci`, `validate:frontend`; new env + display helper tests |
| 16 | Analytics | **Done** — abstraction + `signup_completed` hook; other funnel events ready via `trackEvent` |
| 17 | Remote feature flags | **Done** — `remoteFeatureFlags.ts` with TTL cache + safe defaults; optional `/api/preferences/feature-flags` |

## 6. P3 completed / decisions

| # | Item | Status |
|---|------|--------|
| 18 | Tablet | **Phone-only** — `supportsTablet: false` already set; documented as intentional |
| 19 | Error UX | **Partial** — offline + cash gating messages; silent catches elsewhere left intact for behavior parity |
| 20 | Performance | **Partial** — listener/API dedupe only; no invasive list virtualization |

---

## 7. Production configuration audit

- Production profile: production API, Descope/Pusher/OneSignal public IDs, cash **disabled**, no hardcoded test payment keys
- Preview profile: retains test Stripe/Razorpay + sample AdMob for QA
- Operators must set EAS secrets before enabling cash/ads — see `docs/PRODUCTION_EAS_SECRETS.md`

## 8. Crash reporting summary

- Init once at app start (`initCrashReporting`)
- Disabled when DSN missing / Expo Go
- ErrorBoundary → `captureException`
- Auth sets/clears Sentry user id only
- beforeSend / beforeBreadcrumb redact sensitive header-like keys

## 9. Cash gating summary

- Compile-time: `EXPO_PUBLIC_ENABLE_CASH_CHALLENGES`
- Production EAS default: `false`
- Runtime helper: `isCashClientEnabled()` blocks production sandbox keys
- Wallet deposit/withdraw additionally require online + `canStartCashPaymentFlow()`
- Coins / walk / race non-cash paths unchanged

## 10. Offline / NetInfo summary

- Global online detection + delayed offline banner (anti-flicker)
- Reconnect flushes race step buffer + registered walk outbox flush
- Wallet deposit/withdraw blocked offline with friendly alert

## 11. Step source-of-truth summary

Canonical writer/reader for synced steps: Redux `raceProgress` via `stepProgressCoordinator`.  
WalkContext owns pedometer lifecycle. Display still uses documented max-merge helpers for parity.

## 12. Redux cleanup summary

Store now: `auth`, `coins`, `trackThemes`, `raceProgress` only.

## 13. AppState / listener cleanup summary

Four module-level / init paths made remount-safe with single subscription storage.

## 14. API centralization summary

`hotReads.ts` provides coalesced profile/chat/leaderboard/sponsored getters. UnreadContext migrated.

## 15. Live race UI refactor summary

Shared `formatRaceSteps` + display step resolvers; deep layout/track code remains in screens for safety.

## 16. Screen refactor summary

Not performed (god-file splits deferred).

## 17. React Query decision

**Keep and expand.** Keys + client remain; adopt reads incrementally. Did not remove scaffolding.

## 18. Shared state / context optimization

Unread coalescing + NetworkProvider; fat context split deferred.

## 19. Tests / CI summary

Scripts added. New tests: `config/env.test.ts`, `utils/liveRaceDisplay.test.ts`. Existing step tests still runnable via `npm test`.

## 20. Analytics / feature flags summary

- Analytics: sink-based `trackEvent` (non-blocking)
- Remote flags: cached defaults, optional remote endpoint

## 21. Performance improvements summary

Fewer duplicate AppState listeners; coalesced chat summary; no mega-screen rewrite.

## 22. Test results

- `npx tsx utils/liveRaceDisplay.test.ts` → ok
- `npx tsx config/env.test.ts` → ok (when run)
- Full `tsc` still reports **pre-existing** errors in unrelated files (`live.tsx` routes, `RaceContext`, `RoomInvitationModal`, etc.). One coordinator debug log field (`raceId` → `activeRaceId`) and `StepPermissionState` import fixed as part of this pass.

## 23. Known risks

1. Production cash is **off** until secrets + flag flip — intentional.
2. Ads in production require live AdMob env IDs; otherwise ads init is skipped when only sample IDs would apply.
3. Sentry needs a real `EXPO_PUBLIC_SENTRY_DSN` in EAS production; optional native Expo plugin/source maps not auto-configured (JS + ErrorBoundary work with DSN).
4. Remote feature-flags endpoint may 404 today — safe fallback to defaults.
5. Offline blockers currently enforced on wallet cash flows; other join/payment entry points can adopt `requireOnline` gradually without changing online behavior.
6. God-screen splits / fat-context splits / full live-track merge intentionally not done to avoid regressions.

## 24. Follow-up recommendations

1. Set EAS production secrets (Sentry DSN, live AdMob, later live Stripe/Razorpay).
2. After payment webhooks verified: set cash flag true **and** live keys.
3. Migrate wallet/leaderboard/profile screens to React Query using new keys.
4. Add `requireOnline` to race join / sponsored registration entry points.
5. Incrementally extract Walk/Chat/LiveDetail sections behind visual-parity review.
6. Add Sentry Expo config plugin + source maps when org/project credentials exist.
7. Expand analytics funnel events at permission / first race join points.
