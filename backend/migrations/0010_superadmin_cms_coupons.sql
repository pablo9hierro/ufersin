-- Superadmin, planos CMS, custos, cupons de plataforma, facebook no lojista.

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id    text PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_plans (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  price_monthly double precision NOT NULL,
  tagline       text NOT NULL DEFAULT '',
  features      jsonb NOT NULL DEFAULT '[]'::jsonb,
  highlight     boolean NOT NULL DEFAULT false,
  active        boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Planos NÃO são seedados aqui — o superadmin cadastra/edita em /dashboard.

CREATE TABLE IF NOT EXISTS platform_content (
  key        text PRIMARY KEY,
  value      text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_content (key, value) VALUES
  ('landing.hero.headline', 'Sua loja online, pronta pra vender'),
  ('landing.hero.sub', 'Catálogo, checkout, Pix e WhatsApp num só lugar.'),
  ('landing.pricing.title', 'Planos'),
  ('landing.pricing.sub', 'Escolha o que cabe na sua operação.'),
  ('meu_plano.no_plan', 'Escolha um plano pra começar.'),
  ('meu_plano.tab_locked', 'Você ainda não assinou um plano para gerenciar.'),
  ('meu_plano.layout_hint', 'Textos e logo da landing da sua loja.'),
  ('meu_plano.financeiro_hint', 'Chaves de recebimento da loja.'),
  ('meu_plano.redes_hint', 'WhatsApp obrigatório. Instagram e Facebook opcionais.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_costs (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  label          text NOT NULL,
  amount_monthly double precision NOT NULL DEFAULT 0,
  notes          text NOT NULL DEFAULT '',
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_coupons (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code            text NOT NULL UNIQUE,
  discount_type   text NOT NULL CHECK (discount_type IN ('fixed', 'percent')),
  discount_value  double precision NOT NULL,
  duration_kind   text NOT NULL CHECK (duration_kind IN ('timed', 'lifetime_current_plan')),
  duration_days   int,
  max_redemptions int,
  redemptions     int NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_coupons_timed_days CHECK (
    (duration_kind = 'timed' AND duration_days IS NOT NULL AND duration_days > 0)
    OR (duration_kind = 'lifetime_current_plan' AND duration_days IS NULL)
  ),
  CONSTRAINT platform_coupons_value_check CHECK (
    (discount_type = 'fixed' AND discount_value > 0)
    OR (discount_type = 'percent' AND discount_value > 0 AND discount_value <= 100)
  )
);

CREATE TABLE IF NOT EXISTS platform_coupon_redemptions (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  coupon_id       text NOT NULL REFERENCES platform_coupons(id) ON DELETE CASCADE,
  subscriber_id   text NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  plan_code_at    text NOT NULL,
  revoked         boolean NOT NULL DEFAULT false,
  revoke_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, subscriber_id)
);

ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS facebook text,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_kind text,
  ADD COLUMN IF NOT EXISTS discount_amount double precision,
  ADD COLUMN IF NOT EXISTS discount_percent double precision,
  ADD COLUMN IF NOT EXISTS coupon_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS coupon_plan_locked text;

CREATE INDEX IF NOT EXISTS idx_platform_coupon_redemptions_sub ON platform_coupon_redemptions (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_coupon_code ON subscribers (coupon_code);
