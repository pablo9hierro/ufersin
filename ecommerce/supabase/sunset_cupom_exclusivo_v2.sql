-- =====================================================
-- Cupom exclusivo (CRM) deixa de ser um "kind" único e vira composicional:
-- o admin pode combinar desconto no frete com desconto no produto (seja
-- flat sobre o total, seja por produto específico) no MESMO cupom. Tipo
-- 'aniversario' sai do formulário de cupom exclusivo (isso já é feito
-- via segmentação na lista do CRM) — continua existindo só pra cupom
-- avulso, que não muda.
--
-- coupons.discount_type/discount_value continuam com o significado
-- ANTIGO pra kind='frete' (era a única forma de desconto de frete antes
-- de hoje — cupom avulso 'frete' não muda). Pra kind='desconto'/'produto',
-- passam a significar SÓ o desconto flat sobre o produto; o desconto de
-- frete adicional (quando combinado) mora nos campos novos
-- shipping_discount_type/shipping_discount_value. kind='produto' ignora
-- discount_type/value (usa coupon_product_discounts em vez disso).
-- =====================================================

ALTER TABLE sunset.coupons ADD COLUMN IF NOT EXISTS shipping_discount_type TEXT CHECK (shipping_discount_type IN ('percent', 'fixed'));
ALTER TABLE sunset.coupons ADD COLUMN IF NOT EXISTS shipping_discount_value DOUBLE PRECISION;

