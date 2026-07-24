-- =====================================================
-- Campo de descrição livre (texto interno, só pro admin, não vai pro
-- cliente): um pro gatilho do evento (crm_segment_coupons), e um pra
-- qualquer cupom (sunset.coupons — cobre avulso, principal e extra, já
-- que todos moram na mesma tabela).
--
-- Execução: depois de sunset_crm_campanhas_encerrar_evento_e_agenda.sql.
-- =====================================================

ALTER TABLE sunset.coupons ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE sunset.crm_segment_coupons ADD COLUMN IF NOT EXISTS trigger_description TEXT;

CREATE OR REPLACE FUNCTION sunset._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'description', c.description,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
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

CREATE OR REPLACE FUNCTION sunset._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'name', name, 'description', description, 'starts_at', starts_at, 'ends_at', ends_at,
    'trigger_criteria', trigger_criteria, 'trigger_description', trigger_description,
    'end_criteria', end_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'last_synced_segment_criteria', last_synced_segment_criteria,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'coupon', sunset._coupon_json(ec.coupon_id), 'message_template', ec.message_template, 'end_criteria', ec.end_criteria
      ) ORDER BY ec.created_at)
      FROM sunset.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM sunset.crm_segment_coupons WHERE id = p_id;
$$;

-- admin_set_campanha_gatilho ganha p_trigger_description (descrição
-- livre do gatilho, independente do critério em si).
CREATE OR REPLACE FUNCTION sunset.admin_set_campanha_gatilho(
  p_token text, p_id text, p_trigger_criteria jsonb, p_trigger_description text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row     sunset.crm_segment_coupons%ROWTYPE;
  v_segment sunset.crm_segments%ROWTYPE;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_row FROM sunset.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas have a gatilho';
  END IF;

  IF p_trigger_criteria IS NULL THEN
    UPDATE sunset.crm_segment_coupons SET
      trigger_criteria = NULL, last_synced_segment_criteria = NULL, trigger_description = NULLIF(trim(p_trigger_description), '')
    WHERE id = p_id;
    RETURN sunset._campanha_coupon_json(p_id);
  END IF;

  SELECT * INTO v_segment FROM sunset.crm_segments WHERE id = v_row.segment_id;
  IF p_trigger_criteria = v_segment.filter_criteria THEN
    RAISE EXCEPTION 'trigger_criteria must differ from the segment''s current filter in at least one field';
  END IF;

  UPDATE sunset.crm_segment_coupons SET
    trigger_criteria = p_trigger_criteria,
    last_synced_segment_criteria = v_segment.filter_criteria,
    trigger_description = NULLIF(trim(p_trigger_description), '')
  WHERE id = p_id;

  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_set_campanha_gatilho(text, text, jsonb, text) TO anon, authenticated;

-- admin_create_coupon (avulso) ganha p_description.
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
  p_bday_store_days_before bigint DEFAULT NULL,
  p_description text DEFAULT NULL
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
      message_template, bday_customer_days_before, bday_store_date, bday_store_days_before, description
    ) VALUES (
      v_id, v_code, v_kind,
      CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      p_shipping_discount_type, p_shipping_discount_value,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), ''), p_max_uses,
      NULLIF(trim(p_message_template), ''), p_bday_customer_days_before,
      NULLIF(trim(p_bday_store_date), ''), p_bday_store_days_before, NULLIF(trim(p_description), '')
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
GRANT EXECUTE ON FUNCTION sunset.admin_create_coupon(text, text, text, double precision, text, double precision, boolean, boolean, text, text, bigint, jsonb, text, bigint, text, bigint, text) TO anon, authenticated;

-- admin_update_coupon (avulso) ganha p_description.
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
  p_bday_store_days_before bigint DEFAULT NULL,
  p_description text DEFAULT NULL
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
    bday_store_days_before = p_bday_store_days_before,
    description = NULLIF(trim(p_description), '')
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
GRANT EXECUTE ON FUNCTION sunset.admin_update_coupon(text, text, boolean, text, double precision, text, double precision, boolean, boolean, text, text, bigint, jsonb, text, bigint, text, bigint, text) TO anon, authenticated;

