-- =====================================================
-- admin_crm_customers ganha, por cliente:
-- - orders: [{total, created_at}] (pedidos pagos, um por pedido — não item
--   por item como "purchases") — alimenta os filtros "gastou acima/abaixo
--   de R$X em Y dias" e "reduziu a frequência de compra em X%".
-- - distance_km: distância (haversine) do endereço de entrega mais recente
--   até a loja, calculada AQUI (as coordenadas da loja nunca saem do
--   banco/backend) — alimenta "distância de no máximo Xkm".
-- - total_items: soma de quantidade de itens comprados (não nº de pedidos)
--   — alimenta "maior volume de compras".
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.admin_crm_customers(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_settings sunset.shipping_settings%ROWTYPE;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_settings FROM sunset.shipping_settings WHERE id = 1;

  RETURN COALESCE((
    WITH paid_orders AS (
      SELECT * FROM sunset.orders WHERE payment_status = 'pago'
    ),
    order_stats AS (
      SELECT
        customer_id,
        SUM(total) AS total_spent,
        COUNT(*) AS order_count,
        MIN(created_at) AS first_order_at,
        MAX(created_at) AS last_order_at,
        COALESCE(jsonb_agg(DISTINCT neighborhood) FILTER (WHERE neighborhood IS NOT NULL), '[]'::jsonb) AS neighborhoods,
        COALESCE(jsonb_agg(jsonb_build_object('total', total, 'created_at', created_at) ORDER BY created_at DESC), '[]'::jsonb) AS orders
      FROM paid_orders
      GROUP BY customer_id
    ),
    purchase_events AS (
      SELECT o.customer_id,
        jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'created_at', o.created_at)) AS purchases,
        SUM(oi.quantity) AS total_items
      FROM paid_orders o
      JOIN sunset.order_items oi ON oi.order_id = o.id
      GROUP BY o.customer_id
    ),
    last_location AS (
      SELECT DISTINCT ON (customer_id) customer_id, customer_lat, customer_lng
      FROM paid_orders
      WHERE customer_lat IS NOT NULL AND customer_lng IS NOT NULL
      ORDER BY customer_id, created_at DESC
    )
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'whatsapp', c.whatsapp, 'birthdate', c.birthdate,
      'total_spent', COALESCE(os.total_spent, 0),
      'order_count', COALESCE(os.order_count, 0),
      'total_items', COALESCE(pe.total_items, 0),
      'first_order_at', os.first_order_at,
      'last_order_at', os.last_order_at,
      'neighborhoods', COALESCE(os.neighborhoods, '[]'::jsonb),
      'purchases', COALESCE(pe.purchases, '[]'::jsonb),
      'orders', COALESCE(os.orders, '[]'::jsonb),
      'distance_km', CASE WHEN ll.customer_lat IS NULL THEN NULL
        ELSE round(sunset._distance_km(v_settings.store_lat, v_settings.store_lng, ll.customer_lat, ll.customer_lng)::numeric, 1)
      END
    ) ORDER BY c.name)
    FROM sunset.customers c
    LEFT JOIN order_stats os ON os.customer_id = c.id
    LEFT JOIN purchase_events pe ON pe.customer_id = c.id
    LEFT JOIN last_location ll ON ll.customer_id = c.id
    WHERE c.id <> 'pdv-balcao-anonimo'
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_crm_customers(text) TO anon, authenticated;
