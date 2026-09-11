-- Contexto fiscal opcional no checkout da vitrine (seção 6/7 do pedido de
-- perfis fiscais: "PDV + checkout da vitrine juntos"). Mesmo espírito do
-- toggle novo em pdv.rs::PdvSaleInput -- todos os parâmetros são NOVOS e
-- OPCIONAIS com DEFAULT que preserva 100% o comportamento atual (cliente
-- que não marca "emitir nota" no frontend nunca passa nenhum destes, e o
-- fluxo continua idêntico a hoje, sem CPF/CNPJ). Perfil fiscal manual não é
-- oferecido no checkout público (só no PDV, decisão já fechada) -- aqui
-- fica sempre `fiscal_profile_mode = 'automatico'` (default da coluna, ver
-- migration 0058 do ecommerce/backend).
--
-- Validação aqui é só de FORMATO/presença básica (11 ou 14 dígitos) --
-- checagem completa de dígito verificador acontece no cliente
-- (fiscalValidation.ts) antes de chamar essa RPC; back-end nunca confia
-- só no cliente pra dado que entra numa nota fiscal real, mas duplicar o
-- algoritmo completo de dígito verificador em PL/pgSQL não agrega
-- segurança real aqui (mesmo risco de CPF/CNPJ formalmente válido mas
-- falso já existe hoje em qualquer emissão) -- o bloqueio forte de
-- verdade é a validação de FORMATO na resolução fiscal (ecommerce/backend
-- src/fiscal/validation.rs), que roda de novo no momento da emissão.

