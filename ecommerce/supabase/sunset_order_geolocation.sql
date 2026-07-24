-- =====================================================
-- Sunset Tabas — expõe customer_lat/customer_lng (capturados via
-- webhook da Evolution API quando o cliente compartilha localização
-- no WhatsApp) no retorno de sunset.get_order — usado por toda
-- consulta de pedido (admin, motoboy, financeiro), então essa
-- única troca já propaga os campos novos pra tudo.
--
-- IMPORTANTE: rode isso DEPOIS que o backend Rust no Railway já
-- tiver redeployado com a migration 0002_order_geolocation.sql
-- (cria as colunas customer_lat/customer_lng em sunset.orders — o
-- Rust roda essa migration sozinho no boot). Se rodar este arquivo
-- antes disso, vai dar erro "column does not exist".
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = sunset, public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'customer_name', o.customer_name,
    'customer_whatsapp', o.customer_whatsapp,
    'delivery_type', o.delivery_type,
    'neighborhood', o.neighborhood,
    'address', o.address,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'status', o.status,
    'shipping_price', o.shipping_price,
    'total', o.total,
    'motoboy_id', o.motoboy_id,
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
      FROM sunset.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM sunset.orders o
  WHERE o.id = p_order_id;
$$;

GRANT EXECUTE ON FUNCTION sunset.get_order(text) TO anon, authenticated;
