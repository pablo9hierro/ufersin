-- Suporte pras 3 páginas do menu do cliente logado: /cliente/favoritos,
-- /cliente/cupons, /cliente/historico.

CREATE TABLE IF NOT EXISTS sunset.customer_favorites (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  customer_id text NOT NULL REFERENCES sunset.customers(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES sunset.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id)
);

CREATE OR REPLACE FUNCTION sunset.customer_toggle_favorite(p_token text, p_product_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := sunset._require_customer(p_token);
  v_existing text;
BEGIN
  SELECT id INTO v_existing FROM sunset.customer_favorites WHERE customer_id = v_customer_id AND product_id = p_product_id;
  IF v_existing IS NOT NULL THEN
    DELETE FROM sunset.customer_favorites WHERE id = v_existing;
    RETURN false;
  ELSE
    INSERT INTO sunset.customer_favorites (id, customer_id, product_id) VALUES (gen_random_uuid()::text, v_customer_id, p_product_id);
    RETURN true;
  END IF;
END;
$function$;

-- Devolve os produtos favoritados + a lista "crua" de ids (pro front
-- pintar o coração nos cards sem precisar de uma chamada por produto).
CREATE OR REPLACE FUNCTION sunset.customer_list_favorites(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := sunset._require_customer(p_token);
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price,
      'quantity', p.quantity, 'image_url', p.image_url, 'category_id', p.category_id,
      'active', (p.active <> 0)
    ) ORDER BY f.created_at DESC)
    FROM sunset.customer_favorites f JOIN sunset.products p ON p.id = f.product_id
    WHERE f.customer_id = v_customer_id
  ), '[]'::jsonb);
END;
$function$;

-- Cupons do cliente logado, já separados em ativos/inativos/histórico —
-- ativo: ainda tem uso sobrando E cupom ligado/dentro da validade.
-- inativo: esgotado, desativado pelo admin ou expirado.
-- histórico: pedidos onde um código de cupom foi de fato aplicado
-- (orders.coupon_code), não é a mesma coisa que "inativo" — um cupom
-- pode estar em uso mas já ter sido aplicado em pedidos anteriores.
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

-- Histórico de pedidos do cliente logado — mesmo formato de
-- track_orders_by_phone (usado em /consultar), só que resolve o
-- whatsapp a partir da sessão em vez de pedir pra digitar de novo.
CREATE OR REPLACE FUNCTION sunset.customer_list_orders(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := sunset._require_customer(p_token);
  v_whatsapp text;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM sunset.customers WHERE id = v_customer_id;
  RETURN sunset.track_orders_by_phone(v_whatsapp);
END;
$function$;

GRANT EXECUTE ON FUNCTION sunset.customer_toggle_favorite(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sunset.customer_list_favorites(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sunset.customer_list_coupons(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sunset.customer_list_orders(text) TO anon, authenticated;
