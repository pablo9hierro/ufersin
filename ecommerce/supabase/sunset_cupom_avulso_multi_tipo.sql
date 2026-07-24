-- =====================================================
-- Cupom avulso deixa de ter um único "tipo" exclusivo — agora são
-- eixos independentes que combinam livremente no mesmo cupom:
--   - desconto no subtotal (nenhum/flat/por produto) — igual campanha,
--     só que aqui "nenhum" é permitido (cupom pode ser só de frete);
--   - "também dar desconto no frete" (shipping_discount_type/value) —
--     mesmas colunas que campanha já usa, só nunca eram expostas aqui;
--   - "aniversário do cliente": passa a ser um cupom ALVO de verdade —
--     concedido automaticamente N dias antes do aniversário de cada
--     cliente (não mais "digite o código durante o mês"), com mensagem
--     de WhatsApp própria;
--   - "aniversário da loja": mesma ideia, mas concede pra TODOS os
--     clientes, disparado N dias antes de uma data fixa (MM-DD).
--   - início/fim de validade (starts_at somado ao expires_at que já
--     existia) valem pra QUALQUER cupom avulso, não só os de
--     aniversário.
--
-- kind ('desconto'|'frete'|'aniversario'|'produto') continua existindo
-- só por compatibilidade com cupons já criados pelo fluxo antigo — cupom
-- NOVO sempre nasce com kind='desconto' ou 'produto' (frete e aniversário
-- viram os campos abaixo, combináveis com qualquer um dos dois).
--
-- Execução: pode rodar a qualquer momento (idempotente).
-- =====================================================

ALTER TABLE sunset.coupons ADD COLUMN IF NOT EXISTS starts_at TEXT;
ALTER TABLE sunset.coupons ADD COLUMN IF NOT EXISTS message_template TEXT;
ALTER TABLE sunset.coupons ADD COLUMN IF NOT EXISTS bday_customer_days_before BIGINT;
ALTER TABLE sunset.coupons ADD COLUMN IF NOT EXISTS bday_store_date TEXT;
ALTER TABLE sunset.coupons ADD COLUMN IF NOT EXISTS bday_store_days_before BIGINT;

CREATE OR REPLACE FUNCTION sunset._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_promotion_checkout', (c.allow_promotion_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'active', (c.active <> 0),
    'starts_at', c.starts_at, 'expires_at', c.expires_at, 'max_uses', c.max_uses, 'used_count', c.used_count, 'created_at', c.created_at,
    'message_template', c.message_template,
    'bday_customer_days_before', c.bday_customer_days_before,
    'bday_store_date', c.bday_store_date, 'bday_store_days_before', c.bday_store_days_before,
    'grant_count', (SELECT COUNT(*) FROM sunset.coupon_grants g WHERE g.coupon_id = c.id),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM sunset.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  ) FROM sunset.coupons c WHERE c.id = p_id;
$$;

DROP FUNCTION IF EXISTS sunset.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint, jsonb);

