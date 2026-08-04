# Mercado Pago webhooks (Assinar / platform subscriptions)

On-site Pix and card charges for Resolutoo plans go through Mercado Pago
**Payments API** (`POST /v1/payments`). Activation must flip the subscriber
from `pendente` / `aguardando_pagamento` → `ativo` / `aguardando_onboarding`
(or `provisionado` if the store already exists) **as soon as MP reports
approved** — without relying on the browser staying open.

## Production webhook URL (set in MP dashboard)

```
https://ufersin-api-production.up.railway.app/api/webhooks/mercadopago
```

In [Mercado Pago Developers](https://www.mercadopago.com.br/developers/panel) →
**Your integrations** → application used by Resolutoo (Resolutoo / APP_USR) →
**Webhooks**:

1. Production URL: the URL above  
2. Events: **Payments** (`payment` created / updated)  
3. Save

Also configure the **same URL** for the test application if you use TEST tokens.

## How activation works (defense in depth)

| Path | When |
|------|------|
| `POST/GET /api/webhooks/mercadopago` | MP notifies; API re-fetches payment with `MP_ACCESS_TOKEN` and activates |
| Per-payment `notification_url` | Set on Pix/card create when `PUBLIC_API_URL` or `RAILWAY_PUBLIC_DOMAIN` is set |
| `GET /api/assinaturas/{id}/status` | Browser poll on Assinar / Obrigado |
| `GET /api/me` | Re-checks pending charges when the lojista opens Meu plano |

The webhook **never trusts the body alone** — it always GETs
`/v1/payments/{id}` with the platform access token before flipping status.

## Env

| Var | Role |
|-----|------|
| `MP_ACCESS_TOKEN` | Production `APP_USR-…` (or `TEST-…` in sandbox) |
| `PAYMENT_MODE=production` | Live charges |
| `PUBLIC_API_URL` | Optional override, e.g. `https://ufersin-api-production.up.railway.app` |
| `RAILWAY_PUBLIC_DOMAIN` | Auto-set by Railway — used to build `notification_url` if `PUBLIC_API_URL` empty |

## Local smoke

```bash
curl -X POST "http://localhost:8081/api/webhooks/mercadopago" \
  -H "Content-Type: application/json" \
  -d '{"action":"payment.updated","type":"payment","data":{"id":"PAYMENT_ID"}}'
```

Expect HTTP 200. If the payment is `approved` and `external_reference` matches a
subscriber id (or `mp_preapproval_id` is `mpix-…` / `pay-…`), that row becomes
`ativo`.
