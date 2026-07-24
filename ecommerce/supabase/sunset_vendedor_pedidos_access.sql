-- =====================================================
-- Vendedor ganha acesso à página /admin/pedidos: pode ver e avançar os
-- pedidos feitos por cliente na landingpage, do mesmo jeito que o admin
-- (pendente -> montando -> pronto -> retirada/entrega -> concluído),
-- incluindo dar baixa em retiradas. Pedidos online não têm dono
-- (nenhum vendedor específico), então a listagem não é filtrada por quem
-- está logado — admin e vendedor enxergam a mesma fila.
--
-- Reaproveita sunset._require_admin_or_vendedor (já criada em
-- sunset_vendedor_pdv.sql) só trocando _require_admin por ela nessas duas
-- funções.
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.admin_list_orders(p_token text, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin_or_vendedor(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(sunset.get_order(o.id) ORDER BY o.created_at DESC)
     FROM sunset.orders o
     WHERE p_status IS NULL OR o.status = p_status),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_orders(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_order_status(p_token text, p_order_id text, p_status text, p_payment_confirmed boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_order sunset.orders%ROWTYPE;
  v_set_paid boolean;
BEGIN
  PERFORM sunset._require_admin_or_vendedor(p_token);
  SELECT * INTO v_order FROM sunset.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_set_paid := sunset._admin_apply_transition(
    v_order.status, p_status, v_order.delivery_type, v_order.payment_method, v_order.payment_status, p_payment_confirmed
  );

  IF v_set_paid THEN
    UPDATE sunset.orders SET status = p_status, payment_status = 'pago', updated_at = now()::text WHERE id = p_order_id;
  ELSE
    UPDATE sunset.orders SET status = p_status, updated_at = now()::text WHERE id = p_order_id;
  END IF;

  RETURN sunset.get_order(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_order_status(text, text, text, boolean) TO anon, authenticated;
