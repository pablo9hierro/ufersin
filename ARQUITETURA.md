# Arquitetura atual — Rodoletas / Ufersin

Documento técnico de handoff (escrito pra dar contexto a outra ferramenta/IA
trabalhando neste repo, ex. Cursor). Reflete o estado real do código nesta
data — não é aspiracional. Onde alguma coisa está pela metade ou é uma
decisão consciente de deixar pra depois, isso está marcado explicitamente.

## 1. O que é isto

**Rodoletas** é o SaaS que vende **Ufersin**: um motor de e-commerce
multi-tenant (`ecommerce/`) — uma cópia retrofitada do Sunset Tabas
(`C:\Users\pablo\Documents\juite`, produção real, nunca tocado por este
projeto) que passou a suportar N lojas isoladas por `tenant_id` em vez de
uma só.

São **duas aplicações separadas no mesmo monorepo**, com bancos de dados
diferentes, faladas por pessoas diferentes:

```
ufersin/
├── backend/     Rust+Axum+SQLx — "Rodoletas": cadastro, login, cobrança,
│                dashboard do assinante, onboarding. Porta 8081/8080.
├── frontend/    Vite+React+TS — landing, cadastro, dashboard do assinante
│                (o que o LOJISTA vê antes/durante virar cliente). Porta 5174.
├── ecommerce/
│   ├── backend/   Rust+Axum+SQLx — motor multi-tenant (catálogo, pedidos,
│   │              admin, motoboy, PDV, financeiro, CRM). Porta 8080.
│   ├── frontend/  Vite+React+TS — vitrine + admin + PDV + app motoboy da
│   │              LOJA em si (o que o CLIENTE FINAL e o LOJISTA-JÁ-PAGANTE
│   │              usam no dia a dia). Porta 5173.
│   └── supabase-ufersin/  bootstrap SQL do schema `ufersin` no Supabase.
```

Quem NÃO é lojista Rodoletas nunca vê `ufersin/frontend` — só existe pra
vender e gerenciar a assinatura. Depois que a loja está provisionada, o
lojista passa a operar em `ecommerce/frontend/admin` no dia a dia.

## 2. Bancos de dados — dois, sem relação de FK entre eles

Isto é a fonte de confusão mais comum neste projeto, então fica explícito:

### 2a. Postgres local do `ufersin/backend` (Rodoletas)
- `docker-compose.yml` em `backend/`, porta **5434**.
- Uma única tabela relevante: **`subscribers`** (ver §4) — a conta do
  lojista *como assinante da plataforma* (login, plano, status de
  pagamento, dados do onboarding).
- Projeto Supabase dedicado (`retmfoorwjwzuevaqlsr`) já está documentado em
  `.env.example` mas **não está em uso** — decisão consciente de manter
  local por enquanto (mesmo padrão adotado no motor de e-commerce).

### 2b. Supabase compartilhado (projeto "juite", ref `zncpcsdpdkvjfknmmhpu`)
Mesmo projeto Supabase que hospeda o Sunset Tabas de produção de verdade.
Isolamento é feito por **schema**, não por projeto:
- `sunset` — produção real da Sunset Tabas. Nunca tocado por este repo.
- `vrtech` — outro produto, também nunca tocado.
- `ufersin` — schema dedicado pro motor multi-tenant deste projeto
  (bootstrap em `ecommerce/supabase-ufersin/0000_bootstrap_ufersin_schema.sql`,
  ~14.7k linhas, réplica cronológica das 71 migrations SQL do Sunset +
  4 migrations sqlx, tudo renomeado pro schema `ufersin`). É aqui que vivem
  `products`, `categories`, `orders`, `admins`, `tenants`, `organizations`,
  `plans`, CRM, cupons, PDV — o motor inteiro.
- `auth.users` (nativo do Supabase) — **projeto-global, não é
  schema-scoped**. Hoje não está em uso por nenhum dos três produtos
  (Sunset usa tabela de sessão própria de propósito, ver
  `ecommerce/supabase-ufersin/.../sunset_admin_auth.sql`, exatamente pra
  não vazar identidade entre produtos do mesmo projeto Supabase). Isso é
  relevante pro próximo passo (§6).

**Ou seja:** hoje, a conta do *assinante* Rodoletas (`subscribers`, banco
5434) e a conta do *admin da loja dele* (`ufersin.admins`, Supabase) são
**duas linhas em dois bancos diferentes**, sincronizadas manualmente por
`POST /internal/provision-tenant` no fim do onboarding (copia nome/email/
hash de senha de uma pra outra, uma vez só, na criação — não há
sincronização contínua depois disso).

## 3. Autenticação — hoje, três sistemas de auth distintos coexistindo

