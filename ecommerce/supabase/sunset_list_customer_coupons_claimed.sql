-- list_customer_coupons (usada no checkout: auto-detecta cupom exclusivo
-- pelo whatsapp digitado, e agora tambem alimenta o select de cupons no
-- checkout) tinha DOIS bugs:
-- 1. Referenciava c.allow_campaign_checkout, coluna que nao existe mais
--    (o nome real e allow_promotion_checkout) -- a funcao inteira dava
--    erro em TODA chamada, silenciosamente engolido pelo .catch(() => {})
--    no Checkout.tsx. O "auto-detectar cupom exclusivo pelo whatsapp"
--    nunca funcionou de verdade em producao.
-- 2. Nao filtrava por claimed_at -- um cupom concedido mas ainda NAO
--    resgatado na raspadinha (/cliente/resgatarcupom) ja apareceria como
--    disponivel pra aplicar direto no checkout, furando a regra de que só
--    conta como resgatado depois de efetivamente raspar (ver
--    sunset_coupon_claim.sql / sunset_coupon_peek.sql).
CREATE OR REPLACE FUNCTION sunset.list_customer_coupons(p_customer_whatsapp text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'sunset', 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_promotion_checkout', (c.allow_promotion_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM sunset.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  FROM sunset.coupon_grants g
  JOIN sunset.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = p_customer_whatsapp
    AND g.claimed_at IS NOT NULL
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at::timestamptz > now())
    AND (c.max_uses IS NULL OR c.used_count < c.max_uses);
$function$;