-- admin_update_campanha_coupon (cupom principal) ganha p_description.
CREATE OR REPLACE FUNCTION sunset.admin_update_campanha_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row           sunset.crm_segment_coupons%ROWTYPE;
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
    starts_at = NULLIF(trim(p_starts_at), ''),
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    description = NULLIF(trim(p_description), '')
  WHERE id = v_row.coupon_id;

  DELETE FROM sunset.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE sunset.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  UPDATE sunset.crm_segment_coupons SET
    message_template = trim(p_message_template),
    uses_per_customer = p_uses_per_customer
  WHERE id = p_id;

  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb, text) TO anon, authenticated;

-- admin_create_campanha_extra_coupon ganha p_description.
CREATE OR REPLACE FUNCTION sunset.admin_create_campanha_extra_coupon(
  p_token text,
  p_campanha_id text,
  p_code text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_customer_whatsapps text[] DEFAULT '{}',
  p_description text DEFAULT NULL
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
  v_is_primary    boolean;
  v_in_window     boolean;
  v_whatsapp      text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_campanha FROM sunset.crm_segment_coupons WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  v_is_primary := v_campanha.coupon_id IS NULL;
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
      combinable_with_public, allow_promotion_checkout, starts_at, expires_at, max_uses, description
    ) VALUES (
      v_coupon_id, v_code, v_kind,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_type WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_value WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), ''), p_max_uses, NULLIF(trim(p_description), '')
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

  v_in_window := (v_campanha.starts_at IS NULL OR v_campanha.starts_at::timestamptz <= now())
    AND (v_campanha.ends_at IS NULL OR v_campanha.ends_at::timestamptz >= now())
    AND (p_starts_at IS NULL OR trim(p_starts_at) = '' OR p_starts_at::timestamptz <= now());

  IF v_is_primary THEN
    UPDATE sunset.crm_segment_coupons SET
      coupon_id = v_coupon_id,
      message_template = trim(p_message_template),
      uses_per_customer = p_uses_per_customer,
      last_fired_at = CASE WHEN orientation = 'segmento' AND v_in_window THEN now()::text ELSE last_fired_at END
    WHERE id = p_campanha_id;

    IF v_campanha.orientation = 'segmento' AND v_in_window THEN
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
  ELSE
    INSERT INTO sunset.crm_campanha_extra_coupons (id, campanha_id, coupon_id, message_template)
      VALUES (v_row_id, p_campanha_id, v_coupon_id, trim(p_message_template));

    IF v_in_window THEN
      FOR v_grant IN SELECT * FROM sunset.coupon_grants WHERE coupon_id = v_campanha.coupon_id LOOP
        INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          VALUES (gen_random_uuid()::text, v_coupon_id, v_grant.customer_whatsapp, p_uses_per_customer, 0);
      END LOOP;
    END IF;
  END IF;

  RETURN sunset._coupon_json(v_coupon_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb, text[], text) TO anon, authenticated;

-- admin_update_campanha_extra_coupon ganha p_description.
CREATE OR REPLACE FUNCTION sunset.admin_update_campanha_extra_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row           sunset.crm_campanha_extra_coupons%ROWTYPE;
  v_kind          text;
  v_pd            jsonb;
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_row FROM sunset.crm_campanha_extra_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extra coupon not found';
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
    starts_at = NULLIF(trim(p_starts_at), ''),
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    description = NULLIF(trim(p_description), '')
  WHERE id = v_row.coupon_id;

  DELETE FROM sunset.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE sunset.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  UPDATE sunset.crm_campanha_extra_coupons SET message_template = trim(p_message_template) WHERE id = p_id;

  RETURN sunset._campanha_coupon_json(v_row.campanha_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
