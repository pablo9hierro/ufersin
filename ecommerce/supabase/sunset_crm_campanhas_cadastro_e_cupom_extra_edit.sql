-- =====================================================
-- Dois popups de edição que faltavam na cadeia campanha->gatilho->cupom:
--
-- 1) admin_update_campanha_cadastro — edita nome/descrição/duração da
--    campanha (o "cadastro"), sem mexer em gatilho nem em cupom nenhum.
--    Antes o botão "Editar" do card de cadastro abria por engano o
--    formulário de cupom — esta função é o que faltava pra abrir o
--    formulário certo.
--
-- 2) admin_update_campanha_extra_coupon — edita mensagem/desconto/prazo
--    de um cupom EXTRA já existente (o principal já tinha
--    admin_update_campanha_coupon; os extras só tinham criar/apagar).
--
-- Execução: depois de sunset_crm_campanhas_novo_fluxo.sql.
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.admin_update_campanha_cadastro(
  p_token text,
  p_id text,
  p_name text,
  p_description text DEFAULT NULL,
  p_starts_at text DEFAULT NULL,
  p_ends_at text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM sunset.crm_segment_coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;

  UPDATE sunset.crm_segment_coupons SET
    name = trim(p_name),
    description = NULLIF(trim(p_description), ''),
    starts_at = NULLIF(trim(p_starts_at), ''),
    ends_at = NULLIF(trim(p_ends_at), '')
  WHERE id = p_id;

  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_campanha_cadastro(text, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_campanha_extra_coupon(
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
GRANT EXECUTE ON FUNCTION sunset.admin_update_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
