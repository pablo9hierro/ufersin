-- get_order/track_orders_by_phone/estimate_shipping tinham o mesmo problema
-- de create_order: referenciavam resolutoo.orders/order_items/motoboys/
-- shipping_settings (vazias) em vez de loja.* (dados reais, por tenant).
-- Sem isso, mesmo com create_order corrigido, o pedido some da tela
-- seguinte (Pagamento/Consultar) e a estimativa de frete usa uma
-- configuração global fixa em vez da configuração de cada loja.
--
-- CORREÇÃO (2026-09-11): este arquivo ainda usava `sunset.*`, nome antigo
-- do schema antes de ser renomeado pra `loja` (mesmo achado/correção feita
-- em resolutoo_create_order_fiscal_context.sql). Sem isso, get_order/
-- track_orders_by_phone/estimate_shipping quebravam com "relation does
-- not exist" ou coluna ausente, dependendo do estado real do schema
-- `sunset` (pode nem existir mais). Corrigido todo `sunset.*` pra `loja.*`.

CREATE OR REPLACE FUNCTION resolutoo.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = resolutoo, loja, public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'customer_name', o.customer_name,
    'customer_whatsapp', o.customer_whatsapp,
    'delivery_type', o.delivery_type,
    'neighborhood', o.neighborhood,
    'address', o.address,
    'reference_point', o.reference_point,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'status', o.status,
    'shipping_price', o.shipping_price,
    'total', o.total,
    'discount_amount', o.discount_amount,
    'motoboy_id', o.motoboy_id,
    'motoboy_name', m.name,
    'motoboy_whatsapp', m.phone,
    'pix_payment_id', o.pix_payment_id,
    'pix_qr_base64', o.pix_qr_base64,
    'pix_copia_cola', o.pix_copia_cola,
    'customer_lat', o.customer_lat,
    'customer_lng', o.customer_lng,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'product_name', oi.product_name,
        'unit_price', oi.unit_price,
        'quantity', oi.quantity
      ))
      FROM loja.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM loja.orders o
  LEFT JOIN loja.motoboys m ON m.id = o.motoboy_id
  WHERE o.id = p_order_id;
$$;
GRANT EXECUTE ON FUNCTION resolutoo.get_order(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION resolutoo.track_orders_by_phone(p_whatsapp text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = resolutoo, loja, public
AS $$
  SELECT COALESCE(jsonb_agg(resolutoo.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
  FROM loja.orders o
  WHERE o.customer_whatsapp = p_whatsapp;
$$;
GRANT EXECUTE ON FUNCTION resolutoo.track_orders_by_phone(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS resolutoo.estimate_shipping(double precision, double precision);

CREATE OR REPLACE FUNCTION resolutoo.estimate_shipping(p_lat double precision, p_lng double precision, p_tenant_slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = resolutoo, loja, public AS $$
DECLARE
  v_tenant_id text;
  v_settings loja.shipping_settings%ROWTYPE;
  v_km double precision;
BEGIN
  SELECT id INTO v_tenant_id FROM loja.tenants WHERE slug = p_tenant_slug;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'store not found';
  END IF;
  SELECT * INTO v_settings FROM loja.shipping_settings WHERE tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipping is not configured for this store';
  END IF;
  v_km := resolutoo._distance_km(v_settings.store_lat, v_settings.store_lng, p_lat, p_lng);
  RETURN jsonb_build_object(
    'km', round(v_km::numeric, 2),
    'price', round((v_km * v_settings.price_per_km)::numeric, 2),
    'max_km', v_settings.max_km,
    'within_range', (v_settings.max_km IS NULL OR v_km <= v_settings.max_km)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION resolutoo.estimate_shipping(double precision, double precision, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
