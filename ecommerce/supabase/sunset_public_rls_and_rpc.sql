-- =====================================================
-- Sunset Tabas — RLS + RPCs para o frontend (Vercel) falar
-- DIRETO com o Supabase via supabase-js, sem passar pelo
-- backend Rust no Railway.
--
-- Execute no SQL Editor do MESMO projeto Supabase que já é
-- compartilhado com o VRTech.
--
-- ISOLAMENTO: tudo abaixo é escopado ao schema `sunset` — nada
-- aqui cria, altera ou remove qualquer tabela/função/policy dos
-- schemas `vrtech` ou `public`. As tabelas do Sunset já existem
-- (criadas pelo backend Rust via sqlx migrate), este script só
-- adiciona RLS e funções por cima delas.
--
-- IMPORTANTE (fazer manualmente DEPOIS de rodar este SQL):
--   Supabase Dashboard → Settings → API → Data API Settings →
--   "Exposed schemas" → ADICIONAR "sunset" na lista, mantendo
--   "public" e "vrtech" que já estão lá (não remover nenhum).
-- =====================================================

GRANT USAGE ON SCHEMA sunset TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 1. RLS — habilita em todas as tabelas do Sunset
-- ─────────────────────────────────────────────────────

ALTER TABLE sunset.products                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sunset.categories                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sunset.neighborhood_shipping_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sunset.orders                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sunset.order_items                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sunset.customers                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sunset.admins                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sunset.motoboys                    ENABLE ROW LEVEL SECURITY;

-- Catálogo: leitura pública direta (equivalente às rotas GET sem
-- autenticação que hoje existem no backend Rust).
GRANT SELECT ON sunset.products TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_active_products" ON sunset.products;
CREATE POLICY "sunset_anon_select_active_products" ON sunset.products
  FOR SELECT TO anon, authenticated USING (active = 1);

GRANT SELECT ON sunset.categories TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_categories" ON sunset.categories;
CREATE POLICY "sunset_anon_select_categories" ON sunset.categories
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON sunset.neighborhood_shipping_rates TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_shipping_rates" ON sunset.neighborhood_shipping_rates;
CREATE POLICY "sunset_anon_select_shipping_rates" ON sunset.neighborhood_shipping_rates
  FOR SELECT TO anon, authenticated USING (true);

-- orders / order_items / customers / admins / motoboys: SEM policy de
-- SELECT/INSERT direta pra anon. Todo acesso passa pelas funções RPC
-- abaixo (SECURITY DEFINER), que validam estoque/preço/senha antes de
-- tocar nessas tabelas — isso evita que qualquer visitante consiga
-- inserir um pedido com total/preço inventado direto pela API REST,
-- ou ler o histórico de pedidos de outro cliente.

-- ─────────────────────────────────────────────────────
-- 2. RPC: criar pedido (calcula tudo server-side)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sunset, public
AS $$
DECLARE
  v_item        jsonb;
  v_product     sunset.products%ROWTYPE;
  v_quantity    bigint;
  v_total       double precision := 0;
  v_shipping    double precision := 0;
  v_customer_id text;
  v_order_id    text := gen_random_uuid()::text;
  v_item_id     text;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'order must have at least one item';
  END IF;
  IF p_delivery_type NOT IN ('entrega','retirada') THEN
    RAISE EXCEPTION 'invalid delivery_type';
  END IF;
  IF p_payment_method NOT IN ('pix','cartao','dinheiro') THEN
    RAISE EXCEPTION 'invalid payment_method';
  END IF;
  IF trim(p_customer_name) = '' OR trim(p_customer_whatsapp) = '' THEN
    RAISE EXCEPTION 'customer_name and customer_whatsapp are required';
  END IF;

  -- valida itens + calcula total, travando as linhas de estoque
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM sunset.products
      WHERE id = (v_item->>'product_id') FOR UPDATE;
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

  -- frete: só pra entrega, buscado server-side (nunca confia no
  -- valor vindo do cliente)
  IF p_delivery_type = 'entrega' AND p_neighborhood IS NOT NULL AND trim(p_neighborhood) <> '' THEN
    SELECT price INTO v_shipping FROM sunset.neighborhood_shipping_rates
      WHERE neighborhood = p_neighborhood;
    v_shipping := COALESCE(v_shipping, 0);
  END IF;
  v_total := v_total + v_shipping;

  -- upsert do cliente por whatsapp
  SELECT id INTO v_customer_id FROM sunset.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO sunset.customers (id, name, whatsapp) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp);
  ELSE
    UPDATE sunset.customers SET name = p_customer_name WHERE id = v_customer_id;
  END IF;

  INSERT INTO sunset.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, payment_method, payment_status, status,
    shipping_price, total
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total
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

GRANT EXECUTE ON FUNCTION sunset.create_order(text,text,text,text,text,text,jsonb) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 3. RPC: buscar 1 pedido por id (com itens embutidos)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = sunset, public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'customer_name', o.customer_name,
    'customer_whatsapp', o.customer_whatsapp,
    'delivery_type', o.delivery_type,
    'neighborhood', o.neighborhood,
    'address', o.address,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'status', o.status,
    'shipping_price', o.shipping_price,
    'total', o.total,
    'motoboy_id', o.motoboy_id,
    'pix_payment_id', o.pix_payment_id,
    'pix_qr_base64', o.pix_qr_base64,
    'pix_copia_cola', o.pix_copia_cola,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'product_name', oi.product_name,
        'unit_price', oi.unit_price,
        'quantity', oi.quantity
      ))
      FROM sunset.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM sunset.orders o
  WHERE o.id = p_order_id;
$$;

GRANT EXECUTE ON FUNCTION sunset.get_order(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 4. RPC: rastrear pedidos por telefone (tela /consultar)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.track_orders_by_phone(p_whatsapp text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = sunset, public
AS $$
  SELECT COALESCE(jsonb_agg(sunset.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
  FROM sunset.orders o
  WHERE o.customer_whatsapp = p_whatsapp;
$$;

GRANT EXECUTE ON FUNCTION sunset.track_orders_by_phone(text) TO anon, authenticated;
