-- Feature "Resgatar cupom": cupons concedidos (coupon_grants) agora passam
-- por um passo de resgate (raspadinha) antes de virarem utilizáveis. Um
-- grant recém-concedido fica "pendente" (claimed_at IS NULL) até o cliente
-- raspar o cartão em /cliente/resgatarcupom -- só depois disso ele aparece
-- nas abas Ativos/Inativos de /cliente/cupons.

ALTER TABLE sunset.coupon_grants ADD COLUMN IF NOT EXISTS claimed_at text;

-- O backfill "grants antigos viram já-resgatados" rodou UMA VEZ só, na
-- aplicação original desta migration -- por isso NÃO é um UPDATE aqui.
-- Reaplicar este arquivo (ex: pra atualizar uma das funções abaixo) tem
-- que ser seguro sem re-varrer a tabela; um UPDATE ...WHERE claimed_at IS
-- NULL rodado de novo pegaria também grants novos ainda pendentes de
-- resgate e os marcaria como resgatados por engano (foi exatamente isso
-- que aconteceu com os cupons de teste seedados entre a 1ª e a 2ª vez que
-- este arquivo rodou -- corrigido manualmente depois, ver histórico).

CREATE OR REPLACE FUNCTION sunset.customer_list_coupons(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := sunset._require_customer(p_token);
  v_whatsapp text;
  v_active jsonb;
  v_inactive jsonb;
  v_history jsonb;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM sunset.customers WHERE id = v_customer_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'grant_id', g.id, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'granted_uses', g.granted_uses, 'used_count', g.used_count,
    'expires_at', c.expires_at, 'created_at', g.created_at
  ) ORDER BY g.created_at DESC), '[]'::jsonb)
  INTO v_active
  FROM sunset.coupon_grants g JOIN sunset.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = v_whatsapp
    AND g.claimed_at IS NOT NULL
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now());

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'grant_id', g.id, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'granted_uses', g.granted_uses, 'used_count', g.used_count,
    'expires_at', c.expires_at, 'created_at', g.created_at
  ) ORDER BY g.created_at DESC), '[]'::jsonb)
  INTO v_inactive
  FROM sunset.coupon_grants g JOIN sunset.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = v_whatsapp
    AND g.claimed_at IS NOT NULL
    AND NOT (
      g.used_count < g.granted_uses
      AND c.active <> 0
      AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now())
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'order_id', o.id, 'coupon_code', o.coupon_code, 'created_at', o.created_at,
    'total', o.total, 'discount_amount', o.discount_amount, 'shipping_discount', o.shipping_discount
  ) ORDER BY o.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM sunset.orders o
  WHERE o.customer_whatsapp = v_whatsapp AND o.coupon_code IS NOT NULL;

  RETURN jsonb_build_object('active', v_active, 'inactive', v_inactive, 'history', v_history);
END;
$function$;

-- Só diz SE tem cupom pra resgatar -- não revela nada, é só o que o botão
-- "Resgatar cupom" precisa pra decidir entre abrir o toggle de "sem cupom"
-- (preet_7613) ou redirecionar pra /cliente/resgatarcupom.
CREATE OR REPLACE FUNCTION sunset.customer_has_claimable_coupon(p_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := sunset._require_customer(p_token);
  v_whatsapp text;
  v_found boolean;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM sunset.customers WHERE id = v_customer_id;

  SELECT EXISTS (
    SELECT 1
    FROM sunset.coupon_grants g JOIN sunset.coupons c ON c.id = g.coupon_id
    WHERE g.customer_whatsapp = v_whatsapp
      AND g.claimed_at IS NULL
      AND g.used_count < g.granted_uses
      AND c.active <> 0
      AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now())
  ) INTO v_found;

  RETURN v_found;
END;
$function$;

-- Resgata (raspa) o cupom pendente mais antigo do cliente -- marca
-- claimed_at e só ENTÃO devolve os dados do cupom (nada é revelado antes
-- de raspar). FOR UPDATE SKIP LOCKED evita resgatar o mesmo grant duas
-- vezes em cliques duplos/concorrentes.
CREATE OR REPLACE FUNCTION sunset.customer_claim_coupon(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := sunset._require_customer(p_token);
  v_whatsapp text;
  v_grant_id text;
  v_result jsonb;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM sunset.customers WHERE id = v_customer_id;

  SELECT g.id INTO v_grant_id
  FROM sunset.coupon_grants g JOIN sunset.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = v_whatsapp
    AND g.claimed_at IS NULL
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now())
  ORDER BY g.created_at ASC
  LIMIT 1
  FOR UPDATE OF g SKIP LOCKED;

  IF v_grant_id IS NULL THEN
    RAISE EXCEPTION 'no coupon available to claim';
  END IF;

  UPDATE sunset.coupon_grants SET claimed_at = now()::text WHERE id = v_grant_id;

  -- description NUNCA vai pro cliente (nota interna do admin sobre o
  -- cupom) -- só os campos já expostos em customer_list_coupons.
  SELECT jsonb_build_object(
    'grant_id', g.id, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'granted_uses', g.granted_uses, 'used_count', g.used_count,
    'expires_at', c.expires_at
  )
  INTO v_result
  FROM sunset.coupon_grants g JOIN sunset.coupons c ON c.id = g.coupon_id
  WHERE g.id = v_grant_id;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION sunset.customer_has_claimable_coupon(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sunset.customer_claim_coupon(text) TO anon, authenticated;
