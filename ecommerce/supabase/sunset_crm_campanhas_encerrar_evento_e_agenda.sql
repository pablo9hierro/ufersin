-- =====================================================
-- 1) Gatilho pode ser limpo (p_trigger_criteria = NULL volta a campanha
--    pro estado "sem critério ainda") — antes só dava pra setar, nunca
--    apagar.
-- 2) Cupom principal pode ser removido da campanha (fica "aguardando
--    cupom" de novo, igual antes do primeiro cupom ser criado) — mesma
--    lógica de admin_delete_campanha_extra_coupon, só que pro slot
--    principal.
-- 3) Cupom exclusivo (principal e extras) ganha agenda de início
--    (starts_at, no cupom em si — sunset.coupons já tem essa coluna) —
--    o disparo automático (evento e bootstrap de 'segmento') passa a
--    respeitar essa janela por cupom, não só a janela da campanha.
-- 4) "Encerrar por evento": campanha inteira (end_criteria em
--    crm_segment_coupons) ou só um cupom extra (end_criteria em
--    crm_campanha_extra_coupons) — quando o critério bate (mesmo
--    mecanismo do gatilho, calculado no front), desativa
--    automaticamente. Cupom principal usa o end_criteria da própria
--    campanha (não tem um separado).
--
-- Execução: depois de sunset_cupom_avulso_multi_tipo.sql.
-- =====================================================

ALTER TABLE sunset.crm_segment_coupons ADD COLUMN IF NOT EXISTS end_criteria JSONB;
ALTER TABLE sunset.crm_campanha_extra_coupons ADD COLUMN IF NOT EXISTS end_criteria JSONB;

CREATE OR REPLACE FUNCTION sunset._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'name', name, 'description', description, 'starts_at', starts_at, 'ends_at', ends_at,
    'trigger_criteria', trigger_criteria, 'end_criteria', end_criteria, 'message_template', message_template,
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

-- p_trigger_criteria = NULL agora é uma limpeza válida (volta pro
-- estado "sem critério"), não um erro — só a validação "precisa
-- diferir do segmento" continua exigindo NOT NULL.
CREATE OR REPLACE FUNCTION sunset.admin_set_campanha_gatilho(p_token text, p_id text, p_trigger_criteria jsonb)
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
    UPDATE sunset.crm_segment_coupons SET trigger_criteria = NULL, last_synced_segment_criteria = NULL WHERE id = p_id;
    RETURN sunset._campanha_coupon_json(p_id);
  END IF;

  SELECT * INTO v_segment FROM sunset.crm_segments WHERE id = v_row.segment_id;
  IF p_trigger_criteria = v_segment.filter_criteria THEN
    RAISE EXCEPTION 'trigger_criteria must differ from the segment''s current filter in at least one field';
  END IF;

  UPDATE sunset.crm_segment_coupons SET
    trigger_criteria = p_trigger_criteria,
    last_synced_segment_criteria = v_segment.filter_criteria
  WHERE id = p_id;

  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;

