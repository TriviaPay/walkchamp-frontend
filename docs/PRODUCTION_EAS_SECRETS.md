# Production EAS secrets checklist (frontend)

Set these on the **production** EAS/Expo project (Secrets or Environment variables).
Do **not** commit live keys to the repo.

## Required for store release observability
- `EXPO_PUBLIC_SENTRY_DSN`

## Required before enabling cash (`EXPO_PUBLIC_ENABLE_CASH_CHALLENGES=true`)

### Sandbox / test cards
- `EXPO_PUBLIC_PAYMENTS_LIVE_MODE=false`
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` = `pk_test_…` (optional for hosted checkout)
- `EXPO_PUBLIC_RAZORPAY_KEY_ID` = `rzp_test_…`
- Backend Coolify: test keys + `CASH_FEATURES_ENABLED=true` + `FEATURE_CASH_FEATURES=true` + `ENABLE_BULLMQ_WEBHOOK_PROCESSING=true`
- Prefer backend `PAYMENTS_LIVE_MODE=false` so `REAL_MONEY_*` legal/KYC flags are not required for sandbox

### Live money
- `EXPO_PUBLIC_PAYMENTS_LIVE_MODE=true`
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` = `pk_live_…`
- `EXPO_PUBLIC_RAZORPAY_KEY_ID` = `rzp_live_…`
- Backend: live keys + all `REAL_MONEY_*=true` + `PAYMENTS_LIVE_MODE=true`
- Confirm deposit webhooks return 200 and do not double-credit

## Required for real ads (replace Google sample IDs)
- `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID`
- `EXPO_PUBLIC_ADMOB_IOS_APP_ID`
- `EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID` / `EXPO_PUBLIC_ADMOB_IOS_BANNER_ID`
- `EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_ID` / `EXPO_PUBLIC_ADMOB_IOS_REWARDED_ID`
- optional interstitial IDs

## Already set in eas.json production (public)
- API URL, Descope project id, Pusher key/cluster, OneSignal app id
- `EXPO_PUBLIC_APP_ENV=production`
- `EXPO_PUBLIC_ENABLE_CASH_CHALLENGES=false` (safe default)

## Preview profile
Keeps test Stripe/Razorpay/AdMob sample IDs for internal QA.
