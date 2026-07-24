-- =====================================================
-- Itens de promoção "selfie service" (banner) passam a aparecer na
-- categoria pública "Promoção" do /catalogo também — independente de o
-- cliente ter clicado no banner ou não. Antes só cupom avulso kind='produto'
-- caía nessa categoria; agora list_promotional_products() une as duas
-- fontes (cupom avulso + promoção selfie_service ativa).
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.list_promotional_products()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'product_id', pd.product_id, 'coupon_code', c.code,
      'discount_type', pd.discount_type, 'discount_value', pd.discount_value
    ) AS row
    FROM sunset.coupon_product_discounts pd
    JOIN sunset.coupons c ON c.id = pd.coupon_id
    WHERE c.active <> 0
      AND (c.expires_at IS NULL OR c.expires_at::timestamptz > now())
      AND (c.max_uses IS NULL OR c.used_count < c.max_uses)
      AND NOT EXISTS (SELECT 1 FROM sunset.coupon_grants g WHERE g.coupon_id = c.id)

    UNION ALL

    SELECT jsonb_build_object(
      'product_id', pd.product_id, 'coupon_code', '',
      'discount_type', pd.discount_type, 'discount_value', pd.discount_value
    ) AS row
    FROM sunset.promotion_product_discounts pd
    JOIN sunset.promotions p ON p.id = pd.promotion_id
    WHERE p.promotion_type = 'selfie_service'
      AND p.active <> 0
      AND (p.starts_at IS NULL OR p.starts_at::timestamptz <= now())
      AND (p.expires_at IS NULL OR p.expires_at::timestamptz > now())
  ) t;
$$;
GRANT EXECUTE ON FUNCTION sunset.list_promotional_products() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
