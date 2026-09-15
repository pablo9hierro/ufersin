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

### 9.1 — Vestígios de "VR Tech"
Fallbacks hardcoded ('VR TECH') em `EletronicaLogo.tsx`, `EletronicaHome.tsx`
e `EletronicaLoja.tsx`, e um ícone Cloudinary herdado do port
(`EletronicaHome.tsx`/`EletronicaCatalogoServico.tsx`) trocados por
"Resolutoo Assistência" e um SVG inline (data URI) na paleta Resolutoo.
`seed.rs` renomeia o tenant (com backfill idempotente pro já seedado).

### 9.2 — Ícone de casa
Removido de `EletronicaAdminLayout.tsx`; a logo (já exibida ali) virou o
próprio link clicável pro índice do painel.

### 9.3 — Copy da vitrine
Headline/subtítulo de `EletronicaHome.tsx` reescritos, mesmo layout.

### 9.4 — Catálogo pobre
Causa raiz real: `eletronicos.service_catalog_items` (lida por
PDV/CatalogSearch e pela vitrine de reparo via
`eletronicosAdmin.catalogItems.list()`) nunca foi seedada -- só a tabela
genérica `services` (não usada por esses componentes) tinha os "~5
serviços". Adicionados 14 itens de reparo em 6 marcas / 10 modelos, +4
acessórios.

### 9.5 — Kanban sem "Em diagnóstico"
Statuses seedados nunca incluíam `aguardando_diagnostico`/
`diagnostico_enviado` (os dois que caem na coluna "Em diagnóstico" em
`EletronicaAdminDashboard.tsx::STATUS_GROUP`). Adicionados 2 requests
nesses status + `eletronicos.service_diagnostics` preenchido pra eles e
pro card "Em reparo", + `eletronicos.service_orders` com checklist
parcial pro card em reparo.

### 9.6 — Mapa de rastreio ao vivo (deslocamento) -- NÃO IMPLEMENTADO
Investigado: `EletronicaServicoDeslocamento.tsx` é comprovadamente só um
formulário de configuração (preço/km, endereço da loja) -- o próprio
comentário original do arquivo já dizia "Gap disclosed: nada consome esse
valor ainda". Não existe nenhum mapa nessa tela hoje; a afirmação do dono
de que "já existe" não bate com o código. O componente de mapa real
(`components/map/DeliveryTrackingMap.tsx`, usado em
`pages/motoboy/MotoboyCorrida.tsx`) existe e funciona, mas é acoplado ao
tipo `Order`/`orderService.trackDeliveryPosition` (rastreio via Supabase
do ecommerce) -- reaproveitá-lo pro schema `eletronicos.service_requests`
exigiria uma tabela/endpoint de posição próprios (trabalho de backend
não-trivial). Não implementado nesta rodada por escopo/tempo -- ver
relatório da sessão para a recomendação de próximo passo.

### 9.7 — PDV não funcionava
Investigado: o código de `EletronicaAdminPdv.tsx` e das rotas
`/api/admin/eletronicos/pdv/*` no backend está correto -- os botões têm
handlers, os endpoints existem. A causa real é a mesma da 9.4: o catálogo
de reparo estava vazio, então `CatalogSearch` não tinha o que
buscar/adicionar, e o carrinho nunca saía de vazio (por isso "Finalizar
venda" parecia travado e os botões de pagamento, que só renderizam depois
do checkout abrir, pareciam não existir). Além disso, o Pix sempre falhava
("loja sem Mercado Pago conectado", real -- a demo não tem conta MP de
verdade) -- mesmo tratamento da Parte 3 aplicado em `eletronicosAdminApi.ts`
pra esse tenant seedado.

### 9.8 — Página Fiscal removida
Rota e item de menu removidos de `App.tsx`/`EletronicaAdminLayout.tsx`.

### 9.9 — WhatsApp "conectado" na Conta
`EletronicaAdminConta.tsx` passa um `api` fake (`DEMO_WHATSAPP_API`) pro
mesmo `WhatsAppConnection` genérico quando `isSeededDemoTenant()`, sem UI
nova.

### 9.10 — Performance de navegação
Investigado: `lazyWithReload.ts` não tinha nenhum prefetch -- cada rota é
um chunk JS separado baixado só depois do clique. `tenantConfig` já era
cacheado corretamente (fetch único no mount do layout, que não desmonta
entre navegações). Fix: prefetch do chunk no hover/touch de cada item do
menu (`EletronicaAdminLayout.tsx`). Não medido em produção nesta sessão
(sem deploy) -- ganho real depende da latência de rede até o CDN de cada
chunk.