| Quem | Onde mora a conta | Como autentica hoje |
|---|---|---|
| Lojista *assinante* (Rodoletas) | `subscribers` (Postgres local 5434) | JWT custom (`jsonwebtoken`), senha em Argon2, código de verificação de e-mail **mockado** (só loga no console, nunca envia e-mail de verdade) — ver `backend/src/auth.rs` |
| Admin/motoboy/vendedor da loja (motor) | `ufersin.admins`/`motoboys`/etc (Supabase) | Tokens opaquos em tabela `sessions` própria + `crypt()`/bcrypt via pgcrypto (`sunset_admin_auth.sql`) — **não usa `auth.users` do Supabase de propósito** |
| Cliente final da loja (motor) | `ufersin.customers` (Supabase) | Mesmo padrão de sessão própria, código de recuperação por WhatsApp |

O admin da loja "herda" e-mail+senha do subscriber na hora do provisionamento
(`onboarding.rs` manda `admin_password_hash` = o mesmo hash Argon2 já
calculado pro subscriber) — por isso hoje "mesmo e-mail/senha nos dois
painéis" funciona, mas é uma cópia de hash na criação, não um SSO de
verdade (ver limitação documentada em `ecommerce/README-TENANCY.md`).

## 4. `subscribers` — a tabela central da Rodoletas

Schema atual (`backend/migrations/0001..0003`), campos principais:

```
id                 text PK (uuid)
loja_nome, responsavel_nome, whatsapp, email
password_hash      Argon2 (auth.rs::hash_password)
email_verified, verification_code, verification_expires_at
reset_code, reset_expires_at
plan_code          'essential' | 'management' | 'premium'  -- NOT NULL hoje
valor_mensal       double precision
gateway            'mercadopago' | 'abacatepay'
mp_preapproval_id  -- id da cobrança recorrente no gateway
status             'pendente' | 'ativo' | 'pausado' | 'cancelado'
onboarding_status  'aguardando_pagamento' | 'aguardando_onboarding' | 'provisionado'
tenant_id          -- preenchido só depois do provisionamento
categoria, endereco, logo_url, cor_principal, banner_url, slug
documento, tipo_documento ('cnpj'|'cpf')
vender_externamente, whatsapp_habilitado boolean
forma_pagamento 'manual'|'plataforma', plataforma_pagamento, plataforma_credenciais jsonb
```

Hoje **uma linha só nasce em `POST /api/assinaturas`** (`assinatura.rs::criar_assinatura`),
que faz TUDO de uma vez: valida form, cria a linha, já com plano e método de
pagamento escolhidos, chama o gateway (Mercado Pago/AbacatePay) e devolve o
checkout. Isso é exatamente o que o próximo passo (§6) separa em duas
etapas.

## 5. Fluxo ponta a ponta hoje

```
Landing (/) → Pricing card "Assinar {plano}" → /cadastro?plano={plano}
  → preenche loja/responsável/whatsapp/email/senha/método de pagamento
  → POST /api/assinaturas   (cria subscriber JÁ COM plano + já dispara cobrança)
  → recebe token custom, authStore.setToken()
  → checkout_url (cartão) ou tela de Pix
  → /obrigado?id=...  (polling em GET /api/assinaturas/{id}/status)
  → status vira "ativo" → /onboarding (2 etapas: empresa+documento / pagamento+whatsapp)
  → POST /api/onboarding → chama POST /internal/provision-tenant no motor
     (cria Organization+Tenant+Subscription+Admin, reaproveitando o hash de senha)
  → /dashboard
  → "Entrar no painel da loja" → ecommerce/frontend/admin (mesmo email/senha)
```

Login de quem já é assinante: `/login` → `POST /api/auth/login` → mesmo
token custom.

**Problema que motivou o próximo passo:** hoje é impossível criar uma conta
Rodoletas *sem* já estar no meio de uma assinatura de plano — cadastro e
assinatura são o mesmo passo, o mesmo formulário, a mesma chamada. Isso
trava fluxos como "criar conta, decidir o plano depois" ou "logar numa
conta já existente sem plano nenhum".

## 6. Próximo passo (em andamento): Supabase Auth nativo pro lojista

**Objetivo:** o login/cadastro do lojista (antes de assinar) passa a usar
Auth nativo do Supabase (e-mail+senha com confirmação de e-mail de
verdade — não mais o código mockado — e opcionalmente Google OAuth),
**e** separar duas entradas distintas:

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
que o Supabase emite** (HS256 com o *JWT secret* legado do projeto —
Settings → API → JWT Settings no dashboard Supabase — via env var nova
`SUPABASE_JWT_SECRET`), sem nunca precisar consultar o banco do Supabase
pra validar sessão.

