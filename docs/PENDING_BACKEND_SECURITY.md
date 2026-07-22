# Pending Backend Security Items

These items cannot be fully verified from this frontend-only repository (`walkChamp`). Treat them as **PENDING** until confirmed against the backend codebase, infrastructure config, and production observability.

Date: 2026-07-22  
Scope: Backend / infra security follow-ups outside this repo

---

## Payment & wallet

| Item | Why pending | Notes |
|------|-------------|-------|
| Stripe / Razorpay webhook signature verification | Webhook handlers live on the API | Confirm HMAC/signature checks, replay protection, and idempotent event processing |
| Wallet balance atomicity | Ledger mutations are server-side | Confirm transactional debit/credit, no double-spend under concurrent race entry + deposit/withdraw |
| Deposit settlement trust boundary | Client polls status only | Confirm return-URL query params are never trusted; server is source of truth |
| Payout / withdrawal authorization | Not in this repo | Confirm KYC gates, destination ownership checks, rate limits, and admin audit trail |
| Refund race conditions | Refund APIs are backend | Confirm leave/cancel refunds cannot be claimed twice |

## Auth & session

| Item | Why pending | Notes |
|------|-------------|-------|
| Refresh-token rotation / revocation | Descope + backend session store | Confirm server-side session invalidation on logout, `SESSION_REPLACED`, and device kick |
| Single-session enforcement | Backend `requireAuth` + headers | Confirm `X-Session-Id` / device metadata gates are enforced server-side |
| Password-reset token lifetime | Email/magic-link issued by Descope/backend | Confirm short TTL, one-time use, and no token leakage in logs/email links beyond intent |
| OAuth code exchange | `/api/auth/oauth/*` on API | Confirm codes are single-use and PKCE/state validated where applicable |

## Anti-cheat & health data

| Item | Why pending | Notes |
|------|-------------|-------|
| Race step anti-cheat | Progress accepted by API | Confirm server clamps, outlier detection, timezone/day-boundary checks, and rejection of impossible deltas |
| Health Connect / HealthKit trust model | Device APIs are client-attested | Confirm backend never trusts client-only step totals without server rules |
| Baseline / boot-step abuse | Race join baselines | Confirm baselines cannot be rewritten mid-race to inflate progress |

## Realtime, chat, notifications

| Item | Why pending | Notes |
|------|-------------|-------|
| Pusher / realtime channel auth | Channel auth is server-signed | Confirm private channels cannot be subscribed without membership |
| Chat message authorization | Message send/read on API | Confirm room membership checks; no cross-room reads |
| Push payload PII | OneSignal templates/API | Confirm notification bodies do not embed email, payment, or health payloads |

## Infrastructure & ops

| Item | Why pending | Notes |
|------|-------------|-------|
| Secret storage | EAS / Vercel / host env | Confirm no secrets in client bundles beyond intended `EXPO_PUBLIC_*` keys |
| API rate limiting | Gateway / app server | Confirm auth, wallet, and progress endpoints are rate-limited |
| Production log scrubbing | Backend log pipeline | Confirm tokens, Authorization headers, and payment payloads are redacted server-side |
| CORS / App Link hosts | Deploy config | Confirm payment return hosts and deep-link domains match production allowlists |

---

## How to clear an item

1. Point to the backend file/PR or infra ticket that implements the control.
2. Note the verification method (unit test, staging webhook replay, pen-test finding closed).
3. Move the row out of this doc or mark **DONE** with date + owner.
