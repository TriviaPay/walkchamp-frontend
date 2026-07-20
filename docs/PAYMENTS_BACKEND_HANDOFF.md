# Payments — Backend Team Handoff (Phases A, B, D)

**Mobile (Phase C) is implemented in the frontend.**  
**Phases A, B, and D require backend + website + provider dashboard work below.**

Do **not** change existing route paths unless noted — the app already calls them.

---

## Domains (from current env)

| Role | URL |
|------|-----|
| API / payments host | `https://api.walkchamp.miragaming.com` |
| Marketing / App Links (recommended) | `https://walkchamp.app` |
| Mobile API env | `EXPO_PUBLIC_API_URL=https://api.walkchamp.miragaming.com` |

---

## Phase A — Money safety (backend)

### A1. `settleDepositOnce(depositId, source, providerSnapshot)`

Create `backend/src/lib/settleDeposit.ts`:

- **Single entry** used by:
  - Stripe webhook handlers
  - Razorpay webhook handlers
  - `GET /api/wallet/deposit/razorpay/verify`
  - Reconciliation cron
- **Rules:**
  - Lock `deposit_transactions` row
  - Verify binding: provider, order/session id, amount, currency, user
  - Terminal `succeeded` never downgrades
  - Credit wallet + insert ledger **once**
  - Return `{ outcome: 'credited' | 'already_settled' | 'processing' | 'failed' | 'requires_review' }`

### A2. DB migration

```sql
-- wallet_transaction_type enum: add deposit_credit, challenge_entry_debit, reversal_debit, prize_credit, chargeback_debit

ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS deposit_transaction_id uuid REFERENCES deposit_transactions(id);
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_deposit_credit_unique_idx
  ON wallet_transactions (deposit_transaction_id)
  WHERE transaction_type = 'deposit_credit' AND deposit_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_idempotency_unique_idx
  ON wallet_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- deposit status expansion (text column today — document allowed values)
-- processing | succeeded | failed | cancelled | expired | requires_review | settlement_error
```

Replace `manual_adjustment` on deposit credit with `deposit_credit`.

### A3. Stripe (`backend/src/routes/deposit.ts`)

| Task | Detail |
|------|--------|
| Idempotency | Pass `idempotencyKey` to `stripe.checkout.sessions.create(..., { idempotencyKey })` |
| Webhooks | Handle `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` |
| Settle rule | Credit only when `payment_status === 'paid'` and amount/currency/metadata match |
| `unpaid` / `processing` | Leave deposit `processing` |
| `no_payment_required` | `requires_review` |
| Disputes/refunds | `charge.refunded`, `charge.dispute.*` → `reversal_debit` row (never edit original credit) |
| Return URL | Keep non-crediting; settlement via webhook + `settleDepositOnce` |

### A4. Razorpay (`backend/src/routes/deposit.ts`)

| Task | Detail |
|------|--------|
| Order create | `partial_payment: false`, automatic capture |
| `/verify` | HMAC → **fetch payment from Razorpay API** → `settleDepositOnce` |
| Webhook | `payment.captured`, `order.paid` → same `settleDepositOnce` |
| `payment.failed` | Log attempt; do not mark terminal failed until provider state confirms |
| Signature mismatch on callback | Metadata only; leave `processing` |
| Invalid webhook signature | 400 + audit log; **do not** insert trusted `deposit_webhook_events` row |

### A5. Reconciliation worker

Add cron (e.g. every 5 min in `worker.ts`):

- `processing` older than **10 minutes** → fetch Stripe session / Razorpay payment → `settleDepositOnce`
- `settlement_error` → retry with backoff
- `processing` older than **24 hours** → `requires_review`

### A6. Invalid webhook audit table (optional)

```sql
CREATE TABLE payment_webhook_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  headers jsonb,
  body_hash text
);
```

---

## Phase B — Challenge money loop (backend)

### B1. Prize credit on race finalization

In `autoCompleteRace` (`backend/src/routes/races.ts`), **same DB transaction** as `payoutFinalizedAt`:

```typescript
idempotencyKey: `prize:${raceId}:${userId}:${rank}`
transactionType: 'prize_credit'
amountCents: positive
```

Use existing `race_finalization_locks` pattern.

### B2. Challenge entry debit

Already uses `race_entry_wallet_debit`. After migration, also set:

```typescript
idempotencyKey: `challenge_entry:${raceId}:${userId}`
transactionType: 'challenge_entry_debit'  // alias or replace enum
```

### B3. Held balance (optional v1)

