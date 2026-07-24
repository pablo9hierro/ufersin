-- =====================================================
-- Quando o admin edita o filter_criteria de um segmento, qualquer
-- campanha 'evento' vinculada a ele fica desatualizada — o trigger_criteria
-- dela foi calibrado contra o critério ANTIGO do segmento, então pode não
-- fazer mais sentido (ex: um campo novo entrou no filtro e não tem valor-
-- alvo definido pra ele ainda). Em vez de deixar disparar com um critério
-- desatualizado, a campanha é pausada (active=0) automaticamente — o
-- admin revisa e reativa manualmente pelo card, que fica com aviso.
--
-- admin_update_campanha_coupon ganha p_trigger_criteria: permite editar o
-- critério-alvo depois de criada (antes só criação, nunca edição).
--
-- Este arquivo também RE-APLICA (idempotente, seguro rodar de novo) a
-- coluna active + admin_toggle_campanha_coupon do arquivo anterior — se o
-- on/off ainda não funciona depois de rodar os arquivos anteriores, o
-- suspeito nº1 é o schema cache do PostgREST não ter recarregado a
-- função nova (é assíncrono depois de um CREATE OR REPLACE via SQL
-- editor); o NOTIFY no fim deste arquivo força o reload na hora.
--
-- Execução: depois de sunset_crm_campanhas_editar_toggle_unificado.sql
-- (mas seguro mesmo que os arquivos anteriores não tenham rodado certo).
-- =====================================================

ALTER TABLE sunset.crm_segment_coupons ADD COLUMN IF NOT EXISTS active BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION sunset._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at
  ) FROM sunset.crm_segment_coupons WHERE id = p_id;
$$;

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
  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_toggle_campanha_coupon(text, text, boolean) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_segment(text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION sunset.admin_update_segment(p_token text, p_id text, p_name text, p_description text, p_filter_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_old_criteria jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;

  SELECT filter_criteria INTO v_old_criteria FROM sunset.crm_segments WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;

  UPDATE sunset.crm_segments SET
    name = trim(p_name), description = NULLIF(trim(p_description), ''), filter_criteria = p_filter_criteria
  WHERE id = p_id;

  IF v_old_criteria IS DISTINCT FROM p_filter_criteria THEN
    UPDATE sunset.crm_segment_coupons SET active = 0 WHERE segment_id = p_id AND orientation = 'evento';
  END IF;

  RETURN sunset._segment_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_segment(text, text, text, text, jsonb) TO anon, authenticated;

-- Assinatura mudou (novo parâmetro p_trigger_criteria no fim) — precisa
-- derrubar a versão antiga primeiro, senão CREATE OR REPLACE cria um
-- overload novo em vez de substituir, e as duas versões coexistindo
-- confundem a resolução de chamada nomeada do PostgREST.
DROP FUNCTION IF EXISTS sunset.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

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

  UPDATE sunset.crm_segment_coupons SET
    message_template = trim(p_message_template),
    uses_per_customer = p_uses_per_customer,
    trigger_criteria = CASE WHEN orientation = 'evento' AND p_trigger_criteria IS NOT NULL THEN p_trigger_criteria ELSE trigger_criteria END
  WHERE id = p_id;

  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb, jsonb) TO anon, authenticated;

-- Força o PostgREST a recarregar o schema na hora em vez de esperar o
-- próximo ciclo automático — sem isso, RPCs recém-criadas/trocadas podem
-- devolver "function not found" por um tempo depois de rodar esta migration.
NOTIFY pgrst, 'reload schema';
