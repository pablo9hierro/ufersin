# Contratos Resolutoo (checkbox) × PandaDoc opcional

## Estratégia de produto (produção)

| O quê | Como |
|-------|------|
| Contrato do **lojista** em `/assinar` | **Somente checkbox** (`platform_subscription`) — links para `/politicas-de-privacidade/plano-essential` e `/lojista`. **Sem** e-sign / redirect PandaDoc |
| Consentimento **cliente** no checkout | **Só checkbox** (`compra_normal` / `mais18`) — nunca cria doc PandaDoc |
| Código / env PandaDoc | **Inerte / opcional** — não bloqueia assinatura se template ou webhook estiverem vazios |

## Fluxos

1. **`/assinar`**: checkbox obrigatório → registra aceite local (`POST /api/contratos/accept`) → pagamento MP/Abacate. Sem sessão PandaDoc.
2. **Onboarding / Meu plano**: `vende_mais_18`.
3. **Checkout `/loja`**:
   - Sem `vende_mais_18` → sem idade; checkbox compra normal
   - Com `vende_mais_18` → idade obrigatória + checkboxes compra normal + mais18

## Env (`ufersin-api` no Railway — opcional)

Para o fluxo checkbox-only de produção, estas variáveis podem ficar **vazias** (ou ser removidas depois):

```
PANDADOC_API_KEY=                 # opcional (sandbox/dev)
PANDADOC_API_BASE=https://api.pandadoc.com
PANDADOC_SANDBOX=true
PANDADOC_PLATFORM_TEMPLATE_ID=    # vazio = OK (sem e-sign)
PANDADOC_WEBHOOK_SHARED_KEY=      # vazio = webhook não usado / sem verificação
```

Assinatura do plano **não** depende de template nem de webhook PandaDoc.

## Webhook PandaDoc (só se reativar e-sign no futuro)

- **URL:** `https://<public-ufersin-api-host>/api/webhooks/pandadoc`
  - Ex. produção: `https://ufersin-api-production.up.railway.app/api/webhooks/pandadoc`
- Sem `PANDADOC_WEBHOOK_SHARED_KEY`, o endpoint permanece disponível mas a verificação HMAC não se aplica de forma útil ao fluxo atual (checkbox).

## Template de cláusulas

Texto completo (PT-BR, regra dos 7 dias + disponibilidade / SLA 3h): `docs/pandadoc-template-plano-essential.md`  
PDF / MD para arquivo interno: `scripts/generate-essential-contract-pdf.py` →  
`C:\Users\pablo\Documents\resolutoo-contrato-plano-essential.pdf` e `.md`

## API

- `GET /api/public/contratos/pandadoc/status` — enabled / sandbox / platform ready (sem secrets); informativo
- `GET /api/public/contratos/catalog`
- `POST /api/contratos/accept` — aceite lojista (**checkbox** — caminho de produção)
- `POST /api/public/contratos/accept-checkout` — aceite cliente (checkbox only)
- `POST /api/contratos/pandadoc/session` — stub opcional; **não** usado pelo frontend de `/assinar`
- `GET /api/contratos/me` — vias do lojista
- `POST /api/webhooks/pandadoc` — webhook opcional (contrato lojista, se e-sign for reativado)
