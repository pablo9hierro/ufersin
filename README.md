# Rodoletas

A plataforma SaaS que vende o "Ecommerce" (motor multi-tenant em `ecommerce/`,
uma cópia do Sunset Tabas retrofitada pra atender centenas de lojas — ver
`ecommerce/README-TENANCY.md`). A Rodoletas em si **não é uma loja** — é a
landing, o cadastro/checkout, o dashboard do assinante e o onboarding que
provisiona automaticamente um Tenant novo dentro do motor.

```
backend/       Rust + Axum + SQLx — assinatura, auth, dashboard, onboarding
frontend/      Vite + React + TS + Tailwind v4 + Framer Motion — landing, área logada
ecommerce/     motor de e-commerce multi-tenant (o que a Rodoletas vende)
supabase/      (não usado ainda por este app — reservado pra integração futura)
```

## Fluxo completo

```
Landing (/) -> Escolher plano (#planos) -> Cadastro (/cadastro, é o checkout)
  -> Pagamento (Pix ou cartão) -> /obrigado (polling de status)
  -> Onboarding (/onboarding) -> POST /internal/provision-tenant no motor
  -> Dashboard (/dashboard) -> "Entrar no painel da loja" (ecommerce/frontend)
```

- **Planos**: Essential R$60, Management R$250, Premium R$350 — mesmos
  planos/preços definidos no motor (`ecommerce/backend/migrations/0005_tenancy.sql`).
- **Pagamento**: Mercado Pago (funcionando, cartão) já em produção antes
  desse SaaS; AbacatePay (Pix) preparado em modo mock — ver
  `backend/src/gateway.rs`. Sem `MP_ACCESS_TOKEN`/`ABACATEPAY_API_KEY`
  configurada, tudo roda em modo mock (não cobra nada de verdade).
- **Onboarding -> Tenant**: ao finalizar o onboarding, este backend chama
  `POST /internal/provision-tenant` no motor de e-commerce (chave
  compartilhada `ECOMMERCE_INTERNAL_KEY`/`INTERNAL_API_KEY`), que cria
  Organization + Tenant + Subscription + o admin da loja numa unica
  transação. O admin da loja usa o **mesmo e-mail e senha** da conta
  Rodoletas (o hash Argon2 é reaproveitado, a senha em si nunca trafega) —
  ver `backend/src/routes/onboarding.rs`.

## Setup local

### 1. Banco — local por enquanto (Supabase vem depois)

```bash
cd backend
docker compose up -d   # Postgres na porta 5434
```

O projeto Supabase dedicado do ufersin (`retmfoorwjwzuevaqlsr`) continua
documentado em `backend/.env.example` pra quando a integração real
acontecer — não usado agora, de propósito (mesma decisão já tomada pro
motor de e-commerce).

### 2. Rodar os 3 backends/frontends (portas diferentes de propósito)

```bash
# 1. Motor de e-commerce (porta 8080) — ver ecommerce/README.md
cd ecommerce/backend && docker compose up -d && cargo run

# 2. Backend Rodoletas (porta 8081)
cd backend && cargo run

# 3. Frontend Rodoletas (porta 5174)
cd frontend && npm install && npm run dev
```

Acesse `http://localhost:5174`. O frontend do motor de e-commerce
(`ecommerce/frontend`, porta 5173) só é necessário se você for testar o
"Entrar no painel da loja" depois do onboarding.

### 3. Variáveis de ambiente

Copie `backend/.env.example` -> `backend/.env` e `frontend/.env.example` ->
`frontend/.env`. `ECOMMERCE_INTERNAL_KEY` (aqui) precisa ser IGUAL a
`INTERNAL_API_KEY` (em `ecommerce/backend/.env`) — é a chave que autoriza a
chamada de provisionamento entre os dois backends.

## Deploy

- **Frontend**: Vercel — `.github/workflows/deploy-vercel.yml` já faz deploy
  automático em todo push pra `main` (precisa configurar os secrets
  `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` no repo, ver comentário
  no topo do workflow).
- **Backend**: Rust não roda na Vercel (precisa de processo sempre-ativo) —
  vai pro Railway, igual o motor de e-commerce. Ainda não configurado.
- **CI**: `.github/workflows/ci.yml` roda `cargo check` + `tsc`/`vite build`
  em todo push/PR pra `main`, antes do deploy.

## O que ainda falta

- Domínio próprio por loja (hoje é só `<slug>.rodoletas.app`, e nem isso
  está de fato roteado ainda — é só o texto mostrado no dashboard).
- SSO de verdade entre a Rodoletas e o painel da loja (hoje é "mesmo
  e-mail/senha", não um token único) — e mesmo isso só passa a funcionar
  quando `ecommerce/supabase/sunset_admin_auth.sql` for portado pra
  respeitar tenant (Fase 1B do motor, ver `ecommerce/README-TENANCY.md`).
- Sincronizar upgrade/downgrade de plano com o valor cobrado de verdade no
  gateway (hoje só troca o plano localmente — ver o TODO em
  `backend/src/routes/me.rs`).
- Envio real de e-mail/SMS pra verificação de conta e recuperação de senha
  (hoje só loga o código no console do backend).
