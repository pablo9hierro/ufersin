# Admin live tests (real API / DB / optional UI)

**No mocks.** These scripts hit a real ecommerce-api (Railway or local), authenticate with a real admin JWT, exercise CRUD and PDV list, optionally verify Postgres rows, and optionally drive Playwright against a real `/loja` admin UI.

Mock Vitest helpers under `src/__tests__/admin/` are **not** the default path — use `npm run test:admin:mock` only for offline unit math.

## Required environment

Set in the shell or `ecommerce/frontend/.env.local` (**never commit secrets**):

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_TEST_BASE_URL` or `ECOMMERCE_API_URL` | yes* | API origin, e.g. `https://….up.railway.app` or `http://localhost:8080` |
| `ADMIN_TEST_EMAIL` | yes | Admin email for the test tenant |
| `ADMIN_TEST_PASSWORD` | yes | Admin password |
| `ADMIN_TEST_TENANT` | yes* | Tenant slug (`tenant_slug` on login) |
| `ADMIN_TEST_DATABASE_URL` | no | Postgres URL — when set, asserts product rows after create/delete (`npm i -D pg`) |
| `ADMIN_TEST_ALLOW_PDV_SALE` | no | Set `1` to also create a real cash balcão sale |
| `ADMIN_TEST_WA_PHONE` | no | Digits for Pix charge + confirmation WA asserts (no QR-login) |
| `ADMIN_TEST_UI_URL` | for UI | Storefront origin including mount path, e.g. `https://….vercel.app/loja` |

\* Fallbacks: `VITE_API_BASE_URL` for API base; `VITE_TENANT_SLUG` for tenant.  
Missing required vars → **exit 1** (no silent skip / green pass).

WhatsApp: suite calls `GET /status`, `GET /connection-events`, and (when `ADMIN_TEST_WA_PHONE` is set) `notify-pix-charge` / `notify-sale` — **does not** scan QR / connect.

**PDV Pix** always runs: creates a Pix balcão sale, then `POST /api/orders/{id}/create-pix-payment` (and `?force=1`). Suite **fails** on HTTP 405 or missing `pix_copia_cola`.

### Tenants

| Tenant | Notes |
|--------|--------|
| `resolutoo-demo` | Seed: `admin@resolutoo-demo.com` / seed password from `ecommerce/backend/src/seed.rs` (local/dev) |
| `resusu` | Live store on resolutoo.com/loja — use real admin email/password via env (never commit) |

## Run

```bash
cd ecommerce/frontend

# Default admin path = live HTTP suite
npm run test:admin
# same:
npm run test:admin:live

# Optional Playwright page smoke (needs playwright + ADMIN_TEST_UI_URL)
npm i -D playwright
npx playwright install chromium
npm run test:admin:live:ui

# Offline mocked unit/helpers only (not sufficient alone)
npm run test:admin:mock
```

PowerShell example:

```powershell
$env:ADMIN_TEST_BASE_URL="https://your-api.up.railway.app"
$env:ADMIN_TEST_EMAIL="admin@resolutoo-demo.com"
$env:ADMIN_TEST_PASSWORD="…"
$env:ADMIN_TEST_TENANT="resolutoo-demo"
# optional:
$env:ADMIN_TEST_DATABASE_URL="postgres://…"
npm run test:admin
```

Use the seeded demo tenant slug **`resolutoo-demo`** (see `ecommerce/backend/src/seed.rs`) unless you intentionally target another tenant.
## What it covers

1. **Login** — `POST /api/auth/admin/login` → JWT  
2. **Categories** — create / list / delete (`TEST_*` names)  
3. **Products** — create (barcode) / list / get / update / delete  
4. **Produtos → PDV** — after create, `GET /api/pdv/products` must include the product  
5. **Orders** — list  
6. **Relatórios** — financeiro + lucro  
7. **Conta** — store-status, store-hours save, onboarding-gate  
8. **WhatsApp** — status + connection-events (timestamps when events exist)  
9. **Cleanup** — deletes this run’s `TEST_*` rows and sweeps leftovers  

## Files

| Path | Role |
|------|------|
| `run.mjs` | Main live HTTP suite |
| `ui-playwright.mjs` | Optional real-page clicks |
| `lib/loadEnv.mjs` | Env load + hard fail if missing |
| `lib/client.mjs` | Real `fetch` client |
| `lib/db.mjs` | Optional Postgres asserts |
| `lib/assert.mjs` | Assertions |
