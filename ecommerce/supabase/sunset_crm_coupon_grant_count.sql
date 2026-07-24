-- =====================================================
-- _coupon_json passa a trazer grant_count — só assim o front consegue
-- distinguir "cupom avulso" (grant_count = 0, qualquer um pode digitar)
-- de "cupom alvo" (grant_count > 0, só quem tem concessão pode usar) na
-- listagem, sem precisar de uma chamada extra por cupom.
-- =====================================================

CREATE OR REPLACE FUNCTION sunset._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'allow_campaign_checkout', (c.allow_campaign_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'active', (c.active <> 0),
    'expires_at', c.expires_at, 'max_uses', c.max_uses, 'used_count', c.used_count, 'created_at', c.created_at,
    'grant_count', (SELECT COUNT(*) FROM sunset.coupon_grants g WHERE g.coupon_id = c.id)
  ) FROM sunset.coupons c WHERE c.id = p_id;
$$;
