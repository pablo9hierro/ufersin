-- =====================================================
-- Cupom avulso (público) ganha o kind='produto' também (antes só cupom
-- exclusivo tinha) — produto(s) com desconto próprio, sem precisar
-- digitar código: aparecem destacados em /catalogo na categoria
-- "Promoção", com o desconto já visível (preço original riscado + preço
-- final) e aplicado automaticamente no checkout assim que o produto entra
-- no carrinho.
-- =====================================================

DROP FUNCTION IF EXISTS sunset.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint);

CREATE OR REPLACE FUNCTION sunset.admin_create_coupon(
  p_token text, p_code text, p_kind text, p_discount_type text, p_discount_value double precision,
  p_allow_campaign_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_pd jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_kind NOT IN ('desconto', 'frete', 'aniversario', 'produto') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  IF p_kind = 'produto' THEN
    IF NOT v_has_products THEN
      RAISE EXCEPTION 'at least one product is required for kind=produto';
    END IF;
  ELSE
    IF p_discount_type IS NULL OR p_discount_value IS NULL THEN
      RAISE EXCEPTION 'discount_type and discount_value are required';
    END IF;
    IF p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  BEGIN
    INSERT INTO sunset.coupons (id, code, kind, discount_type, discount_value, allow_campaign_checkout, expires_at, max_uses)
      VALUES (
        v_id, v_code, p_kind,
        CASE WHEN p_kind = 'produto' THEN NULL ELSE p_discount_type END,
        CASE WHEN p_kind = 'produto' THEN NULL ELSE p_discount_value END,
        CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
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
GRANT EXECUTE ON FUNCTION sunset.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint, jsonb) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Catálogo público: produtos em promoção (cupom avulso kind='produto',
-- sem concessão = qualquer cliente vê e aproveita) — categoria "Promoção".
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.list_promotional_products()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', pd.product_id, 'coupon_code', c.code,
    'discount_type', pd.discount_type, 'discount_value', pd.discount_value
  )), '[]'::jsonb)
  FROM sunset.coupon_product_discounts pd
  JOIN sunset.coupons c ON c.id = pd.coupon_id
  WHERE c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at::timestamptz > now())
    AND (c.max_uses IS NULL OR c.used_count < c.max_uses)
    AND NOT EXISTS (SELECT 1 FROM sunset.coupon_grants g WHERE g.coupon_id = c.id);
$$;
GRANT EXECUTE ON FUNCTION sunset.list_promotional_products() TO anon, authenticated;
