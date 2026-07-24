-- =====================================================
-- Suporte a ordenação "mais vendido" no /catalogo — os outros critérios
-- (preço, alfabético) já dá pra calcular 100% client-side com os campos
-- que o catálogo já busca; só quantidade vendida precisa de uma consulta
-- nova (soma de order_items de pedidos pagos), então em vez de mexer na
-- query de produtos existente (usada em vários lugares), isso é uma RPC
-- separada e pequena, só {product_id, sold_count}, buscada à parte e
-- cruzada no client — zero risco pro resto do catálogo/checkout.
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.product_sales_counts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', product_id, 'sold_count', sold_count)), '[]'::jsonb)
  FROM (
    SELECT oi.product_id, SUM(oi.quantity) AS sold_count
    FROM sunset.order_items oi
    JOIN sunset.orders o ON o.id = oi.order_id
    WHERE o.payment_status = 'pago'
    GROUP BY oi.product_id
  ) t;
$$;
GRANT EXECUTE ON FUNCTION sunset.product_sales_counts() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
