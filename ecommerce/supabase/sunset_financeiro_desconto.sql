-- =====================================================
-- admin_financeiro ganha total_discount_given: soma de discount_amount +
-- shipping_discount de todo pedido pago — quanto o lojista "abriu mão"
-- em campanha/cupom. total_revenue já é o valor líquido (depois do
-- desconto), então total_revenue + total_discount_given = quanto teria
-- sido faturado sem nenhuma promoção.
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.admin_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_total_revenue double precision;
  v_total_discount_given double precision;
  v_total_orders bigint;
  v_status_counts jsonb;
  v_top_products jsonb;
  v_recent_orders jsonb;
  v_motoboys jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);

  SELECT COALESCE(SUM(total), 0), COALESCE(SUM(discount_amount + shipping_discount), 0)
    INTO v_total_revenue, v_total_discount_given
    FROM sunset.orders WHERE payment_status = 'pago';
  SELECT COUNT(*) INTO v_total_orders FROM sunset.orders;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', cnt)), '[]'::jsonb)
    INTO v_status_counts
    FROM (SELECT status, COUNT(*) AS cnt FROM sunset.orders GROUP BY status) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'product_name', product_name,
      'quantity_sold', qty, 'revenue', rev
    ) ORDER BY qty DESC), '[]'::jsonb)
    INTO v_top_products
    FROM (
      SELECT oi.product_id, oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.unit_price * oi.quantity) AS rev
      FROM sunset.order_items oi JOIN sunset.orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'pago'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY qty DESC LIMIT 10
    ) t;

  SELECT COALESCE(jsonb_agg(sunset.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_recent_orders
    FROM (SELECT id, created_at FROM sunset.orders ORDER BY created_at DESC LIMIT 20) o;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name,
      'total_deliveries', d.cnt, 'total_shipping', d.total_shipping,
      'pending_amount', p.amount,
      'total_paid', COALESCE(s.total_paid, 0),
      'avg_delivery_minutes', round(COALESCE(sunset._avg_delivery_minutes(m.id), 0)::numeric, 1)
    ) ORDER BY m.name), '[]'::jsonb)
    INTO v_motoboys
    FROM sunset.motoboys m
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(o.shipping_price), 0) AS total_shipping
      FROM sunset.orders o
      WHERE o.motoboy_id = m.id AND o.status = 'concluido' AND o.delivery_type = 'entrega'
    ) d ON true
    LEFT JOIN LATERAL (SELECT * FROM sunset._motoboy_pending(m.id)) p ON true
    LEFT JOIN LATERAL (
      SELECT SUM(amount) AS total_paid FROM sunset.motoboy_settlements WHERE motoboy_id = m.id
    ) s ON true;

  RETURN jsonb_build_object(
    'total_revenue', v_total_revenue,
    'total_discount_given', v_total_discount_given,
    'total_orders', v_total_orders,
    'orders_by_status', v_status_counts,
    'top_products', v_top_products,
    'recent_orders', v_recent_orders,
    'motoboys', v_motoboys,
    'avg_delivery_minutes', round(COALESCE(sunset._avg_delivery_minutes(NULL), 0)::numeric, 1)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_financeiro(text) TO anon, authenticated;
