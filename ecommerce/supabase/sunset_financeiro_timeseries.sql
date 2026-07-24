-- =====================================================
-- Série temporal (últimos N dias) pro gráfico do financeiro: quantidade
-- vendida por dia, faturamento por dia, e uso de cupom/campanha por dia
-- (contagem de pedidos + desconto concedido) — o front pluga isso num
-- gráfico com checkbox "cupom"/"campanha" pra ligar/desligar cada série.
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.admin_financeiro_timeseries(p_token text, p_days bigint DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_days bigint := GREATEST(LEAST(COALESCE(p_days, 30), 180), 1);
  v_result jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date', d.day,
      'quantity_sold', COALESCE(q.qty, 0),
      'revenue', COALESCE(o.revenue, 0),
      'orders_count', COALESCE(o.orders_count, 0),
      'coupon_orders', COALESCE(o.coupon_orders, 0),
      'coupon_discount', COALESCE(o.coupon_discount, 0),
      'campaign_orders', COALESCE(o.campaign_orders, 0),
      'campaign_discount', COALESCE(o.campaign_discount, 0)
    ) ORDER BY d.day), '[]'::jsonb)
    INTO v_result
    FROM generate_series(current_date - (v_days - 1), current_date, interval '1 day') AS d(day)
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS orders_count,
        SUM(total) AS revenue,
        COUNT(*) FILTER (WHERE coupon_code IS NOT NULL) AS coupon_orders,
        SUM(discount_amount + shipping_discount) FILTER (WHERE coupon_code IS NOT NULL) AS coupon_discount,
        COUNT(*) FILTER (WHERE campaign_id IS NOT NULL) AS campaign_orders,
        SUM(discount_amount + shipping_discount) FILTER (WHERE campaign_id IS NOT NULL) AS campaign_discount
      FROM sunset.orders
      WHERE payment_status = 'pago' AND created_at::date = d.day::date
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT SUM(oi.quantity) AS qty
      FROM sunset.order_items oi JOIN sunset.orders ord ON ord.id = oi.order_id
      WHERE ord.payment_status = 'pago' AND ord.created_at::date = d.day::date
    ) q ON true;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_financeiro_timeseries(text, bigint) TO anon, authenticated;
