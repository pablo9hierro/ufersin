-- =====================================================
-- 1) Comissão do vendedor: percentual aplicado sobre cada venda dele no
--    PDV. Só guarda o dado aqui (cálculo/relatório de comissão fica pra
--    depois se for pedido) — por enquanto é só cadastro.
-- 2) Origem do pedido (PDV vendedor / PDV admin / site) exposta SÓ pro
--    admin/vendedor — get_order é usada também pelo cliente (checkout,
--    /consultar, /pagamento) e pelo motoboy, então NUNCA pode carregar
--    esse dado. _get_order_admin existe à parte, só pra admin_list_orders
--    e admin_update_order_status.
-- =====================================================

ALTER TABLE sunset.vendedores ADD COLUMN IF NOT EXISTS commission_active BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sunset.vendedores ADD COLUMN IF NOT EXISTS commission_percent DOUBLE PRECISION;

CREATE OR REPLACE FUNCTION sunset._vendedor_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'email', email, 'active', (active <> 0),
    'commission_active', (commission_active <> 0), 'commission_percent', commission_percent
  )
  FROM sunset.vendedores WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS sunset.admin_create_vendedor(text, text, text, text);

CREATE OR REPLACE FUNCTION sunset.admin_create_vendedor(
  p_token text, p_name text, p_email text, p_password text,
  p_commission_active boolean DEFAULT false, p_commission_percent double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'name and email are required';
  END IF;
  IF p_password IS NULL OR trim(p_password) = '' THEN
    RAISE EXCEPTION 'password is required to create a vendedor';
  END IF;
  IF p_commission_active AND (p_commission_percent IS NULL OR p_commission_percent <= 0 OR p_commission_percent > 100) THEN
    RAISE EXCEPTION 'commission_percent must be between 0 and 100';
  END IF;
  BEGIN
    INSERT INTO sunset.vendedores (id, name, email, password_hash, commission_active, commission_percent)
      VALUES (
        v_id, p_name, p_email, crypt(p_password, gen_salt('bf')),
        CASE WHEN p_commission_active THEN 1 ELSE 0 END,
        CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
      );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN sunset._vendedor_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_vendedor(text, text, text, text, boolean, double precision) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_vendedor(text, text, text, text, boolean, text);

CREATE OR REPLACE FUNCTION sunset.admin_update_vendedor(
  p_token text, p_id text, p_name text, p_email text, p_active boolean DEFAULT true, p_password text DEFAULT NULL,
  p_commission_active boolean DEFAULT false, p_commission_percent double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_commission_active AND (p_commission_percent IS NULL OR p_commission_percent <= 0 OR p_commission_percent > 100) THEN
    RAISE EXCEPTION 'commission_percent must be between 0 and 100';
  END IF;
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE sunset.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      password_hash = crypt(p_password, gen_salt('bf')),
      commission_active = CASE WHEN p_commission_active THEN 1 ELSE 0 END,
      commission_percent = CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
    WHERE id = p_id;
  ELSE
    UPDATE sunset.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      commission_active = CASE WHEN p_commission_active THEN 1 ELSE 0 END,
      commission_percent = CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendedor not found';
  END IF;
  RETURN sunset._vendedor_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_vendedor(text, text, text, text, boolean, text, boolean, double precision) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Origem do pedido — admin-only, nunca no get_order público
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._get_order_admin(p_order_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT sunset.get_order(p_order_id) || jsonb_build_object(
    'sold_by_role', o.sold_by_role,
    'sold_by_id', o.sold_by_id,
    'sold_by_name', CASE
      WHEN o.sold_by_role = 'vendedor' THEN v.name
      WHEN o.sold_by_role = 'admin' THEN 'Admin'
      ELSE NULL
    END
  )
  FROM sunset.orders o
  LEFT JOIN sunset.vendedores v ON v.id = o.sold_by_id AND o.sold_by_role = 'vendedor'
  WHERE o.id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_list_orders(p_token text, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin_or_vendedor(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(sunset._get_order_admin(o.id) ORDER BY o.created_at DESC)
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

  RETURN sunset._get_order_admin(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_order_status(text, text, text, boolean) TO anon, authenticated;

-- create_order (checkout do site) sempre grava sold_by_role/sold_by_id
-- como NULL — só pdv_create_sale preenche. Reforça isso não é enforcement
-- novo, só documentação: nenhuma mudança de corpo necessária aqui.

-- vendedor_relatorio ganha sold_by_id/sold_by_name em cada venda — permite
-- o financeiro agrupar por vendedor no front (abas "fulano"/"desempenho
-- geral") sem precisar de uma RPC por vendedor.
CREATE OR REPLACE FUNCTION sunset.vendedor_relatorio(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_subject     text;
  v_role        text;
  v_total_sales double precision;
  v_total_count bigint;
  v_sales       jsonb;
BEGIN
  SELECT * INTO v_subject, v_role FROM sunset._require_admin_or_vendedor(p_token);

  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_total_sales, v_total_count
    FROM sunset.orders
    WHERE delivery_type = 'balcao'
      AND (v_role = 'admin' OR (sold_by_role = 'vendedor' AND sold_by_id = v_subject));

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id, 'total', o.total, 'payment_method', o.payment_method,
      'customer_name', o.customer_name, 'created_at', o.created_at,
      'sold_by_role', o.sold_by_role,
      'sold_by_id', o.sold_by_id,
      'sold_by_name', CASE WHEN o.sold_by_role = 'vendedor' THEN v.name WHEN o.sold_by_role = 'admin' THEN 'Admin' ELSE NULL END,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_name', oi.product_name, 'quantity', oi.quantity, 'unit_price', oi.unit_price
        )) FROM sunset.order_items oi WHERE oi.order_id = o.id
      ), '[]'::jsonb)
    ) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_sales
    FROM (
      SELECT * FROM sunset.orders
      WHERE delivery_type = 'balcao'
        AND (v_role = 'admin' OR (sold_by_role = 'vendedor' AND sold_by_id = v_subject))
      ORDER BY created_at DESC
      LIMIT 100
    ) o
    LEFT JOIN sunset.vendedores v ON v.id = o.sold_by_id AND o.sold_by_role = 'vendedor';

  RETURN jsonb_build_object('total_sales', v_total_sales, 'total_count', v_total_count, 'sales', v_sales);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.vendedor_relatorio(text) TO anon, authenticated;
