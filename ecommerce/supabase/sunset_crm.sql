-- =====================================================
-- CRM — página /crm no dashboard admin: lista de clientes com estatísticas
-- de compra (total gasto, nº de pedidos, último pedido) e data de
-- nascimento (útil pra puxar aniversariantes do mês, tie-in com o cupom
-- de aniversário). Separado da página de campanha/cupom por design — o
-- cupom de aniversário só CONSOME o dado de nascimento que o CRM expõe,
-- não o contrário.
-- =====================================================

-- Defensivo: RLS sem política nenhuma, só alcançável via função SECURITY
-- DEFINER — mesmo padrão de sessions/vendedores/coupons/campaigns. Idempotente
-- (não dá erro se já estava habilitado).
ALTER TABLE sunset.customers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION sunset.admin_crm_customers(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'whatsapp', c.whatsapp, 'birthdate', c.birthdate,
      'total_spent', COALESCE(stats.total_spent, 0),
      'order_count', COALESCE(stats.order_count, 0),
      'last_order_at', stats.last_order_at
    ) ORDER BY COALESCE(stats.total_spent, 0) DESC)
    FROM sunset.customers c
    LEFT JOIN (
      SELECT customer_id, SUM(total) AS total_spent, COUNT(*) AS order_count, MAX(created_at) AS last_order_at
      FROM sunset.orders
      WHERE payment_status = 'pago'
      GROUP BY customer_id
    ) stats ON stats.customer_id = c.id
    WHERE c.id <> 'pdv-balcao-anonimo'
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_crm_customers(text) TO anon, authenticated;
