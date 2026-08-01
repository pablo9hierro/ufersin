# Admin panel tests

## Default: live (real API)

```bash
cd ecommerce/frontend
npm run test:admin          # = test:admin:live — real HTTP, real JWT
npm run test:admin:live:ui  # optional Playwright against ADMIN_TEST_UI_URL
```

Requires env credentials — **fails if missing** (no silent skip). See [`tests/admin-live/README.md`](../../../tests/admin-live/README.md).

| Env | Purpose |
|-----|---------|
| `ADMIN_TEST_BASE_URL` / `ECOMMERCE_API_URL` | ecommerce-api origin |
| `ADMIN_TEST_EMAIL` / `ADMIN_TEST_PASSWORD` | admin login |
| `ADMIN_TEST_TENANT` | tenant slug |
| `ADMIN_TEST_DATABASE_URL` | optional DB row asserts |
| `ADMIN_TEST_ALLOW_PDV_SALE=1` | optional real balcão sale |
| `ADMIN_TEST_UI_URL` | optional Playwright storefront |

## Offline mocks (not enough alone)

```bash
npm run test:admin:mock     # Vitest unit/api/flow/schema helpers
npm run test:admin:unit
npm run test:admin:api
npm run test:admin:flow
npm run test:admin:schema
```

These do **not** replace live CRUD / PDV / Conta checks.
