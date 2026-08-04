# Contratos Resolutoo × PandaDoc

## Estratégia atual (1 lojista / Free)

| O quê | Como |
|-------|------|
| Conta PandaDoc | **Free + Sandbox** pra desenvolver ([pricing API](https://www.pandadoc.com/developer-api/pricing/)) |
| Contrato do **lojista** | PandaDoc em `/assinar` (`platform_subscription`) — e-sign quando chave+template existirem; senão **checkbox** |
| Consentimento **cliente** no checkout | **Só checkbox** (`compra_normal` / `mais18`) — **nunca** cria doc PandaDoc (não gasta cota) |

## Fluxos

1. **`/assinar`**: checkbox obrigatório → registra aceite local → (opcional) tenta sessão PandaDoc do lojista → pagamento MP/Abacate.
2. **Onboarding / Meu plano**: `vende_mais_18`.
3. **Checkout `/loja`**:
   - Sem `vende_mais_18` → sem idade; checkbox compra normal
   - Com `vende_mais_18` → idade obrigatória + checkboxes compra normal + mais18

## Env (`ufersin-api` no Railway — setar manualmente)

```
PANDADOC_API_KEY=                 # Free/Sandbox key do Dev Center
PANDADOC_API_BASE=https://api.pandadoc.com
PANDADOC_SANDBOX=true
PANDADOC_PLATFORM_TEMPLATE_ID=    # único template: contrato lojista (após criar no PandaDoc)
PANDADOC_WEBHOOK_SHARED_KEY=      # shared key do webhook (ou PANDADOC_WEBHOOK_SECRET)
# NÃO usar PandaDoc no checkout — sem env de template de checkout de propósito.
```

## Webhook PandaDoc

- **URL:** `https://<public-ufersin-api-host>/api/webhooks/pandadoc`
  - Ex. produção: `https://ufersin-api-production.up.railway.app/api/webhooks/pandadoc`
- **Nome sugerido no Dev Center:** `pandadoc-contract`
- **Eventos recomendados:** `recipient_completed`, `document_state_changed`, `document_updated`
- Assinatura HMAC-SHA256 no query `?signature=` (verificação se shared key estiver setada)
- Atualiza `contract_documents` (status / `signed_at`) de forma idempotente; registra aceite `pandadoc_webhook`

## Template de cláusulas

Texto completo (PT-BR, regra dos 7 dias): `docs/pandadoc-template-plano-essential.md`  
PDF para upload: gerar com `scripts/generate-essential-contract-pdf.py` → `C:\Users\pablo\Documents\resolutoo-contrato-plano-essential.pdf`

## API

- `GET /api/public/contratos/pandadoc/status` — enabled / sandbox / platform ready (sem secrets)
- `GET /api/public/contratos/catalog`
- `POST /api/contratos/accept` — aceite lojista (checkbox)
- `POST /api/public/contratos/accept-checkout` — aceite cliente (checkbox only)
- `POST /api/contratos/pandadoc/session` — **apenas** `kind=platform_subscription`
- `GET /api/contratos/me` — vias do lojista
- `POST /api/webhooks/pandadoc` — webhook PandaDoc (contrato lojista)

Sandbox PandaDoc: watermark + destinatários no seu domínio. Produção Free: ~60 docs/ano enviados — suficiente se só o lojista assina o contrato da plataforma.
