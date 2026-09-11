# Arquitetura atual — Resolutoo (ex-Rodoletas/Ufersin)

Documento técnico de handoff (escrito pra dar contexto a outra ferramenta/IA
trabalhando neste repo, ex. Cursor). Reflete o estado real do código nesta
data — não é aspiracional. Onde alguma coisa está pela metade ou é uma
decisão consciente de deixar pra depois, isso está marcado explicitamente.

**Nota de versão (2026-09):** o produto foi rebrandado de "Rodoletas" pra
**Resolutoo** (domínio `resolutoo.com`) — os nomes internos de pasta
(`ufersin/`, `backend`, schema `ufersin` num bootstrap SQL antigo) **não
foram renomeados** e continuam usados como identificador técnico do
monorepo; não confundir com o nome comercial atual. Este documento também
tinha uma seção 2b desatualizada (projeto/schema Supabase errados) —
corrigida nesta revisão a partir do código/SQL real, não de suposição. A
Auth nativa do Supabase descrita no §6 já está implementada (não é mais
"próximo passo") — o texto documenta o desenho porque explica o *porquê*
das decisões, mas o código já reflete isso.

## 1. O que é isto

**Resolutoo** é o SaaS multi-tenant (nome de código interno do monorepo:
`ufersin`) que engloba duas coisas:

1. A própria **plataforma** (`backend`/`frontend` na raiz do monorepo) —
   cadastro, login, cobrança de assinatura, "Meu Plano", onboarding do
   lojista. Ainda referida como "Rodoletas" em código/variáveis antigas.
2. O **motor de e-commerce multi-tenant** que cada loja provisionada roda
   (`ecommerce/`) — uma cópia retrofitada do ecommerce single-tenant
   original (`C:\Users\pablo\Documents\juite`, produção real, nunca tocado
   por este projeto) que passou a suportar N lojas isoladas por
   `tenant_id` em vez de uma só.

São **duas aplicações separadas no mesmo monorepo**, com bancos de dados
diferentes, faladas por pessoas diferentes:

```
ufersin/
├── backend/     Rust+Axum+SQLx — plataforma (Resolutoo, cód. interno
│                "Rodoletas"): cadastro, login, cobrança, dashboard do
│                assinante, onboarding. Porta 8081/8080.
├── frontend/    Vite+React+TS — landing, cadastro, dashboard do assinante
│                (o que o LOJISTA vê antes/durante virar cliente). Porta 5174.
├── ecommerce/
│   ├── backend/   Rust+Axum+SQLx — motor multi-tenant (catálogo, pedidos,
│   │              admin, motoboy, PDV, financeiro, CRM, fiscal — ver §9).
│   │              Porta 8080.
│   ├── frontend/  Vite+React+TS — vitrine + admin + PDV + app motoboy da
│   │              LOJA em si (o que o CLIENTE FINAL e o LOJISTA-JÁ-PAGANTE
│   │              usam no dia a dia). Porta 5173.
│   ├── supabase/  funções PL/pgSQL REALMENTE publicadas no Supabase
│   │              (checkout público, auth de cliente, cupons) — ver §2b.
│   └── supabase-ufersin/  bootstrap SQL de um schema `ufersin` que
│                não está em uso confirmado em produção — ver §2b.
```

Quem NÃO é lojista Resolutoo nunca vê `ufersin/frontend` — só existe pra
vender e gerenciar a assinatura. Depois que a loja está provisionada, o
lojista passa a operar em `ecommerce/frontend/admin` no dia a dia.

## 2. Bancos de dados — dois, sem relação de FK entre eles

Isto é a fonte de confusão mais comum neste projeto, então fica explícito:

### 2a. Postgres local do `ufersin/backend` (plataforma)
- `docker-compose.yml` em `backend/`, porta **5434** em dev local
  (`DATABASE_URL=postgresql://postgres:postgres@localhost:5434/postgres`).
- Uma única tabela relevante: **`subscribers`** (ver §4) — a conta do
  lojista *como assinante da plataforma* (login, plano, status de
  pagamento, dados do onboarding).
- Este backend também fala com o Supabase (§6, `SUPABASE_URL=
  https://migkkrwzykpztrakbfij.supabase.co`) — mas SÓ pra verificar
  JWT de Auth (JWKS público) e pra alguns proxies/consultas fiscais (§9),
  nunca guarda `subscribers` lá.

