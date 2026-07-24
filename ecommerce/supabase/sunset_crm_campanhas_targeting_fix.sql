-- =====================================================
-- Cupom de campanha orientation='evento' nasce sem nenhuma concessão
-- (coupon_grants) — só ganha concessão quando o critério diferente
-- (trigger_criteria) se tornar verdade pra algum cliente, mais tarde.
-- Sem essa correção, create_order/validate_coupon tratariam esse cupom
-- como PÚBLICO (já que "tem concessão" era o único jeito de saber que um
-- cupom é exclusivo) enquanto ele tiver zero concessões — deixando
-- qualquer cliente usar o código antes da hora. Agora, também conta como
-- exclusivo se ele estiver referenciado em crm_segment_coupons.
--
-- Execução: depois de sunset_rename_campaign_to_promotion.sql E de
-- sunset_crm_campanhas_eventos.sql (precisa da tabela crm_segment_coupons).
-- =====================================================

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
