-- =====================================================
-- Campanha vira uma cadeia de 3 passos independentes, cada um com seu
-- próprio subcard/popup no front:
--   1) cadastro da campanha (nome, descrição, duração) — cria a linha
--      SEM gatilho e SEM cupom nenhum;
--   2) gatilho do evento (só pra orientation='evento') — define/edita o
--      trigger_criteria a qualquer momento depois, decoupled do
--      segmento;
--   3) cupom(s) exclusivo(s) — o primeiro cupom criado vira o "principal"
--      da campanha (preenche coupon_id, que até então é NULL); os
--      seguintes entram como extras, igual já funcionava.
--
-- Isso exige coupon_id deixar de ser NOT NULL em crm_segment_coupons —
-- toda a validação de "cupom alvo/exclusivo" (validate_coupon,
-- create_order) já faz EXISTS(...WHERE coupon_id = v_coupon.id), que
-- nunca casa com NULL, então nenhuma dessas funções precisa mudar.
--
-- Execução: depois de sunset_crm_campanhas_evento_snapshot.sql.
-- =====================================================

ALTER TABLE sunset.crm_segment_coupons ALTER COLUMN coupon_id DROP NOT NULL;
ALTER TABLE sunset.crm_segment_coupons ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE sunset.crm_segment_coupons ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE sunset.crm_segment_coupons ADD COLUMN IF NOT EXISTS starts_at TEXT;
ALTER TABLE sunset.crm_segment_coupons ADD COLUMN IF NOT EXISTS ends_at TEXT;

-- Campanhas já existentes (criadas pelo fluxo antigo, tudo de uma vez)
-- ganham um nome retroativo só pra não ficar em branco na listagem.
UPDATE sunset.crm_segment_coupons SET name = 'Campanha ' || to_char(created_at::timestamptz, 'DD/MM/YYYY')
  WHERE name = '';

CREATE OR REPLACE FUNCTION sunset._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'name', name, 'description', description, 'starts_at', starts_at, 'ends_at', ends_at,
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

-- Cria só o "cadastro" da campanha — sem gatilho, sem cupom. Pra
-- orientation='evento' o gatilho fica NULL até o admin configurar no
-- subcard próprio (admin_set_campanha_gatilho); pra 'segmento' nunca
-- existe gatilho — ela dispara sozinha assim que o primeiro cupom for
-- criado (ver admin_create_campanha_extra_coupon).
CREATE OR REPLACE FUNCTION sunset.admin_create_campanha(
  p_token text,
  p_segment_id text,
  p_orientation text,
  p_name text,
  p_description text DEFAULT NULL,
  p_starts_at text DEFAULT NULL,
  p_ends_at text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF p_orientation NOT IN ('segmento', 'evento') THEN
    RAISE EXCEPTION 'invalid orientation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sunset.crm_segments WHERE id = p_segment_id) THEN
    RAISE EXCEPTION 'segment not found';
  END IF;

  INSERT INTO sunset.crm_segment_coupons (
    id, segment_id, coupon_id, orientation, name, description, starts_at, ends_at,
    message_template, uses_per_customer
  ) VALUES (
    v_row_id, p_segment_id, NULL, p_orientation, trim(p_name), NULLIF(trim(p_description), ''),
    NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_ends_at), ''), '', 1
  );

  RETURN sunset._campanha_coupon_json(v_row_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_campanha(text, text, text, text, text, text, text) TO anon, authenticated;

-- Define/edita o gatilho (trigger_criteria) de uma campanha 'evento' —
-- não mexe em nome/descrição/duração nem em nenhum cupom. Fica de fora
-- de admin_update_campanha_coupon de propósito: essa função exige
-- message_template válido, que não existe enquanto não há cupom nenhum.
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
    RAISE EXCEPTION 'trigger_criteria is required';
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
GRANT EXECUTE ON FUNCTION sunset.admin_set_campanha_gatilho(text, text, jsonb) TO anon, authenticated;

-- admin_create_campanha_extra_coupon: agora também cobre o caso "esta
-- campanha ainda não tem cupom nenhum" — o cupom criado vira o
-- PRINCIPAL (preenche coupon_id na própria linha) em vez de entrar na
-- tabela de extras. Se for 'segmento' e ainda não tinha disparado,
-- dispara agora (concede pra quem já bate o critério do segmento) —
-- exatamente o que a criação tudo-de-uma-vez fazia antes, só que adiado
-- pra este momento. Se for 'evento', só arma mesmo, sem conceder nada
-- (precisa de "Verificar" ou do auto-check bater o gatilho depois).
DROP FUNCTION IF EXISTS sunset.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

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

  v_in_window := (v_campanha.starts_at IS NULL OR v_campanha.starts_at::timestamptz <= now())
    AND (v_campanha.ends_at IS NULL OR v_campanha.ends_at::timestamptz >= now());

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
    -- Esse cupom novo entra pra mesma turma na hora.
    FOR v_grant IN SELECT * FROM sunset.coupon_grants WHERE coupon_id = v_campanha.coupon_id LOOP
      INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
        VALUES (gen_random_uuid()::text, v_coupon_id, v_grant.customer_whatsapp, p_uses_per_customer, 0);
    END LOOP;
  END IF;

  RETURN sunset._coupon_json(v_coupon_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb, text[]) TO anon, authenticated;

-- admin_fire_campanha_event: agora ignora coupon_id NULL (campanha com
-- gatilho mas ainda sem nenhum cupom) em vez de tentar conceder um
-- cupom inexistente, e respeita a janela de duração da campanha.
CREATE OR REPLACE FUNCTION sunset.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row       sunset.crm_segment_coupons%ROWTYPE;
  v_coupon_id text;
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

  FOR v_coupon_id IN
    SELECT id FROM (
      SELECT v_row.coupon_id AS id
      UNION ALL
      SELECT coupon_id FROM sunset.crm_campanha_extra_coupons WHERE campanha_id = p_id
    ) x WHERE id IS NOT NULL
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

NOTIFY pgrst, 'reload schema';