### 2b. Supabase do motor de e-commerce (projeto "resolutoo", ref `migkkrwzykpztrakbfij`) — corrigido nesta revisão

Confirmado direto pelo `SET search_path` das funções SQL reais em
`ecommerce/supabase/*.sql` (ex. `resolutoo_create_order_tenant_fix.sql`),
não por suposição. Isolamento é feito por **schema**, não por projeto:

- **`sunset`** — schema onde o motor multi-tenant de e-commerce
  (`ecommerce/backend`) efetivamente lê/escreve `products`, `categories`,
  `orders`, `order_items`, `customers`, `admins`, `tenants`,
  `shipping_settings` etc. As migrations SQLx em
  `ecommerce/backend/migrations/*.sql` criam essas tabelas SEM prefixo de
  schema (`CREATE TABLE admins (...)`, `CREATE TABLE customers (...)`) —
  o nome do schema vem do `search_path` da role de conexão configurada no
  Supabase/Railway, não é hardcoded no SQL nem no Rust (`sqlx::query`
  também nunca qualifica schema). **Não confundir com o Sunset original**
  (`C:\Users\pablo\Documents\juite`) — é só o nome do schema herdado dele.
- **`resolutoo`** — schema mais novo, usado por funções RPC PL/pgSQL
  chamadas direto do navegador (`ecommerce/frontend` via
  `supabasePublicApi.ts`, `supabase.rpc(...)`) para fluxos que não passam
  pelo backend Rust: `resolutoo.customers` (conta de LOGIN do cliente
  final, diferente de `sunset.customers`, que é registro leve de CRM sem
  senha), `resolutoo.coupons`/`promotions`/`coupon_grants`/
  `coupon_product_discounts`/`promotion_product_discounts`. Havia
  originalmente `resolutoo.products`/`orders`/`order_items`/
  `shipping_settings` também neste schema, mas **nunca tiveram dado real**
  — o checkout público sempre deveria ter apontado pra `sunset.*` (bug
  raiz corrigido em `resolutoo_create_order_tenant_fix.sql`, que já
  redireciona `create_order` pra ler/escrever em `sunset.*` via
  `p_tenant_slug`); essas tabelas vazias em `resolutoo` ficaram como
  resíduo, não confiar nelas.
- **Schema `ufersin`** (citado em versões antigas deste documento,
  bootstrap em `ecommerce/supabase-ufersin/0000_bootstrap_ufersin_schema.sql`,
  ~14.7k linhas): o arquivo ainda existe no repo, mas **nenhuma função/
  query em produção referencia esse schema** (confirmado por busca em
  `ecommerce/supabase/*.sql`, que é onde ficam as funções realmente
  publicadas) — aparenta ser um bootstrap alternativo abandonado/
  superseded pelo par `sunset`+`resolutoo` acima. Verificar direto no
  Supabase (schemas existentes) antes de assumir que está morto ou de
  apagar o arquivo.
- `auth.users` (nativo do Supabase, mesmo projeto `migkkrwzykpztrakbfij`)
  — **projeto-global, não é schema-scoped**. Usado pela Auth nativa do
  lojista-assinante da plataforma (§6). O motor de e-commerce (`sunset`)
  usa tabela de sessão própria pra admin/motoboy/vendedor da loja
  (`sunset_admin_auth.sql`), de propósito, pra não misturar identidade
  entre plataforma e motor.

**Ou seja:** hoje, a conta do *assinante* Resolutoo (`subscribers`, banco
5434) e a conta do *admin da loja dele* (`sunset.admins`, Supabase) são
**duas linhas em dois bancos diferentes**, sincronizadas manualmente por
`POST /internal/provision-tenant` no fim do onboarding (copia nome/email/
hash de senha de uma pra outra, uma vez só, na criação — não há
sincronização contínua depois disso).

## 3. Autenticação — hoje, três sistemas de auth distintos coexistindo

