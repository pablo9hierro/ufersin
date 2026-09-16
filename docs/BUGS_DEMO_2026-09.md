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

---

## Rodada 2026-09-16 — crash-loop do backend + fechamento da checklist

### CRÍTICO — `ecommerce-api` em crash-loop desde a rodada anterior
Causa por que "quase nada" das correções acima apareciam ao vivo, mesmo
com commits certos no `main`: o backend nunca conseguia terminar o boot.
Dois bugs reais, em cadeia, ambos só visíveis rodando de verdade (nenhum
`cargo check`/`tsc` local pega isso):

1. `seed.rs` gravava em `tenants.landing_hero_image_url` (3 lugares) --
   coluna que **nunca existiu** no Postgres do `ecommerce-api`. Foi
   confundida com uma coluna homônima da PLATAFORMA (`subscribers`,
   `backend/migrations/0016`), um banco completamente separado. Todo boot
   falhava no seed, em loop. Fix: `ecommerce/backend/migrations/0069_*.sql`
   (`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS landing_hero_image_url`).
2. Depois de corrigir (1), o backfill do Kanban de `demo-eletronica`
   quebrava tentando inserir status (`aguardando_diagnostico`,
   `diagnostico_enviado`) que o frontend já tratava como reais
   (`EletronicaAdminDashboard.tsx`) mas a `CHECK constraint` da tabela
   (migration `0022`) nunca foi atualizada pra permitir -- drift antigo,
   só exposto agora. Fix: `0070_service_requests_status_diagnostico.sql`.

Também descoberto nesse processo: `railway redeploy` **não** pega commits
novos neste projeto (fica preso no último deployment conhecido) -- é
preciso `railway up` rodado da **raiz** do monorepo (nunca de dentro de
`ecommerce/backend`, senão o path relativo do Root Directory do serviço
quebra o build: `no such file or directory: ecommerce`).

Confirmado ao vivo, direto no Postgres, depois do deploy estabilizar:
`demo-eletronica` tem os 11 status do Kanban com card cada, e 7 vendas
seedadas.

### Hero da vitrine real nunca aparecia (causa raiz diferente da rodada
anterior, essa sim resolvida)
`demo-ecommerce`/`demo-eletronica` são tenants reais mas SEM assinatura na
plataforma -- `tenantConfig.ts::PREVIEW_TENANT_CONFIG` sintetiza os dois
com `plano: 'premium'` fixo (efeito colateral pra destravar outras partes
do painel). Isso zerava `isEssentialStorefront()`, que é o gate que decide
se o card de Hero (`EssentialHeroCard`) aparece nos 3 temas
(`uiux2/3/4/pages/Landing.tsx`) -- o campo `landing_hero_image_url` até
tinha valor, mas o componente nunca renderizava. Fix:
`isEssentialStorefront()` (`demoMode.ts`) agora também libera pra
`isSeededDemoTenant()`. `DEFAULT_CONFIG.landing_hero_image_url` trocado do
Unsplash genérico pra `/brand/hero-ecommerce.svg` (arte própria).

### Bug visual — botão de paleta sobrepondo a barra de navegação
`DemoPaletteSwitcher.tsx` usava `bottom-5` fixo; nos temas
burgerbite/burgerhouse (barra de navegação fixa no rodapé mobile), o botão
ficava por cima. Fix: `bottom-20 right-5 sm:bottom-5`.

### OTP mockado — bug real: login era literalmente impossível na demo
`localApi.ts::customerRequestLoginCode` gerava código de 6 dígitos, mas os
4 modais de auth (`CustomerAuthModal.tsx` + `uiux2/3/4/AuthModal.tsx`,
usados em login/cadastro/checkout) têm input de 4 dígitos
(`maxlength=4`) -- o código gerado nunca cabia, ninguém conseguia logar
na demo. Fix: código fixo `0000` (`DEMO_LOGIN_CODE`), com aviso na tela
("Modo demonstração... use o código 0000").

### Copy "isso é exemplo" estendida
Antes só o hero avisava. Adicionado aviso curto nos destaques (cards tipo
"Entrega rápida"/"Pague com Pix") e nos banners de promoção
(`PromoCarousel.tsx`), nos 3 temas.

### Agendamento mockado no mock ecommerce — investigado, não é aplicável
Confirmado (grep + leitura de `App.tsx::StyleAware`): a vertical
`eletronicos` (única com agendamento de serviço) nunca é roteada pelo mock
genérico de ecommerce (4 planos) -- só existe no tenant real
`demo-eletronica`, que já tem agenda seedada (Parte 9). Não havia feature
nenhuma pra mockar aqui; documentado em vez de inventado.

### Verificação AO VIVO (Playwright real, produção, `pauloferro`) — 2026-09-16
**Veredito: aprovado com ressalvas.** Testado de verdade (screenshots reais
em `C:\Users\pablo\AppData\Local\Temp\claude\...\scratchpad\`, não descrito
de memória): as 4 demos mock (vitrine/login/checkout/admin/vendedor/
motoboy) e a demo real de eletrônica (vitrine + Kanban/PDV/Agenda/
Templates/Conta/Vendas do admin). Confirmado ao vivo: login com código
`0000` funcionando nos 4 planos (token real gravado em `localStorage`),
avisos de "exemplo" visíveis, botão de paleta sem sobreposição em
burgerbite/burgerhouse, todas as 6 telas do admin de eletrônica com dado
real e sem erro de console.

Dois bugs novos encontrados nesse teste, ambos **P2** (não bloqueantes):
- **Vitrine de `demo-eletronica` dispara 401 direto no Supabase**
  (`GET .../rest/v1/page_decorations?...`) -- feature de "decoração de
  página" falhando silenciosamente pra esse tenant (RLS/anon key não
  configurada, ou feature não aplicável). Vitrine funciona visualmente
  mesmo assim. Não corrigido nesta rodada -- fica pra próxima.
- **URL sem o prefixo `/loja`** (`resolutoo.com/demo-entrar?...` em vez de
  `resolutoo.com/loja/demo-entrar?...`) dá página em branco. Nenhum link
  real do site usa a forma errada (confirmado no código), então não afeta
  usuário normal -- só uma armadilha se alguém compartilhar a URL sem o
  prefixo.

Não testado nesta rodada (fora do escopo do pedido, não é bug conhecido):
cadastro (registro) separado do login, finalização de pagamento Pix até o
fim nas demos mock, viewport desktop completo de toda tela, Assistente de
IA no WhatsApp.
