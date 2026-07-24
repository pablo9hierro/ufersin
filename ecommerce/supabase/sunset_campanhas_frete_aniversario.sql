-- =====================================================
-- Ajustes em campanhas/cupons:
-- 1) frete deixa de ser "grátis ou nada" e vira desconto configurável
--    (percentual ou valor fixo) — mais realista pro lojista que não quer
--    zerar o frete inteiro. campaigns.free_shipping (boolean) é substituído
--    por shipping_discount_type/shipping_discount_value (mesmo padrão do
--    desconto de produto). Em cupom, o kind 'frete' passa a reaproveitar as
--    MESMAS colunas discount_type/discount_value (que já existiam mas só
--    valiam pra kind='desconto') — agora valem pra qualquer kind.
-- 2) novo kind de cupom 'aniversario': só é válido durante o mês de
--    aniversário do cliente (usa customer_birthdate, que o checkout já
--    coleta) — validate_coupon ganha um parâmetro novo pra poder checar
--    isso na pré-visualização, não só na hora de criar o pedido.
-- =====================================================

ALTER TABLE sunset.campaigns DROP CONSTRAINT IF EXISTS campaigns_has_discount;
ALTER TABLE sunset.campaigns ADD COLUMN IF NOT EXISTS shipping_discount_type TEXT CHECK (shipping_discount_type IN ('percent', 'fixed'));
ALTER TABLE sunset.campaigns ADD COLUMN IF NOT EXISTS shipping_discount_value DOUBLE PRECISION;
UPDATE sunset.campaigns SET shipping_discount_type = 'percent', shipping_discount_value = 100 WHERE free_shipping <> 0 AND shipping_discount_type IS NULL;
ALTER TABLE sunset.campaigns DROP COLUMN IF EXISTS free_shipping;
ALTER TABLE sunset.campaigns ADD CONSTRAINT campaigns_has_discount CHECK (
  (discount_type IS NOT NULL AND discount_value IS NOT NULL) OR
  (shipping_discount_type IS NOT NULL AND shipping_discount_value IS NOT NULL)
);

ALTER TABLE sunset.coupons DROP CONSTRAINT IF EXISTS coupons_desconto_needs_type;
ALTER TABLE sunset.coupons DROP CONSTRAINT IF EXISTS coupons_kind_check;
ALTER TABLE sunset.coupons ADD CONSTRAINT coupons_kind_check CHECK (kind IN ('desconto', 'frete', 'aniversario'));
ALTER TABLE sunset.coupons ADD CONSTRAINT coupons_needs_discount CHECK (discount_type IS NOT NULL AND discount_value IS NOT NULL);

-- ─────────────────────────────────────────────────────
-- Campanhas — CRUD admin (mesmas assinaturas, corpo troca free_shipping
-- por shipping_discount_type/value)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._campaign_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'title', title, 'image_url', image_url, 'product_ids', to_jsonb(product_ids),
    'discount_type', discount_type, 'discount_value', discount_value,
    'shipping_discount_type', shipping_discount_type, 'shipping_discount_value', shipping_discount_value,
    'active', (active <> 0), 'starts_at', starts_at, 'expires_at', expires_at, 'created_at', created_at
  ) FROM sunset.campaigns WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS sunset.admin_create_campaign(text, text, text, text[], text, double precision, boolean, text, text);

