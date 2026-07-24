-- =====================================================
-- Sunset Tabas — comissão do motoboy (whatsapp + porcentagem no
-- cadastro) e telas de financeiro (admin e motoboy).
--
-- Ganho do motoboy por entrega = shipping_price (frete) * commission_percent / 100
-- (usa o frete, não o total do pedido — o motoboy não deveria ganhar
-- comissão em cima do preço dos produtos, só do frete que ele carrega).
--
-- Execute no SQL Editor DEPOIS de sunset_admin_crud.sql.
-- =====================================================

ALTER TABLE sunset.motoboys ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE sunset.motoboys ADD COLUMN IF NOT EXISTS commission_percent double precision NOT NULL DEFAULT 0;

-- Precisa trocar a assinatura (parâmetros novos) — CREATE OR REPLACE não
-- troca lista de parâmetros, só sobrescreve se for idêntica, então dropa
-- as versões antigas primeiro pra não ficar com as duas coexistindo.
DROP FUNCTION IF EXISTS sunset._motoboy_json(text);
DROP FUNCTION IF EXISTS sunset.admin_create_motoboy(text, text, text, text, text);
DROP FUNCTION IF EXISTS sunset.admin_update_motoboy(text, text, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION sunset._motoboy_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'phone', phone, 'email', email, 'whatsapp', whatsapp,
    'commission_percent', commission_percent, 'active', (active <> 0)
  )
  FROM sunset.motoboys WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_create_motoboy(
  p_token text, p_name text, p_phone text, p_email text, p_password text,
  p_whatsapp text DEFAULT NULL, p_commission_percent double precision DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_password IS NULL OR trim(p_password) = '' THEN
    RAISE EXCEPTION 'password is required to create a motoboy';
  END IF;
  BEGIN
    INSERT INTO sunset.motoboys (id, name, phone, email, password_hash, whatsapp, commission_percent, active)
      VALUES (v_id, p_name, p_phone, p_email, crypt(p_password, gen_salt('bf')), p_whatsapp, p_commission_percent, 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN sunset._motoboy_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_motoboy(text, text, text, text, text, text, double precision) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_motoboy(
  p_token text, p_id text, p_name text, p_phone text, p_email text,
  p_password text DEFAULT NULL, p_active boolean DEFAULT true,
  p_whatsapp text DEFAULT NULL, p_commission_percent double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE sunset.motoboys SET
      name = p_name, phone = p_phone, email = p_email,
      password_hash = crypt(p_password, gen_salt('bf')), active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp),
      commission_percent = COALESCE(p_commission_percent, commission_percent)
    WHERE id = p_id;
  ELSE
    UPDATE sunset.motoboys SET
      name = p_name, phone = p_phone, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp),
      commission_percent = COALESCE(p_commission_percent, commission_percent)
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
  RETURN sunset._motoboy_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_motoboy(text, text, text, text, text, text, boolean, text, double precision) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Financeiro do motoboy (própria fila)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.motoboy_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
  v_commission double precision;
  v_deliveries jsonb;
  v_total_shipping double precision;
BEGIN
  SELECT commission_percent INTO v_commission FROM sunset.motoboys WHERE id = v_motoboy_id;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id,
      'customer_name', o.customer_name,
      'neighborhood', o.neighborhood,
      'shipping_price', o.shipping_price,
      'earned', round((o.shipping_price * v_commission / 100)::numeric, 2),
      'updated_at', o.updated_at
    ) ORDER BY o.updated_at DESC), '[]'::jsonb),
    COALESCE(SUM(o.shipping_price), 0)
  INTO v_deliveries, v_total_shipping
  FROM sunset.orders o
  WHERE o.motoboy_id = v_motoboy_id AND o.status = 'concluido' AND o.delivery_type = 'entrega';

  RETURN jsonb_build_object(
    'commission_percent', v_commission,
    'total_deliveries', jsonb_array_length(v_deliveries),
    'total_shipping', v_total_shipping,
    'total_earnings', round((v_total_shipping * v_commission / 100)::numeric, 2),
    'deliveries', v_deliveries
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_financeiro(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Financeiro do admin — adiciona a seção "motoboys" (mesma
-- assinatura de antes, então CREATE OR REPLACE substitui direto)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.admin_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_total_revenue double precision;
  v_total_orders bigint;
  v_status_counts jsonb;
  v_top_products jsonb;
  v_recent_orders jsonb;
  v_motoboys jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);

  SELECT COALESCE(SUM(total), 0) INTO v_total_revenue FROM sunset.orders WHERE payment_status = 'pago';
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
      'id', m.id, 'name', m.name, 'commission_percent', m.commission_percent,
      'total_deliveries', d.cnt, 'total_shipping', d.total_shipping,
      'total_earnings', round((d.total_shipping * m.commission_percent / 100)::numeric, 2)
    ) ORDER BY m.name), '[]'::jsonb)
    INTO v_motoboys
    FROM sunset.motoboys m
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(o.shipping_price), 0) AS total_shipping
      FROM sunset.orders o
      WHERE o.motoboy_id = m.id AND o.status = 'concluido' AND o.delivery_type = 'entrega'
    ) d ON true;

  RETURN jsonb_build_object(
    'total_revenue', v_total_revenue,
    'total_orders', v_total_orders,
    'orders_by_status', v_status_counts,
    'top_products', v_top_products,
    'recent_orders', v_recent_orders,
    'motoboys', v_motoboys
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_financeiro(text) TO anon, authenticated;
