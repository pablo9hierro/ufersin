-- =====================================================
-- Sunset Tabas — motoboy fica com 100% do frete (fim da comissão em %)
-- + baixa de pagamento pelo admin (dinheiro/Pix), com histórico.
--
-- 100% do shipping_price de cada entrega concluída é do motoboy. O que
-- muda é só CONTROLE DE REPASSE: motoboy_paid_at marca quando aquele
-- frete já foi entregue em mãos ao motoboy; motoboy_settlements guarda
-- o histórico de cada "acerto" (pode agrupar várias entregas de uma vez).
--
-- Não depende de nenhuma migration do Rust — pode rodar isso direto.
-- =====================================================

ALTER TABLE sunset.orders ADD COLUMN IF NOT EXISTS motoboy_paid_at timestamptz;

CREATE TABLE IF NOT EXISTS sunset.motoboy_settlements (
  id text PRIMARY KEY,
  motoboy_id text NOT NULL REFERENCES sunset.motoboys(id) ON DELETE CASCADE,
  amount double precision NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('dinheiro','pix')),
  order_ids text[] NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sunset.motoboy_settlements ENABLE ROW LEVEL SECURITY;
-- Sem policies de propósito — só acessível via RPC SECURITY DEFINER,
-- mesmo padrão de sunset.orders/sunset.motoboys.

ALTER TABLE sunset.motoboys DROP COLUMN IF EXISTS commission_percent;

-- ─────────────────────────────────────────────────────
-- CRUD de motoboy sem commission_percent — precisa trocar assinatura.
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset._motoboy_json(text);
DROP FUNCTION IF EXISTS sunset.admin_create_motoboy(text, text, text, text, text, text, double precision);
DROP FUNCTION IF EXISTS sunset.admin_update_motoboy(text, text, text, text, text, text, boolean, text, double precision);

CREATE OR REPLACE FUNCTION sunset._motoboy_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'phone', phone, 'email', email, 'whatsapp', whatsapp,
    'active', (active <> 0)
  )
  FROM sunset.motoboys WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_create_motoboy(
  p_token text, p_name text, p_phone text, p_email text, p_password text,
  p_whatsapp text DEFAULT NULL
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
    INSERT INTO sunset.motoboys (id, name, phone, email, password_hash, whatsapp, active)
      VALUES (v_id, p_name, p_phone, p_email, crypt(p_password, gen_salt('bf')), p_whatsapp, 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN sunset._motoboy_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_motoboy(text, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_motoboy(
  p_token text, p_id text, p_name text, p_phone text, p_email text,
  p_password text DEFAULT NULL, p_active boolean DEFAULT true,
  p_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE sunset.motoboys SET
      name = p_name, phone = p_phone, email = p_email,
      password_hash = crypt(p_password, gen_salt('bf')), active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp)
    WHERE id = p_id;
  ELSE
    UPDATE sunset.motoboys SET
      name = p_name, phone = p_phone, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp)
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
  RETURN sunset._motoboy_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_motoboy(text, text, text, text, text, text, boolean, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Quanto cada motoboy tem a receber agora (entregas concluídas, ainda
-- não repassadas) — usado tanto pelo popup "Pagar" do admin quanto,
-- indiretamente, pelo financeiro de cada um.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._motoboy_pending(p_motoboy_id text)
RETURNS TABLE(order_ids text[], amount double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT COALESCE(array_agg(id), ARRAY[]::text[]), COALESCE(SUM(shipping_price), 0)
  FROM sunset.orders
  WHERE motoboy_id = p_motoboy_id AND status = 'concluido' AND delivery_type = 'entrega'
    AND motoboy_paid_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_motoboy_pending(p_token text, p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_pending RECORD;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_pending FROM sunset._motoboy_pending(p_id);
  RETURN jsonb_build_object(
    'pending_amount', v_pending.amount,
    'pending_deliveries', array_length(v_pending.order_ids, 1)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_motoboy_pending(text, text) TO anon, authenticated;

-- Dá baixa: marca as entregas pendentes como pagas e registra o acerto.
-- Idempotente contra duplo-clique: se não há nada pendente, dá erro em
-- vez de criar um settlement de R$0.
CREATE OR REPLACE FUNCTION sunset.admin_pay_motoboy(p_token text, p_motoboy_id text, p_payment_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_pending RECORD;
  v_settlement_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_payment_method NOT IN ('dinheiro','pix') THEN
    RAISE EXCEPTION 'invalid payment_method';
  END IF;

  SELECT * INTO v_pending FROM sunset._motoboy_pending(p_motoboy_id);
  IF v_pending.amount IS NULL OR v_pending.amount <= 0 THEN
    RAISE EXCEPTION 'motoboy has nothing pending to pay';
  END IF;

  UPDATE sunset.orders SET motoboy_paid_at = now() WHERE id = ANY(v_pending.order_ids);

  INSERT INTO sunset.motoboy_settlements (id, motoboy_id, amount, payment_method, order_ids)
    VALUES (v_settlement_id, p_motoboy_id, v_pending.amount, p_payment_method, v_pending.order_ids);

  RETURN jsonb_build_object(
    'id', v_settlement_id, 'amount', v_pending.amount, 'payment_method', p_payment_method
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_pay_motoboy(text, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Financeiro do motoboy (própria fila) — 100% do frete, sem comissão.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.motoboy_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
  v_deliveries jsonb;
  v_total_shipping double precision;
  v_pending RECORD;
  v_total_paid double precision;
  v_settlements jsonb;
BEGIN
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id,
      'customer_name', o.customer_name,
      'neighborhood', o.neighborhood,
      'shipping_price', o.shipping_price,
      'earned', o.shipping_price,
      'paid', (o.motoboy_paid_at IS NOT NULL),
      'updated_at', o.updated_at
    ) ORDER BY o.updated_at DESC), '[]'::jsonb),
    COALESCE(SUM(o.shipping_price), 0)
  INTO v_deliveries, v_total_shipping
  FROM sunset.orders o
  WHERE o.motoboy_id = v_motoboy_id AND o.status = 'concluido' AND o.delivery_type = 'entrega';

  SELECT * INTO v_pending FROM sunset._motoboy_pending(v_motoboy_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM sunset.motoboy_settlements WHERE motoboy_id = v_motoboy_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'amount', amount, 'payment_method', payment_method, 'paid_at', paid_at
    ) ORDER BY paid_at DESC), '[]'::jsonb)
    INTO v_settlements
    FROM sunset.motoboy_settlements WHERE motoboy_id = v_motoboy_id;

  RETURN jsonb_build_object(
    'pending_amount', v_pending.amount,
    'total_paid', v_total_paid,
    'total_deliveries', jsonb_array_length(v_deliveries),
    'total_shipping', v_total_shipping,
    'deliveries', v_deliveries,
    'settlements', v_settlements
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_financeiro(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Financeiro do admin — troca comissão/total_earnings por
-- pending_amount/total_paid por motoboy.
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
      'id', m.id, 'name', m.name,
      'total_deliveries', d.cnt, 'total_shipping', d.total_shipping,
      'pending_amount', p.amount,
      'total_paid', COALESCE(s.total_paid, 0)
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
    'total_orders', v_total_orders,
    'orders_by_status', v_status_counts,
    'top_products', v_top_products,
    'recent_orders', v_recent_orders,
    'motoboys', v_motoboys
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_financeiro(text) TO anon, authenticated;
