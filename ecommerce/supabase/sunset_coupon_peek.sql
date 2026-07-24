-- Bug crítico: a página /cliente/resgatarcupom chamava customer_claim_coupon
-- (que MARCA claimed_at) assim que carregava, achando que "resgatar" era só
-- revelar o que já tinha sido concedido -- só que isso mutava o banco a
-- cada carregamento de página, não só quando o cliente efetivamente
-- terminava de raspar. Resultado: recarregar a página várias vezes
-- (testando) resgatou um cupom por recarregamento, sem raspar nenhum.
--
-- customer_peek_claimable_coupon faz a MESMA seleção de
-- customer_claim_coupon só que sem UPDATE nenhum -- é só pra pré-visualizar
-- os dados do próximo cupom pendente (pra desenhar o CouponTicket por
-- baixo do papel dourado) antes de raspar. customer_claim_coupon continua
-- existindo do jeito que já estava (marca claimed_at de UM grant por
-- chamada) -- só que agora só é chamada quando o cliente termina de
-- raspar de verdade, não no carregamento da página.
CREATE OR REPLACE FUNCTION sunset.customer_peek_claimable_coupon(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := sunset._require_customer(p_token);
  v_whatsapp text;
  v_result jsonb;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM sunset.customers WHERE id = v_customer_id;

  SELECT jsonb_build_object(
    'grant_id', g.id, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'granted_uses', g.granted_uses, 'used_count', g.used_count,
    'expires_at', c.expires_at
  )
  INTO v_result
  FROM sunset.coupon_grants g JOIN sunset.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = v_whatsapp
    AND g.claimed_at IS NULL
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now())
  ORDER BY g.created_at ASC
  LIMIT 1;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'no coupon available to claim';
  END IF;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION sunset.customer_peek_claimable_coupon(text) TO anon, authenticated;
