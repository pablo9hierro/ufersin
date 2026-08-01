# ecommerce/ — motor multi-tenant (cópia do Sunset)

Este diretório é uma **cópia** do código do ecommerce single-tenant original
(`C:\Users\pablo\Documents\juite` — backend Rust+Axum, frontend React,
`supabase/*.sql`). O Sunset original e o vrtech continuam existindo
exatamente como estão, em seus próprios repositórios, e nunca recebem
nenhuma mudança deste refactor — essa cópia é a base sobre a qual o motor
multi-tenant do UFERSIN é construído, por decisão explícita (ver histórico
da conversa: "Sunset e vrtech permanecem onde estão, nunca obedecem à
lógica do ufersin").

## O que já está pronto (Fase 1A — fundação)

- **Schema de tenancy** (`backend/migrations/0005_tenancy.sql`): entidades
  `organizations`, `tenants`, `plans`, `features`, `plan_features`,
  `feature_flags`, `subscriptions`, `roles`, `permissions`,
  `role_permissions` — mais `tenant_id` em toda tabela que já existia
  (`admins`, `motoboys`, `customers`, `categories`, `products`, `orders`,
  `order_items`), com os planos ESSENTIAL/MANAGEMENT/PREMIUM (R$60/R$250/
  R$350) e o mapeamento de features de cada um, exatamente como
  especificado.
- **Backend Rust inteiro retrofitado** — todo handler em
  `backend/src/routes/{admin,motoboy,public,webhooks,auth}.rs` agora
  resolve o tenant da requisição e filtra/isola por `tenant_id` em toda
  query. Nenhuma funcionalidade foi removida ou reescrita — é a mesma
  lógica de sempre (catálogo, motoboy, financeiro, Pix, WhatsApp, cupons)
  só que sabendo de qual loja ela é.
- **Feature flags** (`backend/src/features.rs`): `Feature` é um enum único,
  todo o código de cada funcionalidade continua existindo pra qualquer
  plano — só fica bloqueado por `require_feature(...)` (403) quando o
  plano/tenant não inclui aquele recurso. Nunca há três builds/páginas
  diferentes.
- **Branding por tenant, não mais global**: `EVOLUTION_INSTANCE` e
  `STORE_PICKUP_ADDRESS` eram env vars GLOBAIS antes desse refactor — ou
  seja, o sistema de origem só suportava mesmo uma loja por natureza. Agora
  são colunas de `tenants` (`whatsapp_instance`, `pickup_address`), assim
  como o nome da loja usado nas mensagens de WhatsApp/Pix (antes hardcoded
  o nome da loja demo em várias strings — corrigido).
- **Google Routes API**: já era uma única chave global compartilhada
  (`GOOGLE_ROUTES_API_KEY`) antes mesmo desse refactor — comportamento
  mantido, exatamente como pedido ("nunca criar chave por loja").
- **Login sabe de tenant**: `POST /api/auth/admin/login` e
  `/api/auth/motoboy/login` agora exigem `tenant_slug` no corpo (email só é
  único DENTRO de um tenant agora, não mais globalmente) — o JWT emitido
  carrega `tenant_id`. Isso é um "selo de tenant" explícito por enquanto,
  já preparado pra virar automático quando existir roteamento por
  subdomínio (ver plano original do ufersin).
- **Banco local, sem Supabase**: `backend/docker-compose.yml` sobe um
  Postgres local na porta 5433. `backend/.env` já aponta pra ele. Rodando
  `cargo run` de dentro de `backend/`, as migrations (incluindo a nova
  0005) e o seed (`backend/src/seed.rs`) criam um tenant de demonstração
  ("Resolutoo Demo", slug `resolutoo-demo`) com assinatura Premium ativa —
  então tudo funciona igual ao sistema original, só que dentro da nova
  arquitetura.
- **RLS desenhado, não ainda forçado**: toda tabela de tenant tem política
  de Row Level Security escrita e habilitada, mas não com `FORCE` — porque
  localmente o backend conecta como dono das tabelas, e algumas buscas
  (login por slug, resolver tenant a partir de um pedido/instância de
  WhatsApp) precisam necessariamente enxergar mais de um tenant ANTES de
  saber qual é o tenant. Isso vira a defesa PRINCIPAL quando este schema for
  pro Supabase (onde o frontend fala direto com o Postgres como
  anon/authenticated) — motivo detalhado no cabeçalho da própria migration.

## O que ainda falta (Fase 1B — não fizemos ainda, de propósito)

O Sunset real tem ~14.300 linhas de SQL em `supabase/*.sql` (71 arquivos:
CRM, campanhas, cupons, segmentação, PDV, financeiro avançado, layout de
página) que hoje são chamadas DIRETO do frontend via Supabase RPC,
contornando esse backend Rust inteiramente. Essa camada:

- Foi **copiada integralmente e sem alteração nenhuma** pra
  `ecommerce/supabase/` (nada removido, nada reescrito).
- **Ainda não tem `tenant_id`** nem política de RLS de tenant — continua
  sendo, estruturalmente, single-tenant.
- Não foi tocada de propósito: fazer isso direito significa ler cada uma
  das 71 funções (muitas são patches incrementais sequenciais sobre as
  mesmas funções, então "o estado atual" não é a soma dos arquivos, é o
  resultado final de aplicá-los em ordem) e decidir, função a função, se
  RLS sozinho resolve ou se a função precisa de um parâmetro
  `p_tenant_id` explícito (funções `SECURITY DEFINER`, usadas bastante
  aqui, ignoram RLS da role chamadora por padrão). Fazer isso apressado é
  exatamente o tipo de erro que vaza dado de um tenant pro outro — o
  ponto inteiro desse projeto é isolar tenants, então essa parte precisa
  ser feita com calma, não com pressa.
- Duas funções que o Rust já chama por nome hoje (`motoboy_start_run`,
  `sunset._create_customer_reset_code`) não existem nas migrations locais
  ainda por esse motivo — os handlers que dependem delas
  (`routes/motoboy.rs::start_run`,
  `routes/public.rs::request_customer_password_reset`) estão com um
  comentário `NOTE (Fase 1B pendente)` marcando exatamente isso; o resto
  de cada uma dessas duas funções (resolver o tenant, otimizar rota) já
  está correto e funcionando.

**Frontend** (`ecommerce/frontend/`, 97 arquivos): copiado integralmente,
ainda não tem um `TenantProvider`/`usePlan()` nem gating de feature flag
nas telas de admin (funcionários, motoboy, banner, CRM) — combinado
também pra ficar pra depois, já que o pedido original marcou
explicitamente "ainda não criar dashboard" nesta etapa.

## Integração com a plataforma Rodoletas (feito)

O que vende esse motor (landing, cadastro do lojista, cobrança, painel do
assinante, onboarding) é uma aplicação SEPARADA — vive em `ufersin/backend`
e `ufersin/frontend` (rebrandizada pra "Rodoletas"), não aqui dentro de
`ecommerce/`. A integração entre os dois já existe:
`routes/internal.rs::provision_tenant` (`POST /internal/provision-tenant`,
autenticado por `INTERNAL_API_KEY` — nunca chamado pelo navegador) recebe a
chamada da Rodoletas no fim do onboarding do lojista e cria
Organization + Tenant + Subscription + o admin da loja numa transação só.
O admin nasce com o MESMO hash de senha (Argon2) da conta Rodoletas do
lojista — nenhuma senha em texto puro trafega entre os dois backends.

**Limitação conhecida:** login de admin no frontend deste motor
(`ecommerce/frontend/src/pages/admin/AdminLogin.tsx`) chama
`supabase.rpc('admin_login', ...)` — a RPC do Supabase, não o endpoint JWT
Rust (`routes/auth.rs`) — e essa RPC ainda não é tenant-aware (é Fase 1B,
ver acima). Então mesmo com o admin já corretamente provisionado com a
senha certa, login multi-tenant de verdade só passa a funcionar quando
`sunset_admin_auth.sql` for portado.
