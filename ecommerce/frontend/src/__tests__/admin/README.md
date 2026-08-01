# Admin panel test module

Covers admin screens (Login, Pedidos, PDV, Produtos, Relatórios, Configurações, Motoboys/CRM plan gates, onboarding) with unit, API/integration (mocked), and usability/flow tests. No production credentials required for CI.

## How to run

From `ecommerce/frontend`:

```bash
npm run test:admin          # full admin suite
npm run test:admin:unit     # pure helpers / validators / PDV math / plan gating
npm run test:admin:api      # mocked CRUD + async handlers
npm run test:admin:flow     # Testing Library flows (product → PDV, WA history, etc.)
npm run test:admin:schema   # migration/schema assertions (+ optional live DB)
npm test                    # entire Vitest suite (includes legacy tests/)
```

Optional live checks (never required for CI — no prod credentials):

```bash
# Windows PowerShell — DB column probe (needs `npm i -D pg`)
$env:ADMIN_TEST_DATABASE_URL="postgres://..."
node src/__tests__/admin/schema/live-schema-check.mjs

# Concurrent smoke against local/staging API
$env:ADMIN_SMOKE_BASE_URL="http://localhost:8080"
npm run test:admin:smoke
```

## Layout

| Path | What |
|------|------|
| `unit/` | Pure helpers: PDV cart/search, product validators, plan gating, WA timestamps |
| `api/` | Mocked `admin`/`pdv` CRUD + connection-events |
| `flow/` | UI: create product → PDV finds it; WA history render vs empty vs schema error |
| `schema/` | Assert migration SQL defines required tables/columns; optional live `\d` checks |
| `smoke/` | Lightweight Node concurrent fetches (opt-in via env) |

## Conventions

- Mock `fetch` / services — never hit production.
- WhatsApp history: if the API returns events, UI **must** show formatted timestamps; schema/404 must show a clear error (not “Nenhuma conexão ainda”).
- PDV product list must use the same tenant-scoped source as admin product create (Railway JWT → `/api/pdv/products`).
