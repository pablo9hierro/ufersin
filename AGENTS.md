# Rodoletas (ufersin)

SaaS que **vende** o motor de e-commerce multi-tenant. A Rodoletas **não é uma loja** — é landing, cadastro/checkout, dashboard do assinante e onboarding que provisiona um Tenant no motor.

Repo: https://github.com/pablo9hierro/ufersin

## Mapa do monorepo

| Pasta | Papel | Stack | Porta local |
|-------|--------|--------|-------------|
| `backend/` | Assinatura, auth, dashboard API, onboarding | Rust + Axum + SQLx | 8081 |
| `frontend/` | Landing + área logada do assinante | Vite + React + TS + Tailwind v4 + Framer Motion | 5174 |
| `ecommerce/` | Motor multi-tenant (o produto vendido) — cópia retrofitada do Sunset Tabas | Rust + React + WhatsApp | 8080 / 5173 |
| `supabase/` | Reservado — **não usado** ainda por este app | — | — |

Docs de referência: `README.md`, `BRANCHING.md`, `ecommerce/README.md`, `ecommerce/README-TENANCY.md`.

## Fluxo de negócio

```
Landing (/) → plano (#planos) → Cadastro (/cadastro)
  → Pagamento (Pix/cartão) → /obrigado
  → Onboarding (/onboarding) → POST /internal/provision-tenant no motor
  → Dashboard (/dashboard) → painel da loja (ecommerce/frontend)
```

Planos: Essential R$60 · Management R$250 · Premium R$350 (espelhados em `ecommerce/backend/migrations/0005_tenancy.sql`).

## Regras de arquitetura (não violar)

1. **Dois backends separados.** Rodoletas (`backend/`) e motor (`ecommerce/backend/`) não compartilham DB. Integração só via `POST /internal/provision-tenant` com `ECOMMERCE_INTERNAL_KEY` ≡ `INTERNAL_API_KEY`.
2. **Senha nunca trafega** entre backends — só o hash Argon2 é reaproveitado no provisionamento.
3. **Sunset original e vrtech** estão em outros repos; `ecommerce/` é cópia. Não misturar decisões daqui neles.
4. **Fase 1B pendente** em `ecommerce/supabase/`: RPCs ainda single-tenant. Não “consertar” RLS/tenant nessas funções sem cuidado explícito — vazamento entre tenants é o risco principal.
5. **Feature flags no motor**: um código, bloqueio por `require_feature` — nunca três builds/páginas por plano.
6. **Branches**: `dev` → `demo` → `main` (ver `BRANCHING.md`). Trabalho diário em `dev`.

## Pagamentos

- Mercado Pago (cartão) e AbacatePay (Pix) em `backend/src/gateway.rs`.
- Sem tokens no `.env` → modo mock (não cobra de verdade).

## Auth do lojista

- **Só** Supabase Auth e-mail+senha (`signUp` / `signInWithPassword`) — sem Google OAuth.
- Backend Rust só valida o JWT (`SUPABASE_JWT_SECRET`); senha no bootstrap vira Argon2 pro handoff do admin do tenant.

## O que o agente deve fazer

- Preferir mudanças mínimas e alinhadas ao fluxo acima.
- Ao tocar tenancy/provisionamento, ler `ecommerce/README-TENANCY.md` e `backend/src/routes/onboarding.rs`.
- Não assumir que Supabase está ativo neste app — Postgres local via docker-compose por enquanto.
- Não inventar SSO: hoje é “mesmo e-mail/senha”, não token único entre Rodoletas e painel da loja.
