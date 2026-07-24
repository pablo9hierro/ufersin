-- =====================================================
-- 1) Cada cupom extra de uma campanha ganha SUA PRÓPRIA mensagem de
--    WhatsApp (message_template), em vez de forçosamente reusar a da
--    campanha — cada cupom pode ter um texto de disparo diferente.
--
-- 2) crm_segment_coupons ganha last_synced_segment_criteria: um
--    "retrato" do filter_criteria do segmento no momento em que o
--    trigger_criteria da campanha 'evento' foi calibrado pela última vez
--    (criação ou edição). Isso permite detectar com precisão QUAL campo
--    exato mudou desde então — antes só dava pra saber "tem campo novo
--    que a campanha não cobre", agora também dá pra saber "esse campo já
--    existia mas o valor dele mudou" (que também precisa de atenção).
--    Campo removido do segmento continua sendo ignorado de propósito.
--
-- Execução: depois de sunset_crm_campanhas_multi_cupom.sql.
-- =====================================================

ALTER TABLE sunset.crm_campanha_extra_coupons ADD COLUMN IF NOT EXISTS message_template TEXT;
ALTER TABLE sunset.crm_segment_coupons ADD COLUMN IF NOT EXISTS last_synced_segment_criteria JSONB;

-- Campanhas já existentes: sem retrato anterior, assume o critério ATUAL
-- do segmento como ponto de partida (não trata todo mundo como
-- desatualizado de repente só por causa desta migration).
UPDATE sunset.crm_segment_coupons cc
  SET last_synced_segment_criteria = (SELECT s.filter_criteria FROM sunset.crm_segments s WHERE s.id = cc.segment_id)
  WHERE last_synced_segment_criteria IS NULL;

CREATE OR REPLACE FUNCTION sunset._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'last_synced_segment_criteria', last_synced_segment_criteria,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'coupon', sunset._coupon_json(ec.coupon_id), 'message_template', ec.message_template
      ) ORDER BY ec.created_at)
      FROM sunset.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM sunset.crm_segment_coupons WHERE id = p_id;
$$;

-- admin_create_campanha_coupon: mesma assinatura de antes, só passa a
-- gravar o retrato inicial do critério do segmento.
CREATE OR REPLACE FUNCTION sunset.admin_create_campanha_coupon(
  p_token text,
  p_segment_id text,
  p_orientation text,
  p_message_template text,
  p_code text,
  p_customer_whatsapps text[] DEFAULT '{}',
  p_trigger_criteria jsonb DEFAULT NULL,
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
  v_segment       sunset.crm_segments%ROWTYPE;
  v_coupon_id     text := gen_random_uuid()::text;
  v_row_id        text := gen_random_uuid()::text;
  v_code          text := upper(trim(p_code));
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_kind          text;
  v_pd            jsonb;
  v_whatsapp      text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_orientation NOT IN ('segmento', 'evento') THEN
    RAISE EXCEPTION 'invalid orientation';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;

  SELECT * INTO v_segment FROM sunset.crm_segments WHERE id = p_segment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;

  IF p_orientation = 'evento' THEN
    IF p_trigger_criteria IS NULL THEN
      RAISE EXCEPTION 'trigger_criteria is required for orientation=evento';
    END IF;
    IF p_trigger_criteria = v_segment.filter_criteria THEN
      RAISE EXCEPTION 'trigger_criteria must differ from the segment''s current filter in at least one field';
    END IF;
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

  INSERT INTO sunset.crm_segment_coupons (
    id, segment_id, coupon_id, orientation, trigger_criteria, message_template, uses_per_customer, last_fired_at,
    last_synced_segment_criteria
  ) VALUES (
    v_row_id, p_segment_id, v_coupon_id, p_orientation, p_trigger_criteria,
    trim(p_message_template), p_uses_per_customer,
    CASE WHEN p_orientation = 'segmento' THEN now()::text ELSE NULL END,
    v_segment.filter_criteria
  );

  IF p_orientation = 'segmento' THEN
    FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
      IF v_whatsapp IS NOT NULL AND trim(v_whatsapp) <> '' THEN
        INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          SELECT gen_random_uuid()::text, v_coupon_id, v_whatsapp, p_uses_per_customer, 0
          WHERE NOT EXISTS (
            SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon_id AND customer_whatsapp = v_whatsapp
          );
      END IF;
    END LOOP;
  END IF;

  RETURN sunset._campanha_coupon_json(v_row_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_campanha_coupon(text, text, text, text, text, text[], jsonb, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- admin_update_campanha_coupon: mesma assinatura, mas agora sempre que
-- p_trigger_criteria vem preenchido (só acontece pra 'evento'), também
-- re-sincroniza o retrato do critério do segmento — o admin acabou de
-- revisar/ajustar os campos-alvo, então esse é o novo ponto de partida.
CREATE OR REPLACE FUNCTION sunset.admin_update_campanha_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_trigger_criteria jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row           sunset.crm_segment_coupons%ROWTYPE;
  v_segment       sunset.crm_segments%ROWTYPE;
  v_kind          text;
  v_pd            jsonb;
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_row FROM sunset.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE sunset.coupons SET
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = v_row.coupon_id;

  DELETE FROM sunset.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE sunset.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  IF v_row.orientation = 'evento' AND p_trigger_criteria IS NOT NULL THEN
    SELECT * INTO v_segment FROM sunset.crm_segments WHERE id = v_row.segment_id;
  END IF;

  UPDATE sunset.crm_segment_coupons SET
    message_template = trim(p_message_template),
    uses_per_customer = p_uses_per_customer,
    trigger_criteria = CASE WHEN orientation = 'evento' AND p_trigger_criteria IS NOT NULL THEN p_trigger_criteria ELSE trigger_criteria END,
    last_synced_segment_criteria = CASE WHEN orientation = 'evento' AND p_trigger_criteria IS NOT NULL THEN v_segment.filter_criteria ELSE last_synced_segment_criteria END
  WHERE id = p_id;

  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb, jsonb) TO anon, authenticated;

-- admin_create_campanha_extra_coupon ganha p_message_template — assinatura
-- mudou (mais um parâmetro), precisa derrubar a versão antiga primeiro.
DROP FUNCTION IF EXISTS sunset.admin_create_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION sunset.admin_create_campanha_extra_coupon(
  p_token text,
  p_campanha_id text,
  p_code text,
  p_message_template text,
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
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
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

  INSERT INTO sunset.crm_campanha_extra_coupons (id, campanha_id, coupon_id, message_template)
    VALUES (v_row_id, p_campanha_id, v_coupon_id, trim(p_message_template));

  FOR v_grant IN SELECT * FROM sunset.coupon_grants WHERE coupon_id = v_campanha.coupon_id LOOP
    INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
      VALUES (gen_random_uuid()::text, v_coupon_id, v_grant.customer_whatsapp, p_uses_per_customer, 0);
  END LOOP;

  RETURN sunset._coupon_json(v_coupon_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