| Quem | Onde mora a conta | Como autentica hoje |
|---|---|---|
| Lojista *assinante* (plataforma Resolutoo) | `subscribers` (Postgres local 5434) + `auth.users` (Supabase, projeto-global) | **Auth nativo do Supabase** (e-mail+senha com confirmação real por link) — o backend Rust só VERIFICA o JWT que o Supabase emite, contra o JWKS público do projeto (`SUPABASE_URL`, chave assimétrica ES256), nunca autentica ninguém sozinho. Ver §6. |
| Admin/motoboy/vendedor da loja (motor) | `sunset.admins`/`motoboys`/etc (Supabase, projeto `migkkrwzykpztrakbfij`) | Tokens opaquos em tabela `sessions` própria + `crypt()`/bcrypt via pgcrypto (`sunset_admin_auth.sql`) — **não usa `auth.users` do Supabase de propósito** |
| Cliente final da loja (motor) | `sunset.customers` (CRM leve) + `resolutoo.customers` (conta com senha, se o cliente criou login) | Mesmo padrão de sessão própria, código de recuperação por WhatsApp — ver §2b pra distinção entre as duas tabelas de customers |

O admin da loja "herda" e-mail+senha do subscriber na hora do provisionamento
(`onboarding.rs` manda `admin_password_hash` = o mesmo hash Argon2 já
calculado pro subscriber) — por isso hoje "mesmo e-mail/senha nos dois
painéis" funciona, mas é uma cópia de hash na criação, não um SSO de
verdade (ver limitação documentada em `ecommerce/README-TENANCY.md`).

## 4. `subscribers` — a tabela central da plataforma

Schema atual (`backend/migrations/0001..0004`), campos principais:

```
id                 text PK -- é o MESMO uuid do usuário no auth.users do Supabase (ver §6)
loja_nome, responsavel_nome, whatsapp, email
password_hash      Argon2 (auth.rs::hash_password) -- só serve pro handoff de admin do
                    tenant, nunca autentica o subscriber (isso é Supabase Auth)
plan_code          'essential' | 'management' | 'premium' | NULL  -- NULL até assinar um plano
valor_mensal       double precision | NULL
gateway            'mercadopago' | NULL
mp_preapproval_id  -- id da cobrança recorrente no gateway
status             'sem_assinatura' | 'pendente' | 'ativo' | 'pausado' | 'cancelado'
onboarding_status  'aguardando_pagamento' | 'aguardando_onboarding' | 'provisionado'
tenant_id          -- preenchido só depois do provisionamento
categoria, endereco, logo_url, cor_principal, banner_url, slug
documento, tipo_documento ('cnpj'|'cpf')
vender_externamente, whatsapp_habilitado boolean
forma_pagamento 'manual'|'plataforma', plataforma_pagamento, plataforma_credenciais jsonb
```

