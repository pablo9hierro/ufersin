-- =====================================================
-- Diferenciação de campanha "selfie service" (cliente monta o próprio
-- carrinho a partir dos itens da campanha, em /banner, cada produto com
-- seu desconto próprio) vs "kit" (pacote fechado — ou compra tudo, ou não
-- compra nada — desconto único sobre o valor total somado).
--
-- kit: mantém discount_type/discount_value existentes (desconto sobre
-- v_subtotal) — "Desconto no valor total". O checkout só aceita o pedido
-- se ele contiver EXATAMENTE todos os produtos da campanha.
-- selfie_service: desconto por produto (campaign_product_discounts,
-- mesma forma de coupon_product_discounts) — "Desconto no produto". O
-- checkout aceita qualquer subconjunto não vazio dos produtos da campanha.
-- =====================================================

ALTER TABLE sunset.campaigns ADD COLUMN IF NOT EXISTS campaign_type TEXT NOT NULL DEFAULT 'kit' CHECK (campaign_type IN ('selfie_service', 'kit'));

CREATE TABLE IF NOT EXISTS sunset.campaign_product_discounts (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campaign_id    TEXT NOT NULL REFERENCES sunset.campaigns(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES sunset.products(id),
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS campaign_product_discounts_campaign_idx ON sunset.campaign_product_discounts (campaign_id);
ALTER TABLE sunset.campaign_product_discounts ENABLE ROW LEVEL SECURITY;

-- kit precisa do desconto de valor total; selfie_service precisa de pelo
-- menos um produto com desconto cadastrado (checado no INSERT, não dá pra
-- expressar isso num CHECK simples porque envolve outra tabela).
ALTER TABLE sunset.campaigns DROP CONSTRAINT IF EXISTS campaigns_has_discount;
ALTER TABLE sunset.campaigns ADD CONSTRAINT campaigns_has_discount CHECK (
  campaign_type = 'selfie_service'
  OR (discount_type IS NOT NULL AND discount_value IS NOT NULL)
  OR (shipping_discount_type IS NOT NULL AND shipping_discount_value IS NOT NULL)
);

CREATE OR REPLACE FUNCTION sunset._campaign_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'title', c.title, 'image_url', c.image_url, 'product_ids', to_jsonb(c.product_ids),
    'campaign_type', c.campaign_type,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'active', (c.active <> 0), 'starts_at', c.starts_at, 'expires_at', c.expires_at, 'created_at', c.created_at,
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM sunset.campaign_product_discounts pd WHERE pd.campaign_id = c.id
    ), '[]'::jsonb)
  ) FROM sunset.campaigns c WHERE c.id = p_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_list_campaigns(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(sunset._campaign_json(id) ORDER BY created_at DESC) FROM sunset.campaigns), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_campaigns(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_create_campaign(text, text, text, text[], text, double precision, text, double precision, text, text);

CREATE OR REPLACE FUNCTION sunset.admin_create_campaign(
  p_token text, p_title text, p_image_url text, p_product_ids text[],
  p_campaign_type text DEFAULT 'kit',
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL, p_shipping_discount_value double precision DEFAULT NULL,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_pd jsonb;
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
  IF p_campaign_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid campaign_type';
  END IF;
  IF p_campaign_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service campaign';
    END IF;
  ELSE
    IF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
      RAISE EXCEPTION 'a kit campaign needs a product discount and/or a shipping discount';
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
  END IF;

  INSERT INTO sunset.campaigns (
    id, title, image_url, product_ids, campaign_type, discount_type, discount_value,
    shipping_discount_type, shipping_discount_value, starts_at, expires_at
  ) VALUES (
    v_id, trim(p_title), p_image_url, p_product_ids, p_campaign_type,
    CASE WHEN p_campaign_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    CASE WHEN p_campaign_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    p_shipping_discount_type, p_shipping_discount_value,
    NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), '')
  );

  IF p_campaign_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.campaign_product_discounts (id, campaign_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN sunset._campaign_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_campaign(text, text, text, text[], text, text, double precision, text, double precision, text, text, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_campaign(text, text, text, text, text[], text, double precision, text, double precision, boolean, text, text);

CREATE OR REPLACE FUNCTION sunset.admin_update_campaign(
  p_token text, p_id text, p_title text, p_image_url text, p_product_ids text[],
  p_campaign_type text,
  p_discount_type text, p_discount_value double precision,
  p_shipping_discount_type text, p_shipping_discount_value double precision,
  p_active boolean,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_pd jsonb;
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
  IF p_campaign_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid campaign_type';
  END IF;
  IF p_campaign_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service campaign';
    END IF;
  ELSIF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a kit campaign needs a product discount and/or a shipping discount';
  END IF;

  UPDATE sunset.campaigns SET
    title = trim(p_title), image_url = p_image_url, product_ids = p_product_ids,
    campaign_type = p_campaign_type,
    discount_type = CASE WHEN p_campaign_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    discount_value = CASE WHEN p_campaign_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    shipping_discount_type = p_shipping_discount_type, shipping_discount_value = p_shipping_discount_value,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''), expires_at = NULLIF(trim(p_expires_at), '')
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found';
  END IF;

  DELETE FROM sunset.campaign_product_discounts WHERE campaign_id = p_id;
  IF p_campaign_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.campaign_product_discounts (id, campaign_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN sunset._campaign_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_campaign(text, text, text, text, text[], text, text, double precision, text, double precision, boolean, text, text, jsonb) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Público — carrossel/banner + checkout
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.list_active_campaigns()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT COALESCE(jsonb_agg(sunset._campaign_json(id) ORDER BY created_at DESC), '[]'::jsonb)
  FROM sunset.campaigns
  WHERE active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION sunset.list_active_campaigns() TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.get_campaign(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT sunset._campaign_json(id)
  FROM sunset.campaigns
  WHERE id = p_id AND active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION sunset.get_campaign(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- create_order: kit exige o pacote completo (nem mais, nem menos produtos
-- distintos que a campanha); selfie_service aceita qualquer subconjunto e
-- usa desconto por produto (campaign_product_discounts) em vez do
-- desconto sobre o valor total.
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text);

CREATE OR REPLACE FUNCTION sunset.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text,
  p_address text,
  p_items jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_campaign_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_item               jsonb;
  v_product            sunset.products%ROWTYPE;
  v_quantity           bigint;
  v_subtotal           double precision := 0;
  v_shipping           double precision := 0;
  v_discount_amount    double precision := 0;
  v_shipping_discount  double precision := 0;
  v_customer_id        text;
  v_order_id           text := gen_random_uuid()::text;
  v_item_id            text;
  v_settings           sunset.shipping_settings%ROWTYPE;
  v_km                 double precision;
  v_birthdate          date;
  v_campaign           sunset.campaigns%ROWTYPE;
  v_coupon             sunset.coupons%ROWTYPE;
  v_coupon_code        text;
  v_grant              sunset.coupon_grants%ROWTYPE;
  v_is_targeted        boolean;
  v_pd                 sunset.coupon_product_discounts%ROWTYPE;
  v_cpd                sunset.campaign_product_discounts%ROWTYPE;
  v_item_total         double precision;
  v_total              double precision;
  v_submitted_ids      text[];
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
    IF v_campaign.campaign_type = 'kit' THEN
      SELECT array_agg(DISTINCT i->>'product_id') INTO v_submitted_ids FROM jsonb_array_elements(p_items) i;
      IF v_submitted_ids IS NULL OR array_length(v_submitted_ids, 1) <> array_length(v_campaign.product_ids, 1)
         OR NOT (v_submitted_ids @> v_campaign.product_ids) THEN
        RAISE EXCEPTION 'this kit campaign can only be purchased as the full bundle';
      END IF;
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

    IF v_campaign.id IS NOT NULL AND v_campaign.campaign_type = 'selfie_service' THEN
      SELECT * INTO v_cpd FROM sunset.campaign_product_discounts
        WHERE campaign_id = v_campaign.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_cpd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_cpd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_cpd.discount_value * v_quantity, v_item_total);
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
    IF v_campaign.campaign_type = 'kit' THEN
      IF v_campaign.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_campaign.discount_value / 100)::numeric, 2);
      ELSIF v_campaign.discount_type = 'fixed' THEN
        v_discount_amount := v_discount_amount + v_campaign.discount_value;
      END IF;
    END IF;
    -- selfie_service já somou o desconto por item no loop acima
    IF v_campaign.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_campaign.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_campaign.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_campaign.shipping_discount_value;
    END IF;
  END IF;

  IF v_coupon.id IS NOT NULL THEN
    IF v_coupon.kind = 'frete' THEN
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