Add `held_balance_cents` on `wallets` OR derive from ledger. Expose in `GET /api/wallet/summary`:

```json
{
  "availableBalanceMinor": 500,
  "heldBalanceMinor": 0,
  "withdrawableBalanceMinor": 300
}
```

Frontend already shows `pendingBalance` — map `heldBalanceMinor` when API adds it.

### B4. Reversals

Chargeback/refund on deposit → new `reversal_debit` row linked to `deposit_transaction_id`. Never mutate original `deposit_credit`.

---

## Phase C — Done page (backend small change)

Update `GET /api/wallet/deposit/done` HTML in `deposit.ts`:

**Copy:**
> Payment recorded. Your wallet will update after verification.

**Primary app link (after custom scheme fallback):**
```text
https://walkchamp.app/payment-complete?status={status}&transaction_id={tid}
```

Keep `globalwalkerleague://payment-complete?...` as fallback.

---

## Coolify cash env (current deploy)

Sandbox testing (preferred until legal/provider done):

```env
CASH_FEATURES_ENABLED=true
FEATURE_CASH_FEATURES=true
ENABLE_BULLMQ_WEBHOOK_PROCESSING=true
PAYMENTS_LIVE_MODE=false
REAL_MONEY_PROVIDER_SANDBOX_TESTED=true
REAL_MONEY_PRODUCTION_APPROVED=false
REAL_MONEY_LEGAL_APPROVED=false
REAL_MONEY_KYC_TAX_READY=false
REAL_MONEY_WITHDRAWAL_CONTROLS_READY=false
```

**Backend request:** require full `REAL_MONEY_*=true` only when `PAYMENTS_LIVE_MODE=true`, so sandbox card testing does not require fake legal approvals.

Live money (only after Stripe verification, Razorpay KYC, provider + legal signoff):

```env
PAYMENTS_LIVE_MODE=true
REAL_MONEY_PRODUCTION_APPROVED=true
REAL_MONEY_LEGAL_APPROVED=true
REAL_MONEY_KYC_TAX_READY=true
REAL_MONEY_PROVIDER_SANDBOX_TESTED=true
REAL_MONEY_WITHDRAWAL_CONTROLS_READY=true
```

Frontend mirrors live mode with `EXPO_PUBLIC_PAYMENTS_LIVE_MODE`.

## Phase D — Launch gates (backend + ops)

### D1. Feature flags (extend `feature_flags` table)

| Key | Purpose |
|-----|---------|
| `cash_deposits_enabled` | Wallet top-up only |
| `cash_challenges_enabled` | Paid join |
| `cash_prizes_enabled` | Prize credit |
| `cash_withdrawals_enabled` | Cash-out |

Support env override: `FEATURE_CASH_DEPOSITS_ENABLED=true`

### D2. Geofencing middleware

Before deposit + paid join:

- Block states/countries from config table `cash_jurisdiction_rules`
- Return `403` with `code: 'CASH_GEO_BLOCKED'`

### D3. Spending limits

Per user per day/month on `POST .../create-payment-intent` and `create-order`.

### D4. Tax / KYC (before cash-out)

- Collect W-9 / PAN where required before `POST /api/wallet/withdraw`
- Prize thresholds → `requires_review` prize credits

### D5. Provider approval docs

Store in internal wiki (not repo):

- Stripe business description: skill-based walking contests, wallet prefunding
- Razorpay KYC category alignment
- Apple Guideline 5.3 / real-money compliance memo

---

## API contract for frontend (after Phase A/B)

`GET /api/wallet/transactions` should return:

```json
{
  "transactions": [{
    "id": "uuid",
    "type": "deposit",
    "ledgerType": "deposit_credit",
    "amount": 5.00,
    "description": "Deposit via Stripe — $5.00",
    "status": "completed",
    "date": "2026-07-08T10:00:00.000Z"
  }]
}
```

`GET /api/wallet/deposit/status/:id` may return new statuses: `requires_review`, `settlement_error`, `expired` — mobile already handles these.

---

## Files to touch (backend)

| File | Changes |
|------|---------|
| `src/lib/settleDeposit.ts` | **New** |
| `src/routes/deposit.ts` | Stripe/Razorpay/done page |
| `src/worker.ts` | Reconciliation cron |
| `src/routes/races.ts` | Prize credit ledger |
| `src/routes/wallet.ts` | `ledgerType` in tx response, summary fields |
| `db/migrations/0009_payment_ledger.sql` | **New** |
| `db/src/schema/wallets.ts` | Enum + columns |

**No changes required** to mobile API paths for deposits.