Simplificação central: **`subscribers.id` passa a SER o `sub` (uuid) do
usuário Supabase**, em vez de um uuid gerado localmente. Isso significa que
`AuthSubscriber(claims).0.sub` continua funcionando exatamente igual em
todo o código existente (`me.rs`, `onboarding.rs`, `assinatura.rs` já usam
`claims.sub` como chave primária) — só troca *quem emite e assina* o JWT.

### O que muda no backend (`ufersin/backend`)

- `auth.rs`: `AuthSubscriber` extractor passa a decodificar o JWT do
  Supabase (chave = `SUPABASE_JWT_SECRET`) em vez do JWT custom. Login,
  verificação de e-mail e redefinição de senha **saem do backend** — viram
  chamadas diretas do frontend pro Supabase (`supabase.auth.*`).
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

### Limitação conhecida e aceita: Google OAuth não tem senha pra repassar

O handoff de senha pro admin do tenant (§3) depende de ter a senha em
texto puro no momento do cadastro — isso só existe no fluxo e-mail+senha.
Quem entra por Google não tem senha nenhuma pra repassar. Solução adotada:
`password_hash` fica `NULL` nesse caso, e o primeiro acesso ao painel da
loja (`ecommerce/frontend/admin`) exige "definir senha" (fluxo de
recuperação de senha de lá) em vez de reaproveitar credencial. Isso é uma
limitação pré-existente do modelo "SSO por cópia de hash" (§3), não algo
que este passo piora — só fica mais visível pro caso Google.

### O que muda no frontend (`ufersin/frontend`)

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
- `/auth/callback` (nova): landing do link de confirmação de e-mail e do
  redirect de OAuth. Dispara `POST /api/auth/bootstrap` quando aplicável e
  roteia pra `/assinar?plano=X` ou `/planos`.
- `/verificar-email`: deixa de pedir código de 6 dígitos — vira só
  "confira seu e-mail" + botão "reenviar" (`supabase.auth.resend`).
- `/esqueci-senha`: chama `supabase.auth.resetPasswordForEmail`; nova rota
  `/redefinir-senha` recebe o link de volta e chama
  `supabase.auth.updateUser({ password })`.
- `Dashboard`/`MeuPlano`: passam a tratar `me.plano === null` (mostrar
  CTA "escolher plano" em vez da seção de troca de plano).

## 7. Contrato atual com o frontend (`ufersin/frontend/src/lib/api.ts`)

Estado ANTES do passo do §6 (documentado aqui pra servir de diff quando a
mudança for aplicada):

```ts
POST /api/assinaturas          → cria subscriber JÁ com plano, devolve token
GET  /api/assinaturas/:id/status
POST /api/auth/login           → devolve token custom
POST /api/auth/verificar-email
POST /api/auth/reenviar-verificacao
POST /api/auth/esqueci-senha
POST /api/auth/redefinir-senha
GET  /api/me                   → plano/valor_mensal sempre presentes
POST /api/me/plano
POST /api/me/cancelar
POST /api/onboarding
PUT  /api/onboarding
GET  /api/public/tenant-config/:slug   (público, sem auth)
POST /api/webhooks/abacatepay
```

Autenticação de toda rota privada: header `Authorization: Bearer <jwt
custom>`, emitido por `auth.rs::make_token`, checado por
`AuthSubscriber` (mesmo secret `JWT_SECRET` local).

Depois do §6, os cinco endpoints de `/api/auth/*` somem (viram chamadas
diretas `supabase.auth.*` no frontend), `POST /api/assinaturas` muda de
assinatura (não cria mais conta) e ganha um irmão novo,
`POST /api/auth/bootstrap`. O header `Authorization` passa a levar o JWT
emitido pelo Supabase em vez do custom — `lib/api.ts::request()` não muda
(já lê de `authStore.getToken()` de forma agnóstica), só o que `authStore`
devolve muda de fonte.

## 8. O que fica de fora, de propósito

- `ecommerce/frontend` (motor de e-commerce em si) **não muda nada** neste
  passo — só recebe, como sempre recebeu, o hash de senha pronto no
  provisionamento.
- SSO de verdade entre Rodoletas e o painel da loja continua não existindo
  (mesma limitação de `ecommerce/README-TENANCY.md` §"Limitação
  conhecida") — esse passo não tenta resolver isso, só moderniza a
  autenticação do lado Rodoletas.
- Domínio próprio por loja, sincronização de upgrade/downgrade com o valor
  cobrado no gateway, e envio real de e-mail/SMS fora do fluxo de auth
  (notificações de pedido etc.) continuam como TODO — inalterados por este
  passo.
