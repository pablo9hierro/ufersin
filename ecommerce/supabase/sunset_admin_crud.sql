-- =====================================================
-- Sunset Tabas — CRUD do painel admin e fila do motoboy,
-- tudo via RPC (SECURITY DEFINER) escopado ao schema `sunset`,
-- usando o mesmo token de sunset.sessions (ver
-- sunset_admin_auth.sql). Substitui as rotas /api/admin/* e
-- /api/motoboy/* do backend Rust no Railway.
--
-- Execute no SQL Editor DEPOIS de sunset_public_rls_and_rpc.sql
-- e sunset_admin_auth.sql.
--
-- OBS: os avisos de WhatsApp que o backend Rust disparava em
-- certas transições de status (pedido pronto pra retirada, saiu
-- pra entrega, pedir localização) NÃO estão aqui ainda — isso
-- entra na fase da Evolution API via Edge Function. Por enquanto
-- essas RPCs só mudam o status no banco, sem mandar mensagem.
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. Categorias
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.admin_list_categories(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name) FROM sunset.categories),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_categories(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_create_category(p_token text, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  BEGIN
    INSERT INTO sunset.categories (id, name) VALUES (v_id, p_name);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'category name already exists';
  END;
  RETURN jsonb_build_object('id', v_id, 'name', p_name);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_category(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_category(p_token text, p_id text, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  UPDATE sunset.categories SET name = p_name WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category not found';
  END IF;
  RETURN jsonb_build_object('id', p_id, 'name', p_name);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_category(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_delete_category(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  DELETE FROM sunset.categories WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_delete_category(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 2. Produtos
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._product_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price,
    'quantity', p.quantity, 'image_url', p.image_url, 'category_id', p.category_id,
    'category_name', c.name, 'active', (p.active <> 0)
  )
  FROM sunset.products p
  LEFT JOIN sunset.categories c ON c.id = p.category_id
  WHERE p.id = p_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_list_products(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(sunset._product_json(p.id) ORDER BY p.name) FROM sunset.products p),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_products(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_get_product(p_token text, p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  v_result := sunset._product_json(p_id);
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'product not found';
  END IF;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_get_product(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_create_product(
  p_token text, p_name text, p_description text, p_price double precision,
  p_quantity bigint, p_image_url text, p_category_id text, p_active boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  INSERT INTO sunset.products (id, name, description, price, quantity, image_url, category_id, active)
    VALUES (v_id, p_name, p_description, p_price, p_quantity, p_image_url, p_category_id,
      CASE WHEN p_active THEN 1 ELSE 0 END);
  RETURN sunset._product_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_product(text, text, text, double precision, bigint, text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_product(
  p_token text, p_id text, p_name text, p_description text, p_price double precision,
  p_quantity bigint, p_image_url text, p_category_id text, p_active boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  UPDATE sunset.products SET
    name = p_name, description = p_description, price = p_price, quantity = p_quantity,
    image_url = p_image_url, category_id = p_category_id, active = CASE WHEN p_active THEN 1 ELSE 0 END
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found';
  END IF;
  RETURN sunset._product_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_product(text, text, text, text, double precision, bigint, text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_delete_product(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  DELETE FROM sunset.products WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_delete_product(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 3. Motoboys
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._motoboy_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
  SELECT jsonb_build_object('id', id, 'name', name, 'phone', phone, 'email', email, 'active', (active <> 0))
  FROM sunset.motoboys WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_list_motoboys(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(sunset._motoboy_json(id) ORDER BY name) FROM sunset.motoboys),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_motoboys(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_create_motoboy(p_token text, p_name text, p_phone text, p_email text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_password IS NULL OR trim(p_password) = '' THEN
    RAISE EXCEPTION 'password is required to create a motoboy';
  END IF;
  BEGIN
    INSERT INTO sunset.motoboys (id, name, phone, email, password_hash, active)
      VALUES (v_id, p_name, p_phone, p_email, crypt(p_password, gen_salt('bf')), 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN sunset._motoboy_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_motoboy(text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_motoboy(
  p_token text, p_id text, p_name text, p_phone text, p_email text,
  p_password text DEFAULT NULL, p_active boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE sunset.motoboys SET
      name = p_name, phone = p_phone, email = p_email,
      password_hash = crypt(p_password, gen_salt('bf')), active = CASE WHEN p_active THEN 1 ELSE 0 END
    WHERE id = p_id;
  ELSE
    UPDATE sunset.motoboys SET
      name = p_name, phone = p_phone, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
  RETURN sunset._motoboy_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_motoboy(text, text, text, text, text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_delete_motoboy(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  DELETE FROM sunset.motoboys WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_delete_motoboy(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 4. Fluxo de status (portado de backend/src/status_flow.rs)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._confirm_payment_if_needed(p_payment_method text, p_payment_status text, p_payment_confirmed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  IF p_payment_method = 'pix' THEN
    IF p_payment_status <> 'pago' THEN
      RAISE EXCEPTION 'pix payment has not been confirmed yet';
    END IF;
    RETURN false;
  ELSE
    IF p_payment_confirmed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'payment_confirmed: true is required to complete this order';
    END IF;
    RETURN true;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sunset._admin_apply_transition(
  p_current_status text, p_target_status text, p_delivery_type text,
  p_payment_method text, p_payment_status text, p_payment_confirmed boolean
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  IF p_current_status = 'pendente' AND p_target_status = 'montando_pedido' THEN
    RETURN false;
  ELSIF p_current_status = 'montando_pedido' AND p_target_status = 'pedido_pronto' THEN
    RETURN false;
  ELSIF p_current_status = 'pedido_pronto' AND p_target_status = 'retiradas' THEN
    IF p_delivery_type <> 'retirada' THEN
      RAISE EXCEPTION 'only retirada orders can move to retiradas';
    END IF;
    RETURN false;
  ELSIF p_current_status = 'retiradas' AND p_target_status = 'concluido' THEN
    IF p_delivery_type <> 'retirada' THEN
      RAISE EXCEPTION 'only retirada orders can be concluded from retiradas';
    END IF;
    RETURN sunset._confirm_payment_if_needed(p_payment_method, p_payment_status, p_payment_confirmed);
  ELSE
    RAISE EXCEPTION 'invalid status transition: % -> %', p_current_status, p_target_status;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sunset._motoboy_apply_transition(
  p_current_status text, p_target_status text,
  p_payment_method text, p_payment_status text, p_payment_confirmed boolean
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  IF p_current_status = 'aguardando_localizacao' AND p_target_status = 'em_rota_de_entrega' THEN
    RETURN false;
  ELSIF p_current_status = 'em_rota_de_entrega' AND p_target_status = 'entregue' THEN
    RETURN sunset._confirm_payment_if_needed(p_payment_method, p_payment_status, p_payment_confirmed);
  ELSIF p_current_status = 'entregue' AND p_target_status = 'concluido' THEN
    IF p_payment_status = 'pago' THEN
      RETURN false;
    ELSE
      RETURN sunset._confirm_payment_if_needed(p_payment_method, p_payment_status, p_payment_confirmed);
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid status transition: % -> %', p_current_status, p_target_status;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 5. Pedidos (admin)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.admin_list_orders(p_token text, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
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
  PERFORM sunset._require_admin(p_token);
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

-- ─────────────────────────────────────────────────────
-- 6. Frete
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.admin_list_shipping_rates(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(jsonb_build_object('neighborhood', neighborhood, 'price', price) ORDER BY neighborhood)
     FROM sunset.neighborhood_shipping_rates),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_shipping_rates(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_shipping_rate(p_token text, p_neighborhood text, p_price double precision)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  INSERT INTO sunset.neighborhood_shipping_rates (neighborhood, price) VALUES (p_neighborhood, p_price)
    ON CONFLICT (neighborhood) DO UPDATE SET price = EXCLUDED.price;
  RETURN jsonb_build_object('neighborhood', p_neighborhood, 'price', p_price);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_shipping_rate(text, text, double precision) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 7. Financeiro
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.admin_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_total_revenue double precision;
  v_total_orders bigint;
  v_status_counts jsonb;
  v_top_products jsonb;
  v_recent_orders jsonb;
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

  RETURN jsonb_build_object(
    'total_revenue', v_total_revenue,
    'total_orders', v_total_orders,
    'orders_by_status', v_status_counts,
    'top_products', v_top_products,
    'recent_orders', v_recent_orders
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_financeiro(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 8. Fila do motoboy
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.motoboy_list_orders(p_token text, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
BEGIN
  IF p_status NOT IN ('pedido_pronto', 'aguardando_localizacao', 'em_rota_de_entrega', 'concluido') THEN
    RAISE EXCEPTION 'invalid status filter';
  END IF;

  IF p_status = 'pedido_pronto' THEN
    RETURN COALESCE(
      (SELECT jsonb_agg(sunset.get_order(o.id) ORDER BY o.created_at ASC)
       FROM sunset.orders o
       WHERE o.delivery_type = 'entrega' AND o.status = 'pedido_pronto' AND o.motoboy_id IS NULL),
      '[]'::jsonb
    );
  ELSIF p_status = 'em_rota_de_entrega' THEN
    RETURN COALESCE(
      (SELECT jsonb_agg(sunset.get_order(o.id) ORDER BY o.created_at DESC)
       FROM sunset.orders o
       WHERE o.delivery_type = 'entrega' AND o.status IN ('em_rota_de_entrega', 'entregue') AND o.motoboy_id = v_motoboy_id),
      '[]'::jsonb
    );
  ELSE
    RETURN COALESCE(
      (SELECT jsonb_agg(sunset.get_order(o.id) ORDER BY o.created_at DESC)
       FROM sunset.orders o
       WHERE o.delivery_type = 'entrega' AND o.status = p_status AND o.motoboy_id = v_motoboy_id),
      '[]'::jsonb
    );
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_list_orders(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.motoboy_request_location(p_token text, p_order_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
  v_order_id text;
  v_order sunset.orders%ROWTYPE;
  v_updated jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    SELECT * INTO v_order FROM sunset.orders WHERE id = v_order_id;

    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_order_id, 'reason', 'order not found');
      CONTINUE;
    END IF;
    IF v_order.delivery_type <> 'entrega' THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_order_id, 'reason', 'order is not a delivery order');
      CONTINUE;
    END IF;
    IF v_order.status <> 'pedido_pronto' THEN
      v_skipped := v_skipped || jsonb_build_object(
        'id', v_order_id, 'reason', format('order is not in pedido_pronto (currently %s)', v_order.status)
      );
      CONTINUE;
    END IF;
    IF v_order.motoboy_id IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_order_id, 'reason', 'order already assigned to a motoboy');
      CONTINUE;
    END IF;

    UPDATE sunset.orders SET motoboy_id = v_motoboy_id, status = 'aguardando_localizacao', updated_at = now()::text
      WHERE id = v_order_id;
    v_updated := v_updated || sunset.get_order(v_order_id);
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_request_location(text, text[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.motoboy_update_order_status(p_token text, p_order_id text, p_status text, p_payment_confirmed boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
  v_order sunset.orders%ROWTYPE;
  v_set_paid boolean;
BEGIN
  SELECT * INTO v_order FROM sunset.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;
  IF v_order.motoboy_id IS DISTINCT FROM v_motoboy_id THEN
    RAISE EXCEPTION 'order is not assigned to you';
  END IF;

  v_set_paid := sunset._motoboy_apply_transition(
    v_order.status, p_status, v_order.payment_method, v_order.payment_status, p_payment_confirmed
  );

  IF v_set_paid THEN
    UPDATE sunset.orders SET status = p_status, payment_status = 'pago', updated_at = now()::text WHERE id = p_order_id;
  ELSE
    UPDATE sunset.orders SET status = p_status, updated_at = now()::text WHERE id = p_order_id;
  END IF;

  RETURN sunset.get_order(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_update_order_status(text, text, text, boolean) TO anon, authenticated;
