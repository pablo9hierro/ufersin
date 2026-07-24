-- Multi-tenant foundation for the copied Sunset engine (UFERSIN platform).
--
-- This migration assumes it runs against an EMPTY local dev database (see
-- README-TENANCY.md) — every ADD COLUMN below is NOT NULL with no DEFAULT
-- because there are no pre-existing rows to backfill yet. When this schema
-- is later pointed at real data (the eventual Supabase migration), each
-- ADD COLUMN here needs to become a 3-step migration instead (add nullable
-- -> backfill -> set not null). That's future work, intentionally not done
-- here since we're explicitly told not to touch Supabase yet.
--
-- Isolation model: every tenant-owned table gets a `tenant_id` column, and
-- the PRIMARY enforcement is application-level — every query in
-- backend/src/routes/*.rs is written with an explicit `WHERE tenant_id =
-- $1` (or an INSERT that stamps it). That's what actually protects this
-- backend's own traffic today.
--
-- On top of that, every one of these tables also gets Row Level Security
-- policies (ENABLE, not FORCE) reading a `app.tenant_id` session variable
-- set per-request via `SELECT set_config('app.tenant_id', $1, true)`
-- inside a transaction (see backend/src/tenant.rs — `tenant_tx`). Locally
-- this stays dormant: the app connects as the tables' own owner, and
-- unforced RLS doesn't apply to an owner. It becomes the PRIMARY defense
-- later, once this schema moves to Supabase — there the Rust backend is
-- already a privileged, service-role-equivalent client (see storage.rs's
-- use of SUPABASE_SERVICE_ROLE_KEY), while the *frontend* talks to
-- Postgres directly as anon/authenticated via PostgREST for everything
-- that isn't Pix/WhatsApp (see supabase/*.sql) — for those calls, RLS is
-- the only thing standing between one tenant's browser and another
-- tenant's rows, so these policies need to already be correct on day one
-- of that migration, not bolted on afterwards. That's why they're written
-- now even though they're not load-bearing yet.
--
-- A few lookups are legitimately *pre*-tenant (resolving which tenant a
-- login slug / order id / WhatsApp instance belongs to, before the tenant
-- is known) — those are called out individually below rather than given a
-- blanket bypass.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Organization / Tenant ----------

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  document TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Reserved for subdomain/domain routing once that's built on the
  -- platform side (ufersin) — not used for resolution yet in this backend.
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aguardando_dados' CHECK (status IN (
    'aguardando_dados', 'provisionado', 'aguardando_frontend_customizado',
    'ativo', 'suspenso', 'cancelado'
  )),
  theme_primary_color TEXT NOT NULL DEFAULT '#0f5132',
  custom_domain TEXT,
  -- Replaces the old global STORE_PICKUP_ADDRESS/EVOLUTION_INSTANCE env
  -- vars (backend/src/state.rs) — those assumed a single store and would
  -- leak one tenant's pickup address / WhatsApp messages onto another's
  -- orders. whatsapp_instance is this tenant's own Evolution API instance
  -- name (spec: "cada Tenant deverá possuir SUA PRÓPRIA INSTÂNCIA" — the
  -- Evolution API *server* stays a single shared deployment via
  -- state.evolution_api_url/evolution_api_key, only the instance name is
  -- per-tenant).
  whatsapp_instance TEXT NOT NULL,
  pickup_address TEXT NOT NULL DEFAULT 'combine o endereço pelo WhatsApp da loja',
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE UNIQUE INDEX idx_tenants_whatsapp_instance ON tenants(whatsapp_instance);

-- ---------- Plans / Features / Feature flags ----------

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('essential', 'management', 'premium')),
  name TEXT NOT NULL,
  price_cents BIGINT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE features (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT
);

-- Default set of features each plan includes. This is the plan's baseline —
-- `feature_flags` below can override it per tenant (grant early access,
-- revoke something, etc.) without changing the plan catalog.
CREATE TABLE plan_features (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_code TEXT NOT NULL REFERENCES features(code) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, feature_code)
);

-- Per-tenant override of a feature's availability. A row here always wins
-- over the plan default (see backend/src/features.rs — effective_features).
CREATE TABLE feature_flags (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_code TEXT NOT NULL REFERENCES features(code) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (tenant_id, feature_code)
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  -- Payment gateway integration is future work (AbacatePay) — these columns
  -- exist now so the subscription row shape doesn't need to change later.
  gateway TEXT,
  gateway_subscription_id TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id);

-- ---------- Roles / Permissions ----------

CREATE TABLE roles (
  code TEXT PRIMARY KEY CHECK (code IN ('admin', 'funcionario', 'motoboy', 'vendedor')),
  name TEXT NOT NULL
);

CREATE TABLE permissions (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

-- ---------- Seed catalog rows (plans/features/roles/permissions are global
-- catalog data, not tenant-owned, so they're seeded here rather than in
-- seed.rs which only seeds per-tenant demo data) ----------

INSERT INTO roles (code, name) VALUES
  ('admin', 'Administrador'),
  ('funcionario', 'Funcionário'),
  ('motoboy', 'Motoboy'),
  ('vendedor', 'Vendedor (PDV)');

INSERT INTO permissions (code, name) VALUES
  ('manage_products', 'Gerenciar catálogo'),
  ('manage_orders', 'Gerenciar pedidos'),
  ('manage_employees', 'Gerenciar funcionários'),
  ('manage_motoboys', 'Gerenciar motoboys'),
  ('view_financeiro', 'Ver financeiro'),
  ('manage_banner', 'Gerenciar banner promocional'),
  ('manage_crm', 'Gerenciar CRM'),
  ('manage_pdv', 'Operar PDV');

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('admin', 'manage_products'), ('admin', 'manage_orders'), ('admin', 'manage_employees'),
  ('admin', 'manage_motoboys'), ('admin', 'view_financeiro'), ('admin', 'manage_banner'),
  ('admin', 'manage_crm'), ('admin', 'manage_pdv'),
  ('funcionario', 'manage_products'), ('funcionario', 'manage_orders'),
  ('vendedor', 'manage_pdv'), ('vendedor', 'manage_orders'),
  ('motoboy', 'manage_orders');

INSERT INTO plans (id, code, name, price_cents) VALUES
  ('plan_essential', 'essential', 'Essential', 6000),
  ('plan_management', 'management', 'Management', 25000),
  ('plan_premium', 'premium', 'Premium', 35000);

INSERT INTO features (code, name, description) VALUES
  ('catalogo', 'Catálogo', 'Catálogo de produtos e categorias'),
  ('checkout', 'Checkout', 'Fluxo de carrinho e finalização de pedido'),
  ('pix', 'Pix', 'Cobrança via Pix'),
  ('whatsapp', 'WhatsApp', 'Notificações via Evolution API'),
  ('pedidos', 'Pedidos', 'Gestão de pedidos e status'),
  ('funcionarios', 'Funcionários', 'Contas de funcionário além do admin'),
  ('motoboy', 'Motoboy', 'Gestão de motoboys e corridas de entrega'),
  ('banner_promocional', 'Banner promocional', 'Banner/campanha na home'),
  ('comissoes', 'Comissões', 'Cálculo de comissão de motoboy/vendedor'),
  ('crm', 'CRM completo', 'CRM de clientes'),
  ('segmentacoes', 'Segmentações', 'Segmentação de clientes no CRM'),
  ('automacoes', 'Automações', 'Automações de campanha'),
  ('cupons', 'Cupons', 'Cupons de desconto'),
  ('campanhas', 'Campanhas', 'Campanhas promocionais'),
  ('relatorios', 'Relatórios', 'Relatórios avançados');

INSERT INTO plan_features (plan_id, feature_code) VALUES
  ('plan_essential', 'catalogo'), ('plan_essential', 'checkout'), ('plan_essential', 'pix'),
  ('plan_essential', 'whatsapp'), ('plan_essential', 'pedidos'),
  ('plan_management', 'catalogo'), ('plan_management', 'checkout'), ('plan_management', 'pix'),
  ('plan_management', 'whatsapp'), ('plan_management', 'pedidos'),
  ('plan_management', 'funcionarios'), ('plan_management', 'motoboy'),
  ('plan_management', 'banner_promocional'), ('plan_management', 'comissoes'),
  ('plan_premium', 'catalogo'), ('plan_premium', 'checkout'), ('plan_premium', 'pix'),
  ('plan_premium', 'whatsapp'), ('plan_premium', 'pedidos'),
  ('plan_premium', 'funcionarios'), ('plan_premium', 'motoboy'),
  ('plan_premium', 'banner_promocional'), ('plan_premium', 'comissoes'),
  ('plan_premium', 'crm'), ('plan_premium', 'segmentacoes'), ('plan_premium', 'automacoes'),
  ('plan_premium', 'cupons'), ('plan_premium', 'campanhas'), ('plan_premium', 'relatorios');

-- ---------- tenant_id on every existing tenant-owned table ----------
-- (neighborhood_shipping_rates was dropped in 0003, nothing to do there)

ALTER TABLE admins ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE admins ADD COLUMN role_code TEXT NOT NULL DEFAULT 'admin' REFERENCES roles(code);
ALTER TABLE admins DROP CONSTRAINT admins_email_key;
ALTER TABLE admins ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE admins ADD CONSTRAINT admins_tenant_email_key UNIQUE (tenant_id, email);

ALTER TABLE motoboys ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE motoboys DROP CONSTRAINT motoboys_email_key;
ALTER TABLE motoboys ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE motoboys ADD CONSTRAINT motoboys_tenant_email_key UNIQUE (tenant_id, email);

ALTER TABLE customers ADD COLUMN tenant_id TEXT NOT NULL REFERENCES tenants(id);
DROP INDEX IF EXISTS idx_customers_whatsapp;
CREATE INDEX idx_customers_tenant_whatsapp ON customers(tenant_id, whatsapp);

ALTER TABLE categories ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE categories DROP CONSTRAINT categories_name_key;
ALTER TABLE categories ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE categories ADD CONSTRAINT categories_tenant_name_key UNIQUE (tenant_id, name);

ALTER TABLE products ADD COLUMN tenant_id TEXT NOT NULL REFERENCES tenants(id);
CREATE INDEX idx_products_tenant ON products(tenant_id);

ALTER TABLE orders ADD COLUMN tenant_id TEXT NOT NULL REFERENCES tenants(id);
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_orders_whatsapp;
CREATE INDEX idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX idx_orders_tenant_whatsapp ON orders(tenant_id, customer_whatsapp);

-- Denormalized (order_items could join through orders instead) — kept
-- directly on the row so its RLS policy doesn't need a subquery/join,
-- which keeps every plan simple and avoids a perf cliff at scale.
ALTER TABLE order_items ADD COLUMN tenant_id TEXT NOT NULL REFERENCES tenants(id);
CREATE INDEX idx_order_items_tenant ON order_items(tenant_id);

-- ---------- Minimal ports of tables the Rust backend queries directly that
-- otherwise only exist via hand-run Supabase SQL files (supabase/*.sql),
-- not through sqlx migrations. Ported here just enough for the Rust-handled
-- endpoints that touch them to run against local Postgres — NOT a full port
-- of the CRM/campanhas/cupons business logic in those files, which stays
-- Supabase-only for now (see README-TENANCY.md, "Fase 1B"). ----------

-- Unqualified on purpose: the connection pool's search_path is "sunset,
-- public" (see main.rs), so this resolves to sunset.sessions — the exact
-- name backend/src/auth.rs's SunsetAdminSession/SunsetMotoboySession
-- extractors already query.
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'motoboy', 'vendedor')),
  subject_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_tenant ON sessions(tenant_id);

CREATE TABLE shipping_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  price_per_km DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  store_lat DOUBLE PRECISION NOT NULL,
  store_lng DOUBLE PRECISION NOT NULL
);

CREATE TABLE coupons (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'desconto' CHECK (kind IN ('desconto', 'frete')),
  discount_type TEXT CHECK (discount_type IN ('percent', 'fixed')),
  discount_value DOUBLE PRECISION,
  allow_campaign_checkout BIGINT NOT NULL DEFAULT 0,
  active BIGINT NOT NULL DEFAULT 1,
  expires_at TEXT,
  max_uses BIGINT,
  used_count BIGINT NOT NULL DEFAULT 0,
  notify_customers BIGINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  CONSTRAINT coupons_desconto_needs_type CHECK (kind = 'frete' OR (discount_type IS NOT NULL AND discount_value IS NOT NULL)),
  UNIQUE (tenant_id, code)
);

CREATE TABLE coupon_grants (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  customer_whatsapp TEXT NOT NULL,
  granted_uses BIGINT NOT NULL DEFAULT 1,
  used_count BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX idx_coupon_grants_tenant ON coupon_grants(tenant_id);

-- ---------- Row Level Security ----------
-- current_setting('app.tenant_id', true) returns NULL (not an error) when
-- unset, so a request that forgot to open a tenant transaction sees zero
-- rows everywhere instead of an error OR (worse) every tenant's rows.

-- Not FORCEd (see header note): local dev connects as the table owner, so
-- these stay dormant here by design and become load-bearing once the app
-- connecting to this schema is a non-owner role (Supabase's
-- anon/authenticated, in Phase 1B). A handful of call sites intentionally
-- query without a tenant transaction open — that's fine precisely because
-- it's not forced yet: backend/src/tenant.rs's `tenant_for_order` /
-- `tenant_for_instance`, routes/auth.rs's tenant-by-slug lookup, and
-- routes/webhooks.rs's instance-to-tenant resolution all exist to answer
-- "which tenant is this?" *before* a tenant is known, which is the one
-- kind of query that can never itself be tenant-scoped.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admins', 'motoboys', 'customers', 'categories', 'products',
    'orders', 'order_items', 'sessions', 'shipping_settings',
    'coupons', 'coupon_grants', 'feature_flags', 'subscriptions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;

-- tenants itself: a request can only see the ONE tenant it's scoped to (via
-- its own id, not a tenant_id column). Deliberately no policy restricting
-- SELECT by slug/whatsapp_instance beyond this — the tenant directory
-- (id, slug, name) isn't sensitive the way another tenant's orders/CRM
-- data is, and login/webhook resolution need to read across tenants to
-- find the right one in the first place.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));