-- Define/edita o critério de encerramento automático da campanha
-- inteira (principal + extras) — NULL limpa.
CREATE OR REPLACE FUNCTION sunset.admin_set_campanha_end_criteria(p_token text, p_id text, p_end_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM sunset.crm_segment_coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  UPDATE sunset.crm_segment_coupons SET end_criteria = p_end_criteria WHERE id = p_id;
  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_set_campanha_end_criteria(text, text, jsonb) TO anon, authenticated;

-- Mesma coisa, só que pra UM cupom extra específico (não a campanha
-- inteira) — NULL limpa.
CREATE OR REPLACE FUNCTION sunset.admin_set_extra_coupon_end_criteria(p_token text, p_id text, p_end_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_campanha_id text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT campanha_id INTO v_campanha_id FROM sunset.crm_campanha_extra_coupons WHERE id = p_id;
  IF v_campanha_id IS NULL THEN
    RAISE EXCEPTION 'extra coupon not found';
  END IF;
  UPDATE sunset.crm_campanha_extra_coupons SET end_criteria = p_end_criteria WHERE id = p_id;
  RETURN sunset._campanha_coupon_json(v_campanha_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_set_extra_coupon_end_criteria(text, text, jsonb) TO anon, authenticated;

-- Desativa só o cupom extra (não a campanha inteira) — usado quando o
-- end_criteria dele bate, calculado no front.
CREATE OR REPLACE FUNCTION sunset.admin_deactivate_campanha_extra_coupon(p_token text, p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row sunset.crm_campanha_extra_coupons%ROWTYPE;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_row FROM sunset.crm_campanha_extra_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extra coupon not found';
  END IF;
  UPDATE sunset.coupons SET active = 0 WHERE id = v_row.coupon_id;
  RETURN sunset._campanha_coupon_json(v_row.campanha_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_deactivate_campanha_extra_coupon(text, text) TO anon, authenticated;

-- Desvincula o cupom PRINCIPAL da campanha (volta a "aguardando
-- cupom") — não apaga sunset.coupons, mesma lógica de sempre.
CREATE OR REPLACE FUNCTION sunset.admin_delete_campanha_primary_coupon(p_token text, p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM sunset.crm_segment_coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  UPDATE sunset.crm_segment_coupons SET coupon_id = NULL, message_template = '' WHERE id = p_id;
  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_delete_campanha_primary_coupon(text, text) TO anon, authenticated;

-- admin_update_campanha_coupon (cupom principal): ganha p_starts_at.
DROP FUNCTION IF EXISTS sunset.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

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
  p_product_discounts jsonb DEFAULT NULL
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

  UPDATE sunset.crm_segment_coupons SET
    message_template = trim(p_message_template),
    uses_per_customer = p_uses_per_customer
  WHERE id = p_id;

  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- admin_create_campanha_extra_coupon: ganha p_starts_at (persistido no
-- cupom, principal ou extra) — o bootstrap de 'segmento' só dispara se
-- a janela (campanha E cupom) já começou.
DROP FUNCTION IF EXISTS sunset.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb, text[]);

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
  p_customer_whatsapps text[] DEFAULT '{}'
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
      combinable_with_public, allow_promotion_checkout, starts_at, expires_at, max_uses
    ) VALUES (
      v_coupon_id, v_code, v_kind,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_type WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_value WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), ''), p_max_uses
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

    -- A campanha já disparou antes (tem concessão do cupom principal)?
    -- Esse cupom novo entra pra mesma turma na hora — desde que a
    -- janela dele já tenha começado.
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
GRANT EXECUTE ON FUNCTION sunset.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb, text[]) TO anon, authenticated;

-- admin_update_campanha_extra_coupon: ganha p_starts_at.
DROP FUNCTION IF EXISTS sunset.admin_update_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

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
  p_product_discounts jsonb DEFAULT NULL
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

  UPDATE sunset.crm_campanha_extra_coupons SET message_template = trim(p_message_template) WHERE id = p_id;

  RETURN sunset._campanha_coupon_json(v_row.campanha_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- admin_fire_campanha_event: cada cupom da campanha (principal e
-- extras) só recebe concessão se a JANELA DELE (starts_at/expires_at
-- próprios, não só os da campanha) já estiver valendo agora.
CREATE OR REPLACE FUNCTION sunset.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row       sunset.crm_segment_coupons%ROWTYPE;
  v_coupon    sunset.coupons%ROWTYPE;
  v_whatsapp  text;
  v_newly     text[] := '{}';
  v_in_window boolean;
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

  v_in_window := (v_row.starts_at IS NULL OR v_row.starts_at::timestamptz <= now())
    AND (v_row.ends_at IS NULL OR v_row.ends_at::timestamptz >= now());
  IF NOT v_in_window THEN
    RETURN jsonb_build_object('newly_granted', '[]'::jsonb);
  END IF;

  FOR v_coupon IN
    SELECT c.* FROM sunset.coupons c WHERE c.id = v_row.coupon_id
    UNION ALL
    SELECT c.* FROM sunset.coupons c JOIN sunset.crm_campanha_extra_coupons ec ON ec.coupon_id = c.id WHERE ec.campanha_id = p_id
  LOOP
    IF v_coupon.active = 0
       OR (v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at::timestamptz > now())
       OR (v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now()) THEN
      CONTINUE;
    END IF;
    FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
      IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_coupon.id AND customer_whatsapp = v_whatsapp) THEN
        INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          VALUES (gen_random_uuid()::text, v_coupon.id, v_whatsapp, v_row.uses_per_customer, 0);
        IF v_coupon.id = v_row.coupon_id THEN
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

NOTIFY pgrst, 'reload schema';
