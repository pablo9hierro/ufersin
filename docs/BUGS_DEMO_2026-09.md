# Bugs da demo pública — correções de 2026-09

Registro dos achados e fixes desta rodada (plano `cheerful-gathering-gosling`),
já que não existe hoje nenhum "módulo de bugs" no código. Dois sistemas
diferentes, ambos corrigidos:

- **Demo mock** (`isDemoModeActive()`, 100% client-side, `localApi.ts`/
  `localData.ts`) — Partes 1 a 8 abaixo.
- **Tenant real seedado `demo-eletronica`** (Postgres, `seed.rs`) — Parte 9.

## Parte 1 — `eletronicosAdminApi.ts` cego ao modo demo mock
Causa raiz: `req()` nunca checava `isDemoModeActive()`, sempre batia fetch
real sem token válido → 401 → "sessão expirada" (Mensagens/Template Zap) e
tela quebrada (Agendamentos). Fix: `req()` agora resolve contra
`eletronicosLocalApi.ts` (novo arquivo) quando o mock está ativo, cobrindo
templates, agenda (day/blocks/settings/business-hours) e appointments.

## Parte 2 — Estoque vazio no mock (ecommerce)
`ingredients.list()` sempre devolvia `[]`. Fix: 4 insumos de exemplo +
1 produto `origin_type='erp_formulation'` seedado em `localData.ts`.

## Parte 3 — QR Pix ausente no PDV/demo seedada
`request()` (api.ts) intercepta toda escrita da demo seedada com
`simulateDemoWrite` genérico (sem `pix_copia_cola`). Fix: detecta os paths
`create-pix-payment`/`refresh-payment` e devolve um `pix_copia_cola` fake
em formato EMV, pro `QRCodeSVG` desenhar.

## Parte 4 — Logo e hero da vitrine mock
Novo componente `DemoBrandMark.tsx` (SVG, "R" estilizado com gradiente
rosa/roxo Resolutoo) substitui o `UfersinMark` genérico em `Logo.tsx`
(admin) e `uiux2/components/Shell.tsx` (vitrine). Hero: `DEFAULT_CONFIG`
(tenantConfig.ts) ganhou `landing_hero_image_url` seedada (antes era
sempre `null` no mock, que usa slug vazio → `DEFAULT_CONFIG`).

## Parte 5 — Copy da vitrine mock
Título/subtítulo trocados em `uiux2/uiux3/uiux4/pages/Landing.tsx` pra
deixar claro (linguagem simples) que foto e texto são editáveis pelo
lojista, mantendo tom comercial e tamanho parecido com o original.

## Parte 6 — Hero real de `demo-ecommerce`
`Landing.tsx::BannerCarousel` (plano Premium/Management) só lia
`siteSettings.hero_image_url` (Supabase legado, sem filtro de tenant).
Fix: fallback pra `tenantConfig?.landing_hero_image_url` quando vazio.

## Parte 7 — `/servicos` quebrado na vertical eletrônica
`App.tsx` não passava prop `eletronica` na rota `/servicos`, caindo no
fallback que redireciona pro app externo descontinuado. Fix: passa
`eletronica={Uiux2ServicosCatalogo}` (componente já genérico/tenant-aware).

## Parte 8 — Verificação
`npx tsc -b` rodado após cada rodada de mudança (ver relatório da sessão
pra resultado exato). Não há mudança de contrato front-back nesta rodada
(Partes 1-5 client-side only, Parte 6 só lê campo existente, Parte 7 é só
roteamento).

---

## Parte 9 — Tenant real `demo-eletronica`
Ver commits/relatório da sessão para o detalhamento de cada subitem
(9.1 a 9.10) -- logo/marca, copy da vitrine, catálogo, Kanban, mapa de
deslocamento, PDV, remoção da página Fiscal, status do WhatsApp na Conta,
e performance de navegação do admin.
