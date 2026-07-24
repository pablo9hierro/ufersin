-- =====================================================
-- Uma campanha pode ter MAIS DE UM cupom exclusivo — o cupom "principal"
-- continua sendo crm_segment_coupons.coupon_id (não muda nada do que já
-- existe), e cupons extras entram numa tabela nova ligada à campanha.
-- Todos os cupons de uma campanha (principal + extras):
-- - compartilham orientation/trigger_criteria/message_template da campanha;
-- - têm SEU PRÓPRIO código/desconto/prazo/usos (cada um é um cupom de
--   verdade, só que todos entregues juntos quando a campanha dispara);
-- - ligam/desligam juntos (on/off é da campanha inteira, não por cupom);
-- - se a campanha já disparou (segmento imediato, ou evento já
--   concedido), um cupom extra criado depois é concedido na hora pra
--   quem já tinha ganhado o principal — não fica esperando o próximo
--   evento.
-- =====================================================

CREATE TABLE IF NOT EXISTS sunset.crm_campanha_extra_coupons (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campanha_id TEXT NOT NULL REFERENCES sunset.crm_segment_coupons(id) ON DELETE CASCADE,
  coupon_id   TEXT NOT NULL REFERENCES sunset.coupons(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS crm_campanha_extra_coupons_campanha_idx ON sunset.crm_campanha_extra_coupons (campanha_id);
ALTER TABLE sunset.crm_campanha_extra_coupons ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION sunset._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ec.id, 'coupon', sunset._coupon_json(ec.coupon_id)) ORDER BY ec.created_at)
      FROM sunset.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM sunset.crm_segment_coupons WHERE id = p_id;
$$;

-- Cria mais um cupom pra uma campanha já existente. Se a campanha já
-- concedeu o cupom principal pra alguém (segmento disparou na criação,
-- ou evento já disparou antes), concede esse cupom novo pra essa MESMA
-- lista na hora — senão ele ficaria esperando o próximo disparo à toa.
CREATE OR REPLACE FUNCTION sunset.admin_create_campanha_extra_coupon(
  p_token text,
  p_campanha_id text,
  p_code text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
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
  v_campanha      sunset.crm_segment_coupons%ROWTYPE;
  v_coupon_id     text := gen_random_uuid()::text;
  v_row_id        text := gen_random_uuid()::text;
  v_code          text := upper(trim(p_code));
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_kind          text;
  v_pd            jsonb;
  v_grant         sunset.coupon_grants%ROWTYPE;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_campanha FROM sunset.crm_segment_coupons WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a campanha coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  BEGIN
    INSERT INTO sunset.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      combinable_with_public, allow_promotion_checkout, expires_at, max_uses
    ) VALUES (
      v_coupon_id, v_code, v_kind,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_type WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_value WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      NULLIF(trim(p_expires_at), ''), p_max_uses
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  IF v_campanha.active = 0 THEN
    UPDATE sunset.coupons SET active = 0 WHERE id = v_coupon_id;
  END IF;

  INSERT INTO sunset.crm_campanha_extra_coupons (id, campanha_id, coupon_id) VALUES (v_row_id, p_campanha_id, v_coupon_id);

  -- A campanha já disparou antes (tem concessão do cupom principal)? Esse
  -- cupom novo entra pra mesma turma na hora, não espera o próximo evento.
  FOR v_grant IN SELECT * FROM sunset.coupon_grants WHERE coupon_id = v_campanha.coupon_id LOOP
    INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
      VALUES (gen_random_uuid()::text, v_coupon_id, v_grant.customer_whatsapp, p_uses_per_customer, 0);
  END LOOP;

  RETURN sunset._coupon_json(v_coupon_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- Só desvincula da campanha — não apaga sunset.coupons, mesma lógica de
-- admin_delete_campanha_coupon.
CREATE OR REPLACE FUNCTION sunset.admin_delete_campanha_extra_coupon(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  DELETE FROM sunset.crm_campanha_extra_coupons WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_delete_campanha_extra_coupon(text, text) TO anon, authenticated;

-- On/off da campanha agora liga/desliga TODOS os cupons dela (principal +
-- extras), não só o principal.
CREATE OR REPLACE FUNCTION sunset.admin_toggle_campanha_coupon(p_token text, p_id text, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row sunset.crm_segment_coupons%ROWTYPE;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_row FROM sunset.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  UPDATE sunset.crm_segment_coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END WHERE id = p_id;
  UPDATE sunset.coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END WHERE id = v_row.coupon_id;
  UPDATE sunset.coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END
    WHERE id IN (SELECT coupon_id FROM sunset.crm_campanha_extra_coupons WHERE campanha_id = p_id);
  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_toggle_campanha_coupon(text, text, boolean) TO anon, authenticated;

-- Reavaliar o evento agora concede TODOS os cupons da campanha (principal
-- + extras) pra quem bateu o critério, não só o principal.
CREATE OR REPLACE FUNCTION sunset.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row       sunset.crm_segment_coupons%ROWTYPE;
  v_coupon_id text;
  v_whatsapp  text;
  v_newly     text[] := '{}';
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_row FROM sunset.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas can be re-fired';
  END IF;
  IF v_row.active = 0 THEN
    RAISE EXCEPTION 'this campanha is paused';
  END IF;

  FOR v_coupon_id IN
    SELECT v_row.coupon_id
    UNION ALL
    SELECT coupon_id FROM sunset.crm_campanha_extra_coupons WHERE campanha_id = p_id
  LOOP
    FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
      IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon_id AND customer_whatsapp = v_whatsapp) THEN
        INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          VALUES (gen_random_uuid()::text, v_coupon_id, v_whatsapp, v_row.uses_per_customer, 0);
        IF v_coupon_id = v_row.coupon_id THEN
          v_newly := array_append(v_newly, v_whatsapp);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  IF array_length(v_newly, 1) > 0 THEN
    UPDATE sunset.crm_segment_coupons SET last_fired_at = now()::text WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_newly));
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_fire_campanha_event(text, text, text[]) TO anon, authenticated;

-- validate_coupon/create_order: cupom extra de campanha 'evento' que
-- ainda não disparou (zero concessão) também precisa contar como
-- exclusivo, mesma lacuna que já foi corrigida pro cupom principal.
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

NOTIFY pgrst, 'reload schema';
