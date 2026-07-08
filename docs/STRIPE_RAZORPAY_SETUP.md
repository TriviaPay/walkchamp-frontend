# Stripe & Razorpay Setup Guide (Walk Champ)

Complete checklist to connect payments professionally.  
**Backend API domain:** `https://api.walkchamp.miragaming.com`  
**App Link domain (recommended):** `https://walkchamp.app`

---

## 1. Backend environment (Coolify / server)

```env
APP_BASE_URL=https://api.walkchamp.miragaming.com
ALLOWED_ORIGINS=<your-app-origins>

STRIPE_SECRET_KEY=sk_test_...          # live: sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

CASH_FEATURES_ENABLED=true
FEATURE_CASH_FEATURES=true
```

Mobile app:

```env
EXPO_PUBLIC_API_URL=https://api.walkchamp.miragaming.com
EXPO_PUBLIC_WEB_URL=https://walkchamp.app
```

---

## 2. URL map (already implemented in backend)

| Purpose | URL |
|---------|-----|
| Create Stripe checkout | `POST https://api.walkchamp.miragaming.com/api/wallet/deposit/stripe/create-payment-intent` |
| Stripe return | `GET https://api.walkchamp.miragaming.com/api/wallet/deposit/stripe/return` |
| Create Razorpay order | `POST https://api.walkchamp.miragaming.com/api/wallet/deposit/razorpay/create-order` |
| Razorpay checkout page | `GET https://api.walkchamp.miragaming.com/api/wallet/deposit/razorpay/checkout?tid={uuid}` |
| Razorpay verify | `GET https://api.walkchamp.miragaming.com/api/wallet/deposit/razorpay/verify` |
| Done page (browser) | `GET https://api.walkchamp.miragaming.com/api/wallet/deposit/done` |
| Deposit status (app poll) | `GET https://api.walkchamp.miragaming.com/api/wallet/deposit/status/{transactionId}` |
| Stripe webhook | `POST https://api.walkchamp.miragaming.com/api/webhooks/stripe` |
| Razorpay webhook | `POST https://api.walkchamp.miragaming.com/api/webhooks/razorpay` |

**No separate payment website is required** — the API hosts checkout and return pages.

---

## 3. Stripe Dashboard setup

### Step 1 — Account
1. [dashboard.stripe.com](https://dashboard.stripe.com) → create account
2. Complete **Business verification** before live mode
3. **Business description** (for review):
   > Walk Champ is a skill-based walking fitness app. Users add funds to an in-app wallet via Stripe. Wallet balance is used to enter optional paid step challenges; prizes are credited to the wallet. Not gambling — outcomes depend on verified physical activity.

### Step 2 — API keys
- **Developers → API keys**
- Copy **Secret key** → `STRIPE_SECRET_KEY`
- Start in **Test mode**

### Step 3 — Webhook endpoint
- **Developers → Webhooks → Add endpoint**
- URL: `https://api.walkchamp.miragaming.com/api/webhooks/stripe`
- Events (minimum today; add more when backend Phase A ships):

| Event | Purpose |
|-------|---------|
| `checkout.session.completed` | Wallet credit (current) |
| `checkout.session.async_payment_succeeded` | Bank redirect success (Phase A) |
| `checkout.session.async_payment_failed` | Mark failed |
| `checkout.session.expired` | Mark expired |
| `charge.refunded` | Reversal ledger |
| `charge.dispute.created` | Chargeback review |
| `charge.dispute.closed` | Dispute outcome |

- Copy **Signing secret** → `STRIPE_WEBHOOK_SECRET`

### Step 4 — Taxes (Stripe Tax — optional for wallet top-up)

Wallet **deposits** are generally a prepayment for future services, not taxable goods at deposit time in most jurisdictions. **Prize payouts** may trigger tax reporting.

| Item | Recommendation |
|------|----------------|
| Wallet top-up | Usually no sales tax on stored value (confirm with accountant per country) |
| US prizes | Track winners; IRS Form 1099-MISC if prizes ≥ $600/year to one user |
| India prizes | TDS may apply on winnings — consult CA |
| Stripe Tax | Enable only if selling taxable digital goods directly; wallet prefund model often uses manual tax policy |

**Action:** Get accountant signoff before enabling live cash prizes.

### Step 5 — Test
- Test card: `4242 4242 4242 4242`
- Wallet → Deposit $1
- Stripe Dashboard → Webhooks → verify `200` response

---

## 4. Razorpay Dashboard setup

### Step 1 — Account & KYC
1. [dashboard.razorpay.com](https://dashboard.razorpay.com)
2. Complete **KYC** (required for live INR)
3. Business category: digital services / gaming-adjacent skill platform (confirm with Razorpay support)

### Step 2 — API keys
- **Settings → API Keys**
- Key ID → `RAZORPAY_KEY_ID`
- Key Secret → `RAZORPAY_KEY_SECRET`
- Use `rzp_test_` keys first

### Step 3 — Payment methods
Enable for wallet top-up:
- UPI
- Cards
- Netbanking (optional)

**Capture:** Automatic capture (recommended for wallet).

### Step 4 — Webhook
- **Settings → Webhooks → Add New Webhook**
- URL: `https://api.walkchamp.miragaming.com/api/webhooks/razorpay`
- Secret → `RAZORPAY_WEBHOOK_SECRET`
- Events:

| Event | Purpose |
|-------|---------|
| `payment.captured` | Credit wallet |
| `order.paid` | Backup settlement |
| `payment.failed` | Log failure |
| `refund.created` | Reversal |
| `refund.processed` | Confirm reversal |

### Step 5 — Taxes (India)

| Item | Notes |
|------|-------|
| GST on platform fee | If you charge explicit platform/service fees, GST may apply on fee component |
| Wallet deposit | Generally payment collection — GST treatment depends on whether it's prepayment for service |
| TDS on winnings | Section 194BA / gaming winnings rules may apply to prizes — consult CA |
| Razorpay GST invoices | Download from dashboard for your filings |

**Action:** Register GSTIN if applicable; configure Razorpay tax invoices with your CA.

### Step 6 — Test
- User profile country = `IN`
- Wallet → Deposit ₹100
- Confirm webhook `200`

---

## 5. Website setup (walkchamp.app) — App Links

Required for **Phase C** Universal Links / Android App Links.

### 5a. Apple Universal Links

Host at `https://walkchamp.app/.well-known/apple-app-site-association` (no file extension):

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAMID.com.globalwalkerleague.app",
        "paths": [
          "/payment-complete",
          "/payment-complete/*"
        ]
      }
    ]
  }
}
```

Replace `TEAMID` with your Apple Team ID.

Also host the same structure on API host if using API done-page links:

`https://api.walkchamp.miragaming.com/.well-known/apple-app-site-association`

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAMID.com.globalwalkerleague.app",
        "paths": [
          "/api/wallet/deposit/done",
          "/api/wallet/deposit/done/*"
        ]
      }
    ]
  }
}
```

### 5b. Android App Links

Host at `https://walkchamp.app/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.globalwalkerleague.app",
      "sha256_cert_fingerprints": [
        "YOUR_RELEASE_SHA256_FINGERPRINT"
      ]
    }
  }
]
```

Get fingerprint:
```bash
keytool -list -v -keystore your-release.keystore -alias your-alias
```

Duplicate for `api.walkchamp.miragaming.com` if linking from API done page.

### 5c. Optional marketing page

`https://walkchamp.app/payment-complete` can be a simple static page:

> Payment recorded. Return to the Walk Champ app.  
> If the app did not open, [open Walk Champ](globalwalkerleague://payment-complete).

### 5d. Legal pages (required for App Store + providers)

Host on walkchamp.app:

| Page | Purpose |
|------|---------|
| `/terms` | Terms of service — skill contest, not gambling |
| `/privacy` | Privacy policy — payment data handled by Stripe/Razorpay |
| `/responsible-play` | Spending limits, 18+, help resources |
| `/rules` | Official challenge rules |

Include: **Apple is not a sponsor** language in terms/rules.

---

## 6. Mobile app (already done in Phase C frontend)

- Plugin `plugins/withPaymentAppLinks.js` registers hosts from env
- `payment-complete` screen polls backend before showing wallet result
- Wallet polls pending deposit on **app resume**
- Rebuild required after plugin change: `npx expo prebuild` or EAS build

---

## 7. Go-live checklist

### Test mode
- [ ] Stripe test deposit ($1) → wallet balance updates
- [ ] Razorpay test deposit (₹100) → wallet balance updates
- [ ] Webhooks return 200
- [ ] User country IN → Razorpay only; non-IN → Stripe only

### Production
- [ ] Switch to live Stripe + Razorpay keys
- [ ] Live webhook secrets updated on server
- [ ] `APP_BASE_URL` is production HTTPS
- [ ] Apple + Google assetlinks / AASA files live
- [ ] Legal pages published
- [ ] Accountant signoff on tax / prize reporting
- [ ] Stripe + Razorpay written approval for wallet + skill contest model
- [ ] Backend Phase A `settleDepositOnce` deployed (anti double-credit)
- [ ] Backend Phase B prize credit deployed
- [ ] `CASH_FEATURES_ENABLED=true` only when legal approves

---

## 8. What NOT to configure

| Skip | Why |
|------|-----|
| Stripe PaymentSheet in app | App uses hosted Checkout in browser |
| Razorpay native SDK | App uses backend-hosted checkout.js page |
| Separate WordPress shop | API is the payment host |
| Tax on every deposit via Stripe Tax | Usually wrong for wallet prefund — get CA advice first |

---

## 9. Support contacts

- Stripe support: Dashboard → Help
- Razorpay support: Dashboard → Help & Support
- Internal: forward `PAYMENTS_BACKEND_HANDOFF.md` to backend team for Phases A, B, D
