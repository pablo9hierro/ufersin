-- =====================================================
-- "Campanha" (novo conceito, não confundir com a antiga campanha
-- renomeada pra "promoção" — ver sunset_rename_campaign_to_promotion.sql):
-- notifica os clientes de um segmento do CRM via WhatsApp com um cupom
-- exclusivo. Um segmento pode ter zero, uma ou várias campanhas
-- (cupons), cada uma com seu próprio prazo/desconto/mensagem.
--
-- orientation='segmento': dispara UMA VEZ, na criação, pros clientes que
-- casam com o critério do segmento NAQUELE momento — não reage a
-- clientes que passem a casar com o critério depois.
-- orientation='evento': fica associada a um critério DIFERENTE do
-- critério original do segmento (trigger_criteria) — não dispara nada na
-- criação. Mais tarde (admin_fire_campanha_event, chamado pelo front
-- quando reavalia a lista), qualquer cliente que passa a casar com esse
-- critério novo ganha o cupom — idempotente, não duplica concessão.
-- =====================================================

CREATE TABLE IF NOT EXISTS sunset.crm_segment_coupons (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  segment_id         TEXT NOT NULL REFERENCES sunset.crm_segments(id) ON DELETE CASCADE,
  coupon_id          TEXT NOT NULL REFERENCES sunset.coupons(id) ON DELETE CASCADE,
  orientation        TEXT NOT NULL CHECK (orientation IN ('segmento', 'evento')),
  trigger_criteria   JSONB,
  message_template   TEXT NOT NULL,
  uses_per_customer  BIGINT NOT NULL DEFAULT 1,
  last_fired_at      TEXT,
  created_at         TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS crm_segment_coupons_segment_idx ON sunset.crm_segment_coupons (segment_id);
ALTER TABLE sunset.crm_segment_coupons ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION sunset._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'fired_at', last_fired_at, 'created_at', created_at
  ) FROM sunset.crm_segment_coupons WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_list_campanha_coupons(p_token text, p_segment_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(sunset._campanha_coupon_json(id) ORDER BY created_at DESC)
    FROM sunset.crm_segment_coupons WHERE segment_id = p_segment_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_campanha_coupons(text, text) TO anon, authenticated;

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
    id, segment_id, coupon_id, orientation, trigger_criteria, message_template, uses_per_customer, last_fired_at
  ) VALUES (
    v_row_id, p_segment_id, v_coupon_id, p_orientation, p_trigger_criteria,
    trim(p_message_template), p_uses_per_customer,
    CASE WHEN p_orientation = 'segmento' THEN now()::text ELSE NULL END
  );

  -- 'segmento' dispara na hora pra quem veio na lista (calculada no front
  -- a partir do filter_criteria do segmento); 'evento' começa sem
  -- concessão nenhuma, só passa a existir quando o critério diferente
  -- (trigger_criteria) se tornar verdade pra algum cliente.
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

-- Reavalia uma campanha orientation='evento' contra a lista atual de
-- whatsapps que casam com trigger_criteria (calculada no front) —
-- concede o cupom só pra quem ainda não tinha, idempotente.
CREATE OR REPLACE FUNCTION sunset.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row      sunset.crm_segment_coupons%ROWTYPE;
  v_whatsapp text;
  v_newly    text[] := '{}';
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_row FROM sunset.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas can be re-fired';
  END IF;

  FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
    IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_row.coupon_id AND customer_whatsapp = v_whatsapp) THEN
      INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_whatsapp, v_row.uses_per_customer, 0);
      v_newly := array_append(v_newly, v_whatsapp);
    END IF;
  END LOOP;

  IF array_length(v_newly, 1) > 0 THEN
    UPDATE sunset.crm_segment_coupons SET last_fired_at = now()::text WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_newly));
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_fire_campanha_event(text, text, text[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_delete_campanha_coupon(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  -- Não apaga sunset.coupons — o admin pode querer manter o cupom em uso
  -- mesmo desvinculado da campanha (só remove a linha de vínculo).
  DELETE FROM sunset.crm_segment_coupons WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_delete_campanha_coupon(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- crm_segments perde os vínculos diretos com cupom/promoção — o vínculo
-- agora é só via crm_segment_coupons (segmento -> campanha -> cupom).
-- ─────────────────────────────────────────────────────
ALTER TABLE sunset.crm_segments DROP COLUMN IF EXISTS coupon_id;

CREATE OR REPLACE FUNCTION sunset._segment_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'description', description, 'filter_criteria', filter_criteria, 'created_at', created_at
  ) FROM sunset.crm_segments WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS sunset.admin_create_segment(text, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION sunset.admin_create_segment(p_token text, p_name text, p_description text, p_filter_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  INSERT INTO sunset.crm_segments (id, name, description, filter_criteria)
    VALUES (v_id, trim(p_name), NULLIF(trim(p_description), ''), p_filter_criteria);
  RETURN sunset._segment_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_segment(text, text, text, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_segment(text, text, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION sunset.admin_update_segment(p_token text, p_id text, p_name text, p_description text, p_filter_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  UPDATE sunset.crm_segments SET
    name = trim(p_name), description = NULLIF(trim(p_description), ''), filter_criteria = p_filter_criteria
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;
  RETURN sunset._segment_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_segment(text, text, text, text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_list_segments(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(sunset._segment_json(id) ORDER BY created_at DESC) FROM sunset.crm_segments), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_segments(text) TO anon, authenticated;
