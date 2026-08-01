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
| `ADMIN_TEST_ALLOW_PDV_SALE` | no | Set `1` to create a real balcão sale (mutates stock/orders) |
| `ADMIN_TEST_UI_URL` | for UI | Storefront origin including mount path, e.g. `https://….vercel.app/loja` |

\* Fallbacks: `VITE_API_BASE_URL` for API base; `VITE_TENANT_SLUG` for tenant.  
Missing required vars → **exit 1** (no silent skip / green pass).

WhatsApp: suite calls `GET /status` and `GET /connection-events` only — **does not** scan QR / connect.

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
$env:ADMIN_TEST_EMAIL="admin@example.com"
$env:ADMIN_TEST_PASSWORD="…"
$env:ADMIN_TEST_TENANT="your-tenant-slug"
# optional:
$env:ADMIN_TEST_DATABASE_URL="postgres://…"
npm run test:admin
```

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