CREATE OR REPLACE FUNCTION sunset.admin_create_coupon(
  p_token text,
  p_code text,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_combinable_with_public boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_message_template text DEFAULT NULL,
  p_bday_customer_days_before bigint DEFAULT NULL,
  p_bday_store_date text DEFAULT NULL,
  p_bday_store_days_before bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_has_bday boolean := p_bday_customer_days_before IS NOT NULL OR p_bday_store_date IS NOT NULL;
  v_kind text := CASE WHEN v_has_products THEN 'produto' ELSE 'desconto' END;
  v_pd jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid discount_type';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  IF v_has_bday AND (trim(COALESCE(p_message_template, '')) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%') THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_bday_customer_days_before IS NOT NULL AND p_bday_customer_days_before < 0 THEN
    RAISE EXCEPTION 'bday_customer_days_before must be zero or positive';
  END IF;
  IF p_bday_store_date IS NOT NULL AND p_bday_store_days_before IS NULL THEN
    RAISE EXCEPTION 'bday_store_days_before is required when bday_store_date is set';
  END IF;

  BEGIN
    INSERT INTO sunset.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      allow_promotion_checkout, combinable_with_public, starts_at, expires_at, max_uses,
      message_template, bday_customer_days_before, bday_store_date, bday_store_days_before
    ) VALUES (
      v_id, v_code, v_kind,
      CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      p_shipping_discount_type, p_shipping_discount_value,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), ''), p_max_uses,
      NULLIF(trim(p_message_template), ''), p_bday_customer_days_before,
      NULLIF(trim(p_bday_store_date), ''), p_bday_store_days_before
    );
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

  RETURN sunset._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_coupon(text, text, text, double precision, text, double precision, boolean, boolean, text, text, bigint, jsonb, text, bigint, text, bigint) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_coupon(text, text, boolean, boolean, text, bigint, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION sunset.admin_update_coupon(
  p_token text,
  p_id text,
  p_active boolean,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_combinable_with_public boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_message_template text DEFAULT NULL,
  p_bday_customer_days_before bigint DEFAULT NULL,
  p_bday_store_date text DEFAULT NULL,
  p_bday_store_days_before bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_has_bday boolean := p_bday_customer_days_before IS NOT NULL OR p_bday_store_date IS NOT NULL;
  v_kind text := CASE WHEN v_has_products THEN 'produto' ELSE 'desconto' END;
  v_pd jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM sunset.coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  IF v_has_bday AND (trim(COALESCE(p_message_template, '')) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%') THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_bday_store_date IS NOT NULL AND p_bday_store_days_before IS NULL THEN
    RAISE EXCEPTION 'bday_store_days_before is required when bday_store_date is set';
  END IF;

  UPDATE sunset.coupons SET
    kind = v_kind,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
    shipping_discount_type = p_shipping_discount_type,
    shipping_discount_value = p_shipping_discount_value,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''),
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    message_template = NULLIF(trim(p_message_template), ''),
    bday_customer_days_before = p_bday_customer_days_before,
    bday_store_date = NULLIF(trim(p_bday_store_date), ''),
    bday_store_days_before = p_bday_store_days_before
  WHERE id = p_id;

  DELETE FROM sunset.coupon_product_discounts WHERE coupon_id = p_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN sunset._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_coupon(text, text, boolean, text, double precision, text, double precision, boolean, boolean, text, text, bigint, jsonb, text, bigint, text, bigint) TO anon, authenticated;

-- validate_coupon/create_order: cupom com starts_at ainda não começou
-- não pode ser usado; cupom de aniversário (cliente ou loja) é sempre
-- "alvo" (só quem foi concedido pode usar), mesma regra que campanha.
DROP FUNCTION IF EXISTS sunset.validate_coupon(text, text, text, text);

CREATE OR REPLACE FUNCTION sunset.validate_coupon(
  p_code text,
  p_promotion_id text DEFAULT NULL,
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
  IF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at::timestamptz > now() THEN
    RAISE EXCEPTION 'coupon is not active yet';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
  END IF;
  IF v_coupon.kind = 'aniversario' THEN
    IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = ''
       OR extract(month FROM p_customer_birthdate::date) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon.id)
      OR EXISTS(SELECT 1 FROM sunset.crm_segment_coupons WHERE coupon_id = v_coupon.id)
      OR EXISTS(SELECT 1 FROM sunset.crm_campanha_extra_coupons WHERE coupon_id = v_coupon.id)
      OR v_coupon.bday_customer_days_before IS NOT NULL OR v_coupon.bday_store_date IS NOT NULL
    INTO v_is_targeted;
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
  p_promotion_id text DEFAULT NULL
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
  v_promotion          sunset.promotions%ROWTYPE;
  v_coupon             sunset.coupons%ROWTYPE;
  v_coupon_code        text;
  v_grant              sunset.coupon_grants%ROWTYPE;
  v_is_targeted        boolean;
  v_pd                 sunset.coupon_product_discounts%ROWTYPE;
  v_cpd                sunset.promotion_product_discounts%ROWTYPE;
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

  IF p_promotion_id IS NOT NULL THEN
    SELECT * INTO v_promotion FROM sunset.promotions WHERE id = p_promotion_id;
    IF NOT FOUND OR v_promotion.active = 0
       OR (v_promotion.starts_at IS NOT NULL AND v_promotion.starts_at::timestamptz > now())
       OR (v_promotion.expires_at IS NOT NULL AND v_promotion.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'promotion is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_promotion.product_ids))
    ) THEN
      RAISE EXCEPTION 'this promotion checkout can only contain the promotion products';
    END IF;
    IF v_promotion.promotion_type = 'kit' THEN
      SELECT array_agg(DISTINCT i->>'product_id') INTO v_submitted_ids FROM jsonb_array_elements(p_items) i;
      IF v_submitted_ids IS NULL OR array_length(v_submitted_ids, 1) <> array_length(v_promotion.product_ids, 1)
         OR NOT (v_submitted_ids @> v_promotion.product_ids) THEN
        RAISE EXCEPTION 'this kit promotion can only be purchased as the full bundle';
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
    IF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at::timestamptz > now() THEN
      RAISE EXCEPTION 'coupon is not active yet';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon.id)
        OR EXISTS(SELECT 1 FROM sunset.crm_segment_coupons WHERE coupon_id = v_coupon.id)
        OR EXISTS(SELECT 1 FROM sunset.crm_campanha_extra_coupons WHERE coupon_id = v_coupon.id)
        OR v_coupon.bday_customer_days_before IS NOT NULL OR v_coupon.bday_store_date IS NOT NULL
      INTO v_is_targeted;
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

    IF v_promotion.id IS NOT NULL AND v_promotion.promotion_type = 'selfie_service' THEN
      SELECT * INTO v_cpd FROM sunset.promotion_product_discounts
        WHERE promotion_id = v_promotion.id AND product_id = v_product.id;
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

  IF v_promotion.id IS NOT NULL THEN
    IF v_promotion.promotion_type = 'kit' THEN
      IF v_promotion.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_promotion.discount_value / 100)::numeric, 2);
      ELSIF v_promotion.discount_type = 'fixed' THEN
        v_discount_amount := v_discount_amount + v_promotion.discount_value;
      END IF;
    END IF;
    IF v_promotion.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_promotion.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_promotion.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_promotion.shipping_discount_value;
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
    discount_amount, shipping_discount, coupon_code, promotion_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_promotion_id
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

