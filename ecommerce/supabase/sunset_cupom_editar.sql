-- =====================================================
-- Editar cupom (avulso e exclusivo/alvo) — antes só dava pra ativar/
-- desativar, mudar validade e limite de usos. Agora dá pra também
-- ajustar o desconto (produto ou por-produto) depois de criado. Código
-- e kind continuam fixos após a criação (evita confusão com um cupom já
-- divulgado/usado mudando de natureza no meio do caminho).
-- =====================================================

DROP FUNCTION IF EXISTS sunset.admin_update_coupon(text, text, boolean, boolean, text, bigint);

CREATE OR REPLACE FUNCTION sunset.admin_update_coupon(
  p_token text, p_id text, p_active boolean, p_allow_campaign_checkout boolean,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_kind text;
  v_pd jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  SELECT kind INTO v_kind FROM sunset.coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;

  UPDATE sunset.coupons SET
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    allow_campaign_checkout = CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    discount_type = CASE WHEN v_kind = 'produto' THEN discount_type ELSE COALESCE(p_discount_type, discount_type) END,
    discount_value = CASE WHEN v_kind = 'produto' THEN discount_value ELSE COALESCE(p_discount_value, discount_value) END
  WHERE id = p_id;

  IF v_kind = 'produto' AND p_product_discounts IS NOT NULL THEN
    DELETE FROM sunset.coupon_product_discounts WHERE coupon_id = p_id;
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN sunset._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_coupon(text, text, boolean, boolean, text, bigint, text, double precision, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_targeted_coupon(
  p_token text,
  p_id text,
  p_active boolean,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_campaign_checkout boolean DEFAULT false,
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
  v_kind text;
  v_pd jsonb;
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM sunset.coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  -- kind='frete': discount_type/value é a taxa de frete em si (significado
  -- legado), shipping_discount_type/value fica null — mesma remapeação já
  -- usada em admin_create_targeted_coupon.
  UPDATE sunset.coupons SET
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_campaign_checkout = CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = p_id;

  DELETE FROM sunset.coupon_product_discounts WHERE coupon_id = p_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO sunset.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE sunset.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = p_id;

  RETURN sunset._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_targeted_coupon(text, text, boolean, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;
