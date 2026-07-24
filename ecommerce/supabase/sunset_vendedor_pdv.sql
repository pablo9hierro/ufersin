-- =====================================================
-- Vendedor (novo papel) + PDV (venda presencial no balcão)
--
-- Vendedor usa a MESMA tela do admin (layout compartilhado no front), mas
-- só enxerga PDV + Relatórios — reforçado no front (nav filtrado + guarda
-- de rota) e no banco (cada RPC só aceita os papéis certos via
-- _require_admin / _require_admin_or_vendedor).
-- =====================================================

-- 1. sessions ganha o papel 'vendedor' ------------------------------------
ALTER TABLE sunset.sessions DROP CONSTRAINT IF EXISTS sessions_role_check;
ALTER TABLE sunset.sessions ADD CONSTRAINT sessions_role_check CHECK (role IN ('admin', 'motoboy', 'vendedor'));

-- 2. tabela vendedores (espelha sunset.motoboys, sem telefone/whatsapp —
--    vendedor não tem instância própria de WhatsApp; toda mensagem de
--    venda no PDV sai do número da LOJA) -----------------------------------
CREATE TABLE IF NOT EXISTS sunset.vendedores (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active        BIGINT NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (now()::text)
);

CREATE OR REPLACE FUNCTION sunset.vendedor_login(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_v sunset.vendedores%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_v FROM sunset.vendedores WHERE email = p_email;
  IF NOT FOUND OR v_v.active = 0 OR v_v.password_hash <> crypt(p_password, v_v.password_hash) THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO sunset.sessions (token, role, subject_id) VALUES (v_token, 'vendedor', v_v.id);

  RETURN jsonb_build_object('token', v_token, 'name', v_v.name);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.vendedor_login(text, text) TO anon, authenticated;

-- Aceita admin OU vendedor — usado pelo PDV e pelos relatórios, que os
-- dois papéis acessam (cada um vê o recorte de dados certo dentro da RPC).
CREATE OR REPLACE FUNCTION sunset._require_admin_or_vendedor(p_token text)
RETURNS TABLE(subject_id text, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_subject text;
  v_role text;
BEGIN
  SELECT s.subject_id, s.role INTO v_subject, v_role FROM sunset.sessions s
    WHERE s.token = p_token AND s.role IN ('admin', 'vendedor') AND s.expires_at > now();
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY SELECT v_subject, v_role;
END;
$$;

-- 3. CRUD de vendedores (só admin) -----------------------------------------
CREATE OR REPLACE FUNCTION sunset._vendedor_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object('id', id, 'name', name, 'email', email, 'active', (active <> 0))
  FROM sunset.vendedores WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_list_vendedores(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(sunset._vendedor_json(id) ORDER BY name) FROM sunset.vendedores), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_vendedores(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_create_vendedor(p_token text, p_name text, p_email text, p_password text)
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
  BEGIN
    INSERT INTO sunset.vendedores (id, name, email, password_hash)
      VALUES (v_id, p_name, p_email, crypt(p_password, gen_salt('bf')));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN sunset._vendedor_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_vendedor(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_vendedor(
  p_token text, p_id text, p_name text, p_email text, p_active boolean DEFAULT true, p_password text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE sunset.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      password_hash = crypt(p_password, gen_salt('bf'))
    WHERE id = p_id;
  ELSE
    UPDATE sunset.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendedor not found';
  END IF;
  RETURN sunset._vendedor_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_vendedor(text, text, text, text, boolean, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_delete_vendedor(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  DELETE FROM sunset.vendedores WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendedor not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_delete_vendedor(text, text) TO anon, authenticated;

-- 4. código de barras nos produtos ------------------------------------------
ALTER TABLE sunset.products ADD COLUMN IF NOT EXISTS barcode text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON sunset.products (barcode) WHERE barcode IS NOT NULL;

CREATE OR REPLACE FUNCTION sunset._product_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price,
    'quantity', p.quantity, 'image_url', p.image_url, 'category_id', p.category_id,
    'category_name', c.name, 'active', (p.active <> 0), 'barcode', p.barcode
  )
  FROM sunset.products p
  LEFT JOIN sunset.categories c ON c.id = p.category_id
  WHERE p.id = p_id;
$$;

-- admin_create_product/admin_update_product ganham p_barcode — muda
-- assinatura, precisa dropar a antiga primeiro.
DROP FUNCTION IF EXISTS sunset.admin_create_product(text, text, text, double precision, bigint, text, text, boolean);

CREATE OR REPLACE FUNCTION sunset.admin_create_product(
  p_token text, p_name text, p_description text, p_price double precision,
  p_quantity bigint, p_image_url text, p_category_id text, p_active boolean DEFAULT true,
  p_barcode text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  BEGIN
    INSERT INTO sunset.products (id, name, description, price, quantity, image_url, category_id, active, barcode)
      VALUES (v_id, p_name, p_description, p_price, p_quantity, p_image_url, p_category_id,
        CASE WHEN p_active THEN 1 ELSE 0 END, NULLIF(trim(p_barcode), ''));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'barcode already in use by another product';
  END;
  RETURN sunset._product_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_product(text, text, text, double precision, bigint, text, text, boolean, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS sunset.admin_update_product(text, text, text, text, double precision, bigint, text, text, boolean);

CREATE OR REPLACE FUNCTION sunset.admin_update_product(
  p_token text, p_id text, p_name text, p_description text, p_price double precision,
  p_quantity bigint, p_image_url text, p_category_id text, p_active boolean DEFAULT true,
  p_barcode text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  BEGIN
    UPDATE sunset.products SET
      name = p_name, description = p_description, price = p_price, quantity = p_quantity,
      image_url = p_image_url, category_id = p_category_id, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      barcode = NULLIF(trim(p_barcode), '')
    WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'barcode already in use by another product';
  END;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found';
  END IF;
  RETURN sunset._product_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_product(text, text, text, text, double precision, bigint, text, text, boolean, text) TO anon, authenticated;

-- 5. orders ganha colunas de atribuição de venda PDV + 'balcao' como
--    delivery_type válido (venda direta no balcão, sem entrega nem
--    retirada de pedido feito online) --------------------------------------
ALTER TABLE sunset.orders ADD COLUMN IF NOT EXISTS sold_by_role text;
ALTER TABLE sunset.orders ADD COLUMN IF NOT EXISTS sold_by_id text;

ALTER TABLE sunset.orders DROP CONSTRAINT IF EXISTS orders_delivery_type_check;
ALTER TABLE sunset.orders ADD CONSTRAINT orders_delivery_type_check CHECK (delivery_type IN ('entrega', 'retirada', 'balcao'));

-- 6. criar venda no PDV -----------------------------------------------------
-- Nome/WhatsApp do cliente são OPCIONAIS (cliente de balcão pode não
-- querer informar) — sem eles, "Cliente balcão" é usado só como rótulo,
-- SEM vincular/criar registro em sunset.customers (evita amontoar
-- "clientes" fantasmas sem WhatsApp de verdade).
CREATE OR REPLACE FUNCTION sunset.pdv_create_sale(
  p_token text,
  p_items jsonb,
  p_payment_method text,
  p_customer_name text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sunset, public, extensions
AS $$
DECLARE
  v_subject     text;
  v_role        text;
  v_item        jsonb;
  v_product     sunset.products%ROWTYPE;
  v_quantity    bigint;
  v_total       double precision := 0;
  v_customer_id text;
  v_order_id    text := gen_random_uuid()::text;
  v_item_id     text;
  v_name        text;
  v_whatsapp    text;
BEGIN
  SELECT * INTO v_subject, v_role FROM sunset._require_admin_or_vendedor(p_token);

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'sale must have at least one item';
  END IF;
  IF p_payment_method NOT IN ('pix', 'cartao', 'dinheiro') THEN
    RAISE EXCEPTION 'invalid payment_method';
  END IF;

  v_name := COALESCE(NULLIF(trim(p_customer_name), ''), 'Cliente balcão');
  v_whatsapp := NULLIF(trim(p_customer_whatsapp), '');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM sunset.products WHERE id = (v_item->>'product_id') FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product % not found', v_item->>'product_id';
    END IF;
    IF v_product.active = 0 THEN
      RAISE EXCEPTION 'product % is not available', v_product.name;
    END IF;
    IF v_product.quantity < v_quantity THEN
      RAISE EXCEPTION 'insufficient stock for product %', v_product.name;
    END IF;

    v_total := v_total + v_product.price * v_quantity;
  END LOOP;

  IF v_whatsapp IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM sunset.customers WHERE whatsapp = v_whatsapp;
    IF v_customer_id IS NULL THEN
      v_customer_id := gen_random_uuid()::text;
      INSERT INTO sunset.customers (id, name, whatsapp) VALUES (v_customer_id, v_name, v_whatsapp);
    ELSE
      UPDATE sunset.customers SET name = v_name WHERE id = v_customer_id;
    END IF;
  END IF;

  -- Venda de balcão já nasce paga e concluída — não existe fluxo de
  -- preparo/entrega pra ela, é um só passo (diferente do checkout online).
  INSERT INTO sunset.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    payment_method, payment_status, status, shipping_price, total,
    sold_by_role, sold_by_id
  ) VALUES (
    v_order_id, v_customer_id, v_name, COALESCE(v_whatsapp, ''), 'balcao',
    p_payment_method, 'pago', 'concluido', 0, v_total,
    v_role, v_subject
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM sunset.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO sunset.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE sunset.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN sunset.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.pdv_create_sale(text, jsonb, text, text, text) TO anon, authenticated;

-- 7. relatório de vendas — vendedor só vê as próprias vendas de balcão;
--    admin vê todas (de qualquer vendedor + as que ele mesmo bateu) -------
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
    ) o;

  RETURN jsonb_build_object('total_sales', v_total_sales, 'total_count', v_total_count, 'sales', v_sales);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.vendedor_relatorio(text) TO anon, authenticated;