ALTER TABLE sunset.coupons DROP CONSTRAINT IF EXISTS coupons_kind_check;
ALTER TABLE sunset.coupons ADD CONSTRAINT coupons_kind_check CHECK (kind IN ('desconto', 'frete', 'aniversario', 'produto'));
ALTER TABLE sunset.coupons DROP CONSTRAINT IF EXISTS coupons_needs_discount;
ALTER TABLE sunset.coupons ADD CONSTRAINT coupons_needs_discount CHECK (
  kind = 'produto' OR (discount_type IS NOT NULL AND discount_value IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sunset.coupon_product_discounts (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  coupon_id      TEXT NOT NULL REFERENCES sunset.coupons(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES sunset.products(id),
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS coupon_product_discounts_coupon_idx ON sunset.coupon_product_discounts (coupon_id);
ALTER TABLE sunset.coupon_product_discounts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION sunset._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_campaign_checkout', (c.allow_campaign_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'active', (c.active <> 0),
    'expires_at', c.expires_at, 'max_uses', c.max_uses, 'used_count', c.used_count, 'created_at', c.created_at,
    'grant_count', (SELECT COUNT(*) FROM sunset.coupon_grants g WHERE g.coupon_id = c.id),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM sunset.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  ) FROM sunset.coupons c WHERE c.id = p_id;
$$;

-- ─────────────────────────────────────────────────────
-- Criação de cupom exclusivo — composicional agora
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset.admin_create_targeted_coupon(text, text, text, text, double precision, text[], bigint, boolean, boolean, boolean, text, bigint);

CREATE OR REPLACE FUNCTION sunset.admin_create_targeted_coupon(
  p_token text,
  p_code text,
  p_customer_whatsapps text[],
  p_uses_per_customer bigint DEFAULT 1,
  p_notify_customers boolean DEFAULT true,
  p_custom_message text DEFAULT NULL,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_campaign_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_whatsapp text;
  v_kind text;
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_pd jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_customer_whatsapps IS NULL OR array_length(p_customer_whatsapps, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one customer is required';
  END IF;
  IF p_uses_per_customer IS NULL OR p_uses_per_customer <= 0 THEN
    RAISE EXCEPTION 'uses_per_customer must be positive';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a targeted coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;

  IF v_has_products THEN
    v_kind := 'produto';
  ELSIF p_discount_type IS NOT NULL THEN
    v_kind := 'desconto';
  ELSE
    v_kind := 'frete';
  END IF;

  IF p_discount_type IS NOT NULL THEN
    IF p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;
  IF p_shipping_discount_type IS NOT NULL THEN
    IF p_shipping_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid shipping_discount_type';
    END IF;
    IF p_shipping_discount_type = 'percent' AND (p_shipping_discount_value <= 0 OR p_shipping_discount_value > 100) THEN
      RAISE EXCEPTION 'percent shipping discount must be between 0 and 100';
    END IF;
    IF p_shipping_discount_type = 'fixed' AND p_shipping_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed shipping discount must be positive';
    END IF;
  END IF;

  BEGIN
    IF v_kind = 'frete' THEN
      -- frete-only: reaproveita discount_type/value com o significado
      -- ANTIGO (é a própria taxa de frete), igual cupom avulso 'frete'.
      INSERT INTO sunset.coupons (
        id, code, kind, discount_type, discount_value, allow_campaign_checkout,
        notify_customers, combinable_with_public, expires_at, max_uses
      ) VALUES (
        v_id, v_code, 'frete', p_shipping_discount_type, p_shipping_discount_value,
        CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
        CASE WHEN p_notify_customers THEN 1 ELSE 0 END,
        CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
    ELSE
      INSERT INTO sunset.coupons (
        id, code, kind, discount_type, discount_value,
        shipping_discount_type, shipping_discount_value, allow_campaign_checkout,
        notify_customers, combinable_with_public, expires_at, max_uses
      ) VALUES (
        v_id, v_code, v_kind, p_discount_type, p_discount_value,
        p_shipping_discount_type, p_shipping_discount_value,
        CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
        CASE WHEN p_notify_customers THEN 1 ELSE 0 END,
        CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (
          gen_random_uuid()::text, v_id, v_pd->>'product_id',
          v_pd->>'discount_type', (v_pd->>'discount_value')::double precision
        );
    END LOOP;
  END IF;

  FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
    INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses)
      VALUES (gen_random_uuid()::text, v_id, v_whatsapp, p_uses_per_customer);
  END LOOP;

  RETURN sunset._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_targeted_coupon(text, text, text[], bigint, boolean, text, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- list_customer_coupons (auto-detecção no checkout) ganha os mesmos campos
-- novos de validate_coupon, pro checkout aplicar certo sem precisar digitar
-- código.
CREATE OR REPLACE FUNCTION sunset.list_customer_coupons(p_customer_whatsapp text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_campaign_checkout', (c.allow_campaign_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM sunset.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  FROM sunset.coupon_grants g
  JOIN sunset.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = p_customer_whatsapp
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at::timestamptz > now())
    AND (c.max_uses IS NULL OR c.used_count < c.max_uses);
$$;

-- ─────────────────────────────────────────────────────
-- validate_coupon e create_order passam a considerar shipping_discount_*
-- (independente do kind) e coupon_product_discounts (kind='produto').
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset.validate_coupon(text, text, text, text);

CREATE OR REPLACE FUNCTION sunset.validate_coupon(
  p_code text,
  p_campaign_id text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
DECLARE
  v_coupon sunset.coupons%ROWTYPE;
  v_is_targeted boolean;
BEGIN
  SELECT * INTO v_coupon FROM sunset.coupons WHERE upper(code) = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF v_coupon.active = 0 THEN
    RAISE EXCEPTION 'coupon is not active';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
  END IF;
  IF v_coupon.kind = 'aniversario' THEN
    IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = ''
       OR extract(month FROM p_customer_birthdate::date) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
  IF v_is_targeted THEN
    IF p_customer_whatsapp IS NULL OR trim(p_customer_whatsapp) = '' THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM sunset.coupon_grants
      WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
    ) THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value,
    'shipping_discount_type', v_coupon.shipping_discount_type, 'shipping_discount_value', v_coupon.shipping_discount_value,
    'combinable_with_public', (v_coupon.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM sunset.coupon_product_discounts pd WHERE pd.coupon_id = v_coupon.id
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.validate_coupon(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_campaign_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sunset, public
AS $$
DECLARE
  v_item              jsonb;
  v_product           sunset.products%ROWTYPE;
  v_quantity          bigint;
  v_subtotal          double precision := 0;
  v_shipping          double precision := 0;
  v_discount_amount   double precision := 0;
  v_shipping_discount double precision := 0;
  v_customer_id       text;
  v_order_id          text := gen_random_uuid()::text;
  v_item_id           text;
  v_settings          sunset.shipping_settings%ROWTYPE;
  v_km                double precision;
  v_birthdate         date;
  v_campaign          sunset.campaigns%ROWTYPE;
  v_coupon            sunset.coupons%ROWTYPE;
  v_coupon_code       text;
  v_grant             sunset.coupon_grants%ROWTYPE;
  v_is_targeted       boolean;
  v_pd                sunset.coupon_product_discounts%ROWTYPE;
  v_item_total        double precision;
  v_total             double precision;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'order must have at least one item';
  END IF;
  IF p_delivery_type NOT IN ('entrega','retirada') THEN
    RAISE EXCEPTION 'invalid delivery_type';
  END IF;
  IF p_payment_method NOT IN ('pix','cartao','dinheiro') THEN
    RAISE EXCEPTION 'invalid payment_method';
  END IF;
  IF trim(p_customer_name) = '' OR trim(p_customer_whatsapp) = '' THEN
    RAISE EXCEPTION 'customer_name and customer_whatsapp are required';
  END IF;
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_campaign_id IS NOT NULL THEN
    SELECT * INTO v_campaign FROM sunset.campaigns WHERE id = p_campaign_id;
    IF NOT FOUND OR v_campaign.active = 0
       OR (v_campaign.starts_at IS NOT NULL AND v_campaign.starts_at::timestamptz > now())
       OR (v_campaign.expires_at IS NOT NULL AND v_campaign.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'campaign is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_campaign.product_ids))
    ) THEN
      RAISE EXCEPTION 'this campaign checkout can only contain the campaign products';
    END IF;
  END IF;

  -- resolve o cupom cedo (antes do loop de itens) só pra saber, no caso
  -- kind='produto', quais itens têm desconto específico
  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM sunset.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM sunset.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE sunset.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;
    v_coupon_code := v_coupon.code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM sunset.products
      WHERE id = (v_item->>'product_id') FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product % not found', v_item->>'product_id';
    END IF;
    IF v_product.active = 0 THEN
      RAISE EXCEPTION 'product % is not available', v_product.name;
    END IF;
    IF v_product.quantity < v_quantity THEN
      RAISE EXCEPTION 'insufficient stock for product %', v_product.name;
    END IF;

    v_item_total := v_product.price * v_quantity;
    v_subtotal := v_subtotal + v_item_total;

    -- cupom kind='produto': desconto específico por item, se esse produto
    -- estiver na lista do cupom
    IF v_coupon.kind = 'produto' THEN
      SELECT * INTO v_pd FROM sunset.coupon_product_discounts
        WHERE coupon_id = v_coupon.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_pd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_pd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_pd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM sunset.shipping_settings WHERE id = 1;
    v_km := sunset._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_campaign.id IS NOT NULL THEN
    IF v_campaign.discount_type = 'percent' THEN
      v_discount_amount := v_discount_amount + round((v_subtotal * v_campaign.discount_value / 100)::numeric, 2);
    ELSIF v_campaign.discount_type = 'fixed' THEN
      v_discount_amount := v_discount_amount + v_campaign.discount_value;
    END IF;
    IF v_campaign.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_campaign.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_campaign.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_campaign.shipping_discount_value;
    END IF;
  END IF;

  IF v_coupon.id IS NOT NULL THEN
    IF v_coupon.kind = 'frete' THEN
      -- frete-only: discount_type/value É a taxa de frete (significado antigo)
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.kind = 'desconto' AND v_coupon.discount_type IS NOT NULL THEN
        IF v_coupon.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + v_coupon.discount_value;
        END IF;
      END IF;
      -- kind='produto' já foi somado no loop de itens acima
      IF v_coupon.shipping_discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.shipping_discount_value / 100)::numeric, 2);
      ELSIF v_coupon.shipping_discount_type = 'fixed' THEN
        v_shipping_discount := v_shipping_discount + v_coupon.shipping_discount_value;
      END IF;
    END IF;
    UPDATE sunset.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM sunset.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO sunset.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE sunset.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO sunset.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, campaign_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_campaign_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM sunset.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO sunset.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE sunset.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN sunset.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;