Uma linha nasce em `POST /api/auth/bootstrap` (sem plano), e só ganha
`plan_code`/`valor_mensal`/`gateway` depois, em `POST /api/assinaturas`
(que virou "assinar um plano numa conta que já existe", não mais "criar
conta + assinar" — ver §6).

## 5. Fluxo ponta a ponta hoje

```
Landing (/) → Pricing card "Assinar {plano}" → /cadastro?plano={plano}
  → preenche loja/responsável/whatsapp/email/senha → supabase.auth.signUp()
  → (se "Confirm email" pedir) /verifica o e-mail via link real → /auth/callback
  → POST /api/auth/bootstrap (cria a linha em `subscribers`, SEM plano)
  → /assinar?plano={plano} (escolhe Pix/cartão) → POST /api/assinaturas
     (atrela o plano + dispara cobrança no gateway)
  → checkout_url (cartão) ou tela de Pix
  → /obrigado?id=...  (polling em GET /api/assinaturas/{id}/status)
  → status vira "ativo" → /onboarding (2 etapas: empresa+documento / pagamento+whatsapp)
  → POST /api/onboarding → chama POST /internal/provision-tenant no motor
     (cria Organization+Tenant+Subscription+Admin, reaproveitando o hash de senha)
  → /dashboard
  → "Entrar no painel da loja" → ecommerce/frontend/admin (mesmo email/senha)
```

Cadastro/login **sem** plano atrelado (entrada padrão de `/cadastro` e
`/login`, sem `?plano=`): mesmo signUp/bootstrap acima, mas cai em
`/planos` (escolher plano) em vez de ir direto pro pagamento — a conta já
existe e pode ficar em `status = 'sem_assinatura'` indefinidamente.

Login de quem já é assinante: `/login` → `supabase.auth.signInWithPassword`
→ `/dashboard` (ou `/assinar?plano=X` se veio de um card de plano
deslogado).

## 6. Auth nativa do Supabase pro lojista (implementado)

**Objetivo:** o login/cadastro do lojista (antes de assinar) passa a usar
Auth nativo do Supabase (e-mail+senha com confirmação de e-mail de
verdade — não mais o código mockado), **e** separar duas entradas
distintas:

1. **Cadastro/login genérico** (`/cadastro`, `/login` sem `?plano=`) — cria
   a conta, SEM plano nenhum atrelado. Estado novo do subscriber:
   `status = 'sem_assinatura'`, `plan_code = NULL`.
2. **Cadastro/login com plano atrelado** — quando um lojista **deslogado**
   clica em "Assinar {plano}" na Pricing (`/cadastro?plano=essential`), o
   mesmo formulário aparece, mas com o plano pré-selecionado (como já é
   hoje), e ao concluir o cadastro/login vai direto pro passo de pagamento
   daquele plano — sem passar por uma tela de "escolher plano" à toa.

### Por que isso é cross-database e não um simples "trocar auth.rs"

`auth.users` do Supabase vive no projeto Supabase (§2b) — o `ufersin/backend`
é um serviço Rust totalmente separado, com seu próprio Postgres (§2a). Não
dá pra "logar contra a mesma sessão" porque são dois bancos sem link. A
solução é o backend Rust **verificar independentemente a assinatura do JWT
que o Supabase emite**, buscando a chave pública certa (por `kid`) no JWKS
do projeto (`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`,
endpoint público, sem segredo nenhum — ver `backend/src/jwks.rs` e env var
`SUPABASE_URL`), sem nunca precisar consultar o banco do Supabase pra
validar sessão. O projeto usa o sistema novo de "JWT Signing Keys" do
Supabase (chave assimétrica ES256), não mais o HS256 *legacy shared
secret*.

Simplificação central: **`subscribers.id` passa a SER o `sub` (uuid) do
usuário Supabase**, em vez de um uuid gerado localmente. Isso significa que
`AuthSubscriber(claims).0.sub` continua funcionando exatamente igual em
todo o código existente (`me.rs`, `onboarding.rs`, `assinatura.rs` já usam
`claims.sub` como chave primária) — só troca *quem emite e assina* o JWT.

### O que mudou no backend (`ufersin/backend`)

- `auth.rs`: `AuthSubscriber` extractor passa a decodificar o JWT do
  Supabase (chave pública buscada no JWKS via `jwks.rs`, por `kid`) em vez
  do JWT custom. Login, verificação de e-mail e redefinição de senha
  **saem do backend** — viram chamadas diretas do frontend pro Supabase
  (`supabase.auth.*`).
- Migration nova: `plan_code`/`valor_mensal`/`gateway` viram `NULL`able
  (conta pode existir sem plano); `password_hash` continua existindo, mas
  passa a ser preenchido a partir da senha em texto puro que o frontend
  manda UMA VEZ pro backend logo depois do `supabase.auth.signUp()` — só
  serve pra continuar alimentando `admin_password_hash` no handoff de
  provisionamento (§3), não é mais usado pra autenticar o próprio
  subscriber.
- `POST /api/auth/bootstrap` (novo, autenticado via JWT do Supabase): cria
  a linha em `subscribers` na primeira vez que uma sessão Supabase aparece
  (idempotente) — `loja_nome`, `responsavel_nome`, `whatsapp`, `senha`
  (pro handoff), sem plano.
- `POST /api/assinaturas` muda de forma: passa a **exigir login** (JWT
  Supabase válido) e recebe só `{ plano, metodo }` — não cria mais a conta,
  só marca o plano escolhido na conta já existente e dispara a cobrança no
  gateway. `AssinaturaCriada` perde o campo `token` (não existe mais —
  quem autentica agora é o Supabase).
- `GET /api/me`: `plano`/`valor_mensal`/`gateway` ficam `Option` — a tela
  precisa saber tratar "conta sem plano ainda". `email_verified` sai da
  resposta — o frontend passa a checar isso direto na sessão do Supabase
  (`session.user.email_confirmed_at`), não precisa mais duplicar esse
  estado no Postgres local.
- `onboarding.rs`, `webhooks.rs`, `gateway.rs`: lógica interna não muda,
  só o extractor de auth por baixo.

### O que mudou no frontend (`ufersin/frontend`)

- `lib/supabaseClient.ts` novo (client `@supabase/supabase-js`, sem schema
  customizado — só usa `.auth`, nunca fala com tabela nenhuma direto).
- `lib/authStore.ts`: troca de "token em localStorage" pra espelhar
  `supabase.auth.getSession()`/`onAuthStateChange` — mantém a mesma
  interface pública (`useIsAuthenticated()`) que todas as páginas já usam,
  pra minimizar o blast radius da mudança.
- `/cadastro`: sem `?plano=`, formulário só cria a conta (sem cartão de
  plano). Com `?plano=X`, mostra o card do plano como hoje e, ao concluir,
  vai direto pra `/assinar?plano=X`.
- `/login`: aceita `?plano=X` também (lojista existente que clicou
  "Assinar" deslogado) e redireciona pra `/assinar?plano=X` pós-login.
- `/planos` (nova): mesmos 3 cards da Pricing, mas pra quem já está
  logado e ainda não tem plano — vai direto pra `/assinar?plano=X`.
- `/assinar` (nova): só a metade final do `Cadastro` de hoje (escolher
  método de pagamento + confirmar) — chama `POST /api/assinaturas` já
  autenticado.
- `/auth/callback` (nova): landing do link de confirmação de e-mail.
  Dispara `POST /api/auth/bootstrap` quando aplicável e roteia pra
  `/assinar?plano=X` ou `/planos`.
- `/verificar-email`: deixa de pedir código de 6 dígitos — vira só
  "confira seu e-mail" + botão "reenviar" (`supabase.auth.resend`).
- `/esqueci-senha`: chama `supabase.auth.resetPasswordForEmail`; nova rota
  `/redefinir-senha` recebe o link de volta e chama
  `supabase.auth.updateUser({ password })`.
- `Dashboard`/`MeuPlano`: passam a tratar `me.plano === null` (mostrar
  CTA "escolher plano" em vez da seção de troca de plano).

## 7. Contrato atual com o frontend (`ufersin/frontend/src/lib/api.ts`)

```ts
POST /api/auth/bootstrap       → cria a linha em subscribers (sem plano), idempotente
POST /api/assinaturas          → atrela plano+método a uma conta já existente, dispara cobrança
GET  /api/assinaturas/:id/status   (público, sem auth — usado durante o redirect do checkout)
GET  /api/me                   → plano/valor_mensal/gateway são Option (null = sem plano ainda)
POST /api/me/plano
POST /api/me/cancelar
POST /api/onboarding
PUT  /api/onboarding
GET  /api/public/tenant-config/:slug   (público, sem auth)
```

Login, confirmação de e-mail e redefinição de senha **não são rotas deste
backend** — são chamadas diretas do frontend pro Supabase
(`supabase.auth.signUp/signInWithPassword/resend/resetPasswordForEmail/
updateUser`).

Autenticação de toda rota privada: header `Authorization: Bearer <jwt do
Supabase>` — `lib/api.ts::request()` lê de `authStore.getToken()`, que
agora espelha `supabase.auth.getSession()` em vez de um token custom em
localStorage; o backend verifica a assinatura contra o JWKS do projeto
(`auth.rs::AuthSubscriber` + `jwks.rs`).

## 8. O que fica de fora, de propósito

- `ecommerce/frontend` (motor de e-commerce em si) **não muda nada** neste
  passo — só recebe, como sempre recebeu, o hash de senha pronto no
  provisionamento.
- SSO de verdade entre a plataforma e o painel da loja continua não
  existindo (mesma limitação de `ecommerce/README-TENANCY.md` §"Limitação
  conhecida") — esse passo não tenta resolver isso, só moderniza a
  autenticação do lado plataforma.
- Domínio próprio por loja, sincronização de upgrade/downgrade com o valor
  cobrado no gateway, e envio real de e-mail/SMS fora do fluxo de auth
  (notificações de pedido etc.) continuam como TODO — inalterados por este
  passo.

## 9. Módulo fiscal (NF-e/NFC-e) — Jubilados + Perfis fiscais

Ausente das versões anteriores deste documento; adicionado nesta revisão.

### 9a. Jubilados — o único emissor, fora deste monorepo

Todo o trabalho pesado de emissão fiscal (comunicação com a SEFAZ,
assinatura/geração de XML, geração de DANFE em PDF, cache da tabela oficial
de Classificação Tributária/IBS-CBS) é feito por um serviço **.NET externo
chamado Jubilados** (repo `pablo9hierro/ouvir`, pasta `jubilados/`, **fora
deste monorepo**). Este monorepo nunca duplica essa lógica — só fala com o
Jubilados via HTTP (`ecommerce/backend/src/fiscal/jubilados_client.rs`).

Jubilados guarda, no banco dele (Postgres próprio, hoje hospedado no
Railway como "Postgres-BNGe" — **não é o Supabase do §2b**, são bancos
físicos diferentes), a tabela `empresas` com CNPJ, razão social e o
certificado digital A1 (base64 + senha), usado pra assinar as notas.

### 9b. Cadastro do certificado e dados da empresa (plataforma)

O upload do certificado e o cadastro fiscal da empresa (CNPJ, endereço,
regime tributário) acontecem em **Meu Plano → Integrações**, do lado da
plataforma (`ufersin/backend/src/routes/onboarding.rs`). O backend:
- Abre o `.pfx`/`.p12` com a crate `openssl` (não `p12` — ver comentário em
  `ufersin/backend/Cargo.toml`, que só decodifica o esquema legado
  RC2/3DES e rejeita certificados modernos PBES2/AES-256-CBC como "senha
  incorreta") só pra validar senha/extrair validade e titular.
- Nunca persiste o certificado localmente — repassa direto pro Jubilados
  (`POST/PUT /api/empresa`) e descarta.
- `GET /api/onboarding/fiscal/certificado/status` consulta o Jubilados
  (`GET /api/empresa/{id}`) só pra saber se há certificado válido salvo,
  sem nunca expor o certificado em si.
- Depois de salvar, chama `POST /internal/sync-fiscal-config` no
  `ecommerce/backend`, que grava `jubilados_empresa_id`/`ambiente`/
  `uf_origem` etc. em `tenant_fiscal_settings` (schema `sunset`, §2b) —
  é esse registro que o motor de e-commerce usa pra saber pra quem/como
  emitir, sem nunca falar com o banco do Jubilados diretamente.

### 9c. Perfis fiscais e resolução por venda (`ecommerce/backend`)

Adicionado pra resolver um problema de modelagem: um único CFOP/CST/CSOSN
fixo por produto não reflete a realidade (venda interna PB→PB é diferente
de PB→PE; cliente CPF é diferente de CNPJ) — forçar editar o produto a
cada venda diferente é o que se queria evitar.

Camadas (`src/fiscal/resolution.rs`):

```
Config fiscal da empresa (tenant_fiscal_settings)
  → Perfis fiscais (fiscal_profiles) — nome livre, CFOP/CST/CSOSN/
    Classificação Tributária cadastrados pelo lojista em
    Fiscal → Perfis fiscais (admin da loja, NÃO na plataforma)
  → Dados fiscais do produto (products.cfop/cst/csosn/cclass_trib) —
    OVERRIDES opcionais sobre o perfil vinculado (products.fiscal_profile_id)
  → Contexto da venda (orders.emitir_nota_fiscal, destinatario_documento_*,
    destinatario_uf, fiscal_profile_id/mode) — capturado no PDV e no
    checkout público via toggle opt-in "Emitir nota fiscal?", nunca
    obrigatório (preserva o fluxo sem CPF de sempre)
  → resolution::resolve() — combina os três (override > perfil > erro
    claro se faltar campo obrigatório, nunca inventa/usa placeholder) →
    valores efetivos
  → fiscal_documents.resolved_snapshot — grava o resultado efetivo no
    momento da emissão; editar um perfil depois NUNCA muda retroativamente
    uma nota já emitida
  → JubiladosClient::emitir() — só agora fala com o Jubilados
```

CFOP/NCM/CST/CSOSN/CEST continuam validados só por **formato**
(`src/fiscal/validation.rs`, regex/dígito verificador) — nunca por
catálogo fechado que a IA ou o sistema inventa; o contador é a fonte da
verdade. UF/município continuam dropdown (dado geográfico estável).

CRUD de perfis fiscais é exclusivo do admin da loja
(`/api/admin/fiscal/profiles`, `AdminFiscalPerfis.tsx`) — decisão
consciente de não replicar na plataforma.