CREATE OR REPLACE FUNCTION sunset.admin_create_campaign(
  p_token text, p_title text, p_image_url text, p_product_ids text[],
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL, p_shipping_discount_value double precision DEFAULT NULL,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required to create a campaign';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF (p_discount_type IS NULL OR p_discount_value IS NULL) AND (p_shipping_discount_type IS NULL OR p_shipping_discount_value IS NULL) THEN
    RAISE EXCEPTION 'a campaign needs a product discount and/or a shipping discount';
  END IF;
  IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid discount_type';
  END IF;
  IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
    RAISE EXCEPTION 'percent discount must be between 0 and 100';
  END IF;
  IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
    RAISE EXCEPTION 'fixed discount must be positive';
  END IF;
  IF p_shipping_discount_type IS NOT NULL AND p_shipping_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid shipping_discount_type';
  END IF;
  IF p_shipping_discount_type = 'percent' AND (p_shipping_discount_value <= 0 OR p_shipping_discount_value > 100) THEN
    RAISE EXCEPTION 'percent shipping discount must be between 0 and 100';
  END IF;
  IF p_shipping_discount_type = 'fixed' AND p_shipping_discount_value <= 0 THEN
    RAISE EXCEPTION 'fixed shipping discount must be positive';
  END IF;
  INSERT INTO sunset.campaigns (
    id, title, image_url, product_ids, discount_type, discount_value,
    shipping_discount_type, shipping_discount_value, starts_at, expires_at
  ) VALUES (
    v_id, trim(p_title), p_image_url, p_product_ids, p_discount_type, p_discount_value,
    p_shipping_discount_type, p_shipping_discount_value, NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), '')
  );
  RETURN sunset._campaign_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_campaign(text, text, text, text[], text, double precision, text, double precision, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_campaign(text, text, text, text, text[], text, double precision, boolean, boolean, text, text);

CREATE OR REPLACE FUNCTION sunset.admin_update_campaign(
  p_token text, p_id text, p_title text, p_image_url text, p_product_ids text[],
  p_discount_type text, p_discount_value double precision,
  p_shipping_discount_type text, p_shipping_discount_value double precision,
  p_active boolean, p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF (p_discount_type IS NULL OR p_discount_value IS NULL) AND (p_shipping_discount_type IS NULL OR p_shipping_discount_value IS NULL) THEN
    RAISE EXCEPTION 'a campaign needs a product discount and/or a shipping discount';
  END IF;
  UPDATE sunset.campaigns SET
    title = trim(p_title), image_url = p_image_url, product_ids = p_product_ids,
    discount_type = p_discount_type, discount_value = p_discount_value,
    shipping_discount_type = p_shipping_discount_type, shipping_discount_value = p_shipping_discount_value,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''), expires_at = NULLIF(trim(p_expires_at), '')
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found';
  END IF;
  RETURN sunset._campaign_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_campaign(text, text, text, text, text[], text, double precision, text, double precision, boolean, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.list_active_campaigns()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'title', title, 'image_url', image_url, 'product_ids', to_jsonb(product_ids),
    'discount_type', discount_type, 'discount_value', discount_value,
    'shipping_discount_type', shipping_discount_type, 'shipping_discount_value', shipping_discount_value,
    'expires_at', expires_at
  ) ORDER BY created_at DESC), '[]'::jsonb)
  FROM sunset.campaigns
  WHERE active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION sunset.list_active_campaigns() TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.get_campaign(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'title', title, 'image_url', image_url, 'product_ids', to_jsonb(product_ids),
    'discount_type', discount_type, 'discount_value', discount_value,
    'shipping_discount_type', shipping_discount_type, 'shipping_discount_value', shipping_discount_value,
    'expires_at', expires_at
  )
  FROM sunset.campaigns
  WHERE id = p_id AND active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION sunset.get_campaign(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Cupons — CRUD admin (discount_type/value passam a valer pra QUALQUER
-- kind: em 'frete' representam o desconto sobre o frete, em 'aniversario'
-- o desconto de produto liberado só no mês do aniversário do cliente)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'code', code, 'kind', kind, 'discount_type', discount_type, 'discount_value', discount_value,
    'allow_campaign_checkout', (allow_campaign_checkout <> 0), 'active', (active <> 0),
    'expires_at', expires_at, 'max_uses', max_uses, 'used_count', used_count, 'created_at', created_at
  ) FROM sunset.coupons WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS sunset.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint);

CREATE OR REPLACE FUNCTION sunset.admin_create_coupon(
  p_token text, p_code text, p_kind text, p_discount_type text, p_discount_value double precision,
  p_allow_campaign_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_kind NOT IN ('desconto', 'frete', 'aniversario') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  IF p_discount_type IS NULL OR p_discount_value IS NULL THEN
    RAISE EXCEPTION 'discount_type and discount_value are required';
  END IF;
  IF p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid discount_type';
  END IF;
  IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
    RAISE EXCEPTION 'percent discount must be between 0 and 100';
  END IF;
  IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
    RAISE EXCEPTION 'fixed discount must be positive';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  BEGIN
    INSERT INTO sunset.coupons (id, code, kind, discount_type, discount_value, allow_campaign_checkout, expires_at, max_uses)
      VALUES (v_id, v_code, p_kind, p_discount_type, p_discount_value,
        CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END, NULLIF(trim(p_expires_at), ''), p_max_uses);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;
  RETURN sunset._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Público — validate_coupon ganha p_customer_birthdate (checa mês de
-- aniversário pra kind='aniversario')
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset.validate_coupon(text, text);

CREATE OR REPLACE FUNCTION sunset.validate_coupon(p_code text, p_campaign_id text DEFAULT NULL, p_customer_birthdate text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
DECLARE
  v_coupon sunset.coupons%ROWTYPE;
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
  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.validate_coupon(text, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- create_order — mesma assinatura de sunset_campanhas_cupons.sql, corpo
-- troca free_shipping por desconto percentual/fixo de frete e passa a
-- checar o mês de aniversário pra kind='aniversario'.
-- ─────────────────────────────────────────────────────

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

    v_subtotal := v_subtotal + v_product.price * v_quantity;
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

    IF v_coupon.kind = 'frete' THEN
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_discount_amount := v_discount_amount + v_coupon.discount_value;
      END IF;
    END IF;
    UPDATE sunset.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
    v_coupon_code := v_coupon.code;
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