DROP FUNCTION IF EXISTS resolutoo.create_order(
  text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION resolutoo.create_order(
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
  p_promotion_id text DEFAULT NULL,
  p_tenant_slug text DEFAULT NULL,
  p_emitir_nota_fiscal boolean DEFAULT false,
  p_destinatario_documento_tipo text DEFAULT NULL,
  p_destinatario_documento text DEFAULT NULL,
  p_destinatario_nome text DEFAULT NULL,
  p_destinatario_uf text DEFAULT NULL,
  p_destinatario_municipio_ibge text DEFAULT NULL,
  p_destinatario_cep text DEFAULT NULL,
  p_destinatario_endereco text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = resolutoo, sunset, public, extensions AS $$
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
  v_promotion          resolutoo.promotions%ROWTYPE;
  v_coupon             resolutoo.coupons%ROWTYPE;
  v_coupon_code        text;
  v_grant               resolutoo.coupon_grants%ROWTYPE;
  v_is_targeted        boolean;
  v_pd                 resolutoo.coupon_product_discounts%ROWTYPE;
  v_cpd                resolutoo.promotion_product_discounts%ROWTYPE;
  v_item_total         double precision;
  v_total              double precision;
  v_submitted_ids      text[];
  v_tenant_id          text;
  v_requires_18        boolean;
  v_doc_digits         text;
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

  IF p_emitir_nota_fiscal THEN
    IF p_destinatario_documento_tipo NOT IN ('cpf', 'cnpj') THEN
      RAISE EXCEPTION 'destinatario_documento_tipo deve ser cpf ou cnpj pra emitir nota fiscal';
    END IF;
    v_doc_digits := regexp_replace(coalesce(p_destinatario_documento, ''), '[^0-9]', '', 'g');
    IF (p_destinatario_documento_tipo = 'cpf' AND length(v_doc_digits) <> 11)
       OR (p_destinatario_documento_tipo = 'cnpj' AND length(v_doc_digits) <> 14) THEN
      RAISE EXCEPTION 'documento do destinatário inválido pra emissão de nota fiscal';
    END IF;
  END IF;

  SELECT id, vende_mais_18 INTO v_tenant_id, v_requires_18 FROM sunset.tenants WHERE slug = p_tenant_slug;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'store not found';
  END IF;

  IF v_requires_18 THEN
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
  ELSIF p_customer_birthdate IS NOT NULL AND trim(p_customer_birthdate) <> '' THEN
    BEGIN
      v_birthdate := p_customer_birthdate::date;
    EXCEPTION WHEN OTHERS THEN
      v_birthdate := NULL;
    END;
  END IF;

  IF p_promotion_id IS NOT NULL THEN
    SELECT * INTO v_promotion FROM resolutoo.promotions WHERE id = p_promotion_id;
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
    SELECT * INTO v_coupon FROM resolutoo.coupons WHERE upper(code) = upper(trim(p_coupon_code));
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
    IF v_coupon.kind = 'aniversario' AND v_birthdate IS NOT NULL AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM resolutoo.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM resolutoo.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE resolutoo.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;
    v_coupon_code := v_coupon.code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM sunset.products
      WHERE id = (v_item->>'product_id') AND tenant_id = v_tenant_id FOR UPDATE;
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
      SELECT * INTO v_pd FROM resolutoo.coupon_product_discounts
        WHERE coupon_id = v_coupon.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_pd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_pd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_pd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;

    SELECT pd.* INTO v_cpd FROM resolutoo.promotion_product_discounts pd
      JOIN resolutoo.promotions p ON p.id = pd.promotion_id
      WHERE pd.product_id = v_product.id
        AND p.promotion_type = 'selfie_service'
        AND p.active <> 0
        AND (p.starts_at IS NULL OR p.starts_at::timestamptz <= now())
        AND (p.expires_at IS NULL OR p.expires_at::timestamptz > now())
      ORDER BY (p.id = v_promotion.id) DESC
      LIMIT 1;
    IF FOUND THEN
      IF v_cpd.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_item_total * v_cpd.discount_value / 100)::numeric, 2);
      ELSE
        v_discount_amount := v_discount_amount + LEAST(v_cpd.discount_value * v_quantity, v_item_total);
      END IF;
    END IF;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM sunset.shipping_settings WHERE tenant_id = v_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'shipping is not configured for this store';
    END IF;
    v_km := resolutoo._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
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
    UPDATE resolutoo.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  -- Regra de negocio explicita (nao e exigencia da SEFAZ): a partir de
  -- R$500 o total do pedido, identificar o comprador deixa de ser
  -- opt-in e vira obrigatorio -- mesmo limiar usado no PDV
  -- (ecommerce/backend/src/fiscal/validation.rs::IDENTIFICACAO_OBRIGATORIA_A_PARTIR_DE).
  IF v_total >= 500 AND NOT coalesce(p_emitir_nota_fiscal, false) THEN
    RAISE EXCEPTION 'vendas a partir de R$ 500,00 exigem identificacao do comprador (CPF/CNPJ)';
  END IF;

  SELECT id INTO v_customer_id FROM sunset.customers WHERE whatsapp = p_customer_whatsapp AND tenant_id = v_tenant_id;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO sunset.customers (id, name, whatsapp, tenant_id) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, v_tenant_id);
  ELSE
    UPDATE sunset.customers SET name = p_customer_name WHERE id = v_customer_id;
  END IF;

  UPDATE resolutoo.customers SET name = p_customer_name, birthdate = COALESCE(p_customer_birthdate, birthdate)
    WHERE whatsapp = p_customer_whatsapp AND tenant_id = v_tenant_id;

  INSERT INTO sunset.orders (
    id, tenant_id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount,
    emitir_nota_fiscal, destinatario_documento_tipo, destinatario_documento, destinatario_nome,
    destinatario_uf, destinatario_municipio_ibge, destinatario_cep, destinatario_endereco
  ) VALUES (
    v_order_id, v_tenant_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    (v_shipping - v_shipping_discount), v_total, p_customer_lat, p_customer_lng,
    v_discount_amount,
    coalesce(p_emitir_nota_fiscal, false), p_destinatario_documento_tipo, p_destinatario_documento,
    p_destinatario_nome, p_destinatario_uf, p_destinatario_municipio_ibge, p_destinatario_cep,
    p_destinatario_endereco
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM sunset.products WHERE id = (v_item->>'product_id') AND tenant_id = v_tenant_id;
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO sunset.order_items (id, tenant_id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_tenant_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);
  END LOOP;

  RETURN jsonb_build_object('id', v_order_id, 'total', v_total, 'payment_method', p_payment_method, 'payment_status', 'pendente');
END;
$$;

GRANT EXECUTE ON FUNCTION resolutoo.create_order(
  text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text, text,
  boolean, text, text, text, text, text, text, text
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
