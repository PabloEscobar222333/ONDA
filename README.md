# ONDA API

Backend for the ONDA mobile app. Node 20 + Hono + Postgres (Drizzle) + pg-boss.

Payment-rail integration (Paystack) is intentionally deferred — every payment is recorded as a manual entry and confirmed by the other party. The `paystack_reference` and `card`/`bank_transfer` slots are reserved in the schema so wiring up the rail later is a single feature flag.

## Quick start

```bash
cp .env.example .env
# edit DATABASE_URL, FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_JSON

npm install
npm run db:generate
npm run db:migrate
npm run dev
```

The server listens on `http://localhost:8080/v1`. Health check at `GET /v1/health`.

Authentication is owned by Firebase Auth (Google / Apple / Email-Password). The backend verifies the client's Firebase ID token via Firebase Admin and identifies the user by Firebase UID. `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT_JSON` are required for the server to boot.

## Wiring up the Expo app

In `onda-app/`, set:

```
EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:8080/v1
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<from Firebase Console → Authentication → Google → Web SDK config>
```

## Endpoint surface

All responses use the envelope `{ success: boolean, data?, message? }`.

### Auth
- `POST /v1/auth/sync` — called by the client immediately after any Firebase sign-in. Verifies the ID token, upserts a `users` row keyed by Firebase UID, refreshes provider metadata, returns `{ user, isNewUser, needsRoleSelection }`.
- All other endpoints require a `Bearer <Firebase ID token>` header.

### Users (auth required)
- `GET /v1/users/me`
- `PATCH /v1/users/role` `{ roles: ['merchant'|'customer'] }`
- `PATCH /v1/users/profile` `{ fullName }`
- `GET /v1/users/lookup?phone=+233…`
- `PATCH /v1/users/notification-preferences`
- `PATCH /v1/users/privacy` `{ privacyVisible }`
- `POST /v1/users/fcm-token` `{ fcmToken }`
- `GET /v1/users/:customerId/profile` (merchant view of a customer)

### Merchant
- `GET /v1/merchant/dashboard`
- `GET /v1/merchant/customers?filter=…`
- `GET /v1/merchant/transactions?period=…`
- `GET /v1/merchant/export/pdf`
- `POST /v1/merchant/verify-momo` / `POST /v1/merchant/verify-bank` (stubbed — returns `verified: false`)
- `PATCH /v1/merchant/settlement`
- `POST /v1/merchant/onboarding/business-info`
- `POST /v1/merchant/onboarding/kyc` `{ ghanaCardNumber, selfieBase64 }`
- `POST /v1/merchant/onboarding/activate`

### Credit events
- `POST /v1/credit-events` (merchant only; enforces tier-1 GHS 2000 cap)
- `GET /v1/credit-events?status=…&customerId=…`
- `GET /v1/credit-events/:id` → `{ event, payments }`
- `POST /v1/credit-events/:id/remind` (1/24h cap, returns 429 otherwise)
- `POST /v1/credit-events/:id/accept`

### Payments
- `POST /v1/payments/manual` — customer reports a payment (`mtn_momo` / `telecel_cash` / `airteltigo` / `bank_transfer`). Status `pending` until merchant confirms.
- `POST /v1/payments/cash` — merchant records initial cash deposit. Status `pending` until customer confirms within 48h, then expires.
- `POST /v1/payments/:paymentId/confirm` — confirms a pending payment. Manual → confirmed by merchant. Cash initial → confirmed by customer.
- `GET /v1/payments/:paymentId/status`

### Customer
- `GET /v1/customer/credit-events?status=active|closed`
- `GET /v1/customer/payments?from=…&to=…&merchantId=…`
- `GET /v1/customer/trust-score`

### Disputes
- `POST /v1/disputes` `{ creditEventId, type, description, raisedBy }`

## Background jobs (pg-boss)

| Cron | Job |
|---|---|
| `*/15 * * * *` | Expire pending payments past their 48h window |
| `0 * * * *` | Mark active events overdue (heuristic — refine when schedule logic ships) |
| `0 1 1 * *` | Snapshot every customer's trust score for the month |

Jobs and the API run in the same process; pg-boss stores queue state in Postgres.

## Deploy

```bash
fly launch --no-deploy        # answer "no" to creating a Postgres now if you want a separate one
fly postgres create --region jnb --name onda-pg --vm-size shared-cpu-1x --volume-size 1
fly postgres attach --app onda-api onda-pg
fly secrets set FIREBASE_PROJECT_ID=onda-XXXX FIREBASE_SERVICE_ACCOUNT_JSON="$(cat path/to/service-account.json)"
fly secrets set HUBTEL_CLIENT_ID=… HUBTEL_CLIENT_SECRET=… SMS_PROVIDER=hubtel
fly secrets set R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_PUBLIC_BASE_URL=…
fly deploy
```

Run migrations once after first deploy:

```bash
fly ssh console -C "node dist/db/migrate.js"
```

## Cost at MVP (Fly + Postgres + R2)

| Item | Cost |
|---|---|
| Fly API machine (`shared-cpu-1x` 256MB, always-on) | ~$1.94/mo |
| Fly Postgres (`shared-cpu-1x` 256MB, 1GB volume) | ~$1.94/mo + $0.15/mo storage |
| Cloudflare R2 (under 10GB) | $0 |
| Expo Push | $0 |
| Hubtel SMS | ~₵0.03 each, pay-as-you-go |
| Sentry free tier | $0 |
| **Total compute** | **~$4/mo** |

## When to wire up Paystack later

1. Add `src/services/paystack.ts` with `initialize`, `verify`, `resolveAccount`, and HMAC webhook verification.
2. Add `POST /v1/webhooks/paystack` to `src/routes/webhooks.ts`; on `charge.success`, look up the payment by `paystackReference`, mark it `confirmed`, and call the same `recalcAndStoreTrustScore` + `notify(...)` already used by manual confirmation.
3. Replace the `merchant/verify-momo` / `verify-bank` stubs with real Paystack `resolveAccount` calls. Cache results 24h.
4. Add `POST /v1/payments/initiate` that creates a `pending` payment row with a Paystack reference and returns `{ reference, authorizationUrl }`.
5. (Optional) Add WebSocket fan-out so the FE doesn't need to poll.

None of this requires schema changes — the columns are already there.