-- Concede (idempotente) os cupons de aniversário (cliente e loja) cujo
-- dia de disparo é HOJE — "dia de disparo" = data-alvo menos
-- dias_antes. Sem cron no projeto, isso roda do front (AdminCrm) toda
-- vez que o admin abre o CRM, igual ao auto-check de campanha evento.
CREATE OR REPLACE FUNCTION sunset.admin_check_birthday_coupons(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_coupon    sunset.coupons%ROWTYPE;
  v_customer  sunset.customers%ROWTYPE;
  v_target    date;
  v_out       jsonb := '[]'::jsonb;
  v_newly     text[];
BEGIN
  PERFORM sunset._require_admin(p_token);

  FOR v_coupon IN SELECT * FROM sunset.coupons WHERE active = 1 AND bday_customer_days_before IS NOT NULL LOOP
    v_newly := '{}';
    FOR v_customer IN SELECT * FROM sunset.customers WHERE birthdate IS NOT NULL LOOP
      v_target := current_date + v_coupon.bday_customer_days_before;
      IF extract(month FROM v_customer.birthdate) = extract(month FROM v_target)
         AND extract(day FROM v_customer.birthdate) = extract(day FROM v_target) THEN
        IF NOT EXISTS (SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon.id AND customer_whatsapp = v_customer.whatsapp) THEN
          INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
            VALUES (gen_random_uuid()::text, v_coupon.id, v_customer.whatsapp, 1, 0);
          v_newly := array_append(v_newly, v_customer.whatsapp);
        END IF;
      END IF;
    END LOOP;
    IF array_length(v_newly, 1) > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'coupon_id', v_coupon.id, 'message_template', v_coupon.message_template, 'newly_granted', to_jsonb(v_newly)
      ));
    END IF;
  END LOOP;

  FOR v_coupon IN SELECT * FROM sunset.coupons WHERE active = 1 AND bday_store_date IS NOT NULL LOOP
    v_target := current_date + v_coupon.bday_store_days_before;
    IF to_char(v_target, 'MM-DD') = v_coupon.bday_store_date THEN
      v_newly := '{}';
      FOR v_customer IN SELECT * FROM sunset.customers LOOP
        IF NOT EXISTS (SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon.id AND customer_whatsapp = v_customer.whatsapp) THEN
          INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
            VALUES (gen_random_uuid()::text, v_coupon.id, v_customer.whatsapp, 1, 0);
          v_newly := array_append(v_newly, v_customer.whatsapp);
        END IF;
      END LOOP;
      IF array_length(v_newly, 1) > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'coupon_id', v_coupon.id, 'message_template', v_coupon.message_template, 'newly_granted', to_jsonb(v_newly)
        ));
      END IF;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_check_birthday_coupons(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
