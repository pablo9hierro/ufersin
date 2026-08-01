-- =====================================================================
-- BOOTSTRAP DO SCHEMA `ufersin` -- clone isolado da evolucao completa do
-- schema `ufersin` (Resolutoo Demo), gerado automaticamente a partir de:
--   1) juite/backend/migrations/000{1,2,3,4}_*.sql (tabelas base, via sqlx)
--   2) ecommerce/supabase/*.sql (71 arquivos rodados a mao no SQL Editor,
--      na ordem cronologica real de autoria -- historico do repo juite,
--      corrigida pra respeitar dependencias declaradas nos proprios
--      comentarios 'Execucao: depois de X' e no schema em si (colunas
--      dropadas/renomeadas) quando 2+ arquivos vieram no mesmo commit),
--      com as versoes ATUAIS do ufersin (que ja incluem os campos
--      cost_price/low_stock_threshold, desconto no PDV etc. desta sessao)
--
-- O schema `ufersin` (producao real da Resolutoo Demo) NAO e tocado por
-- este script -- toda referencia a ele foi substituida por `ufersin`.
--
-- Rode uma unica vez no SQL Editor do projeto Supabase "juite"
-- (zncpcsdpdkvjfknmmhpu). Depois, manualmente:
--   Dashboard -> Project Settings -> Data API -> Settings ->
--   "Exposed schemas" -> adicionar "ufersin" (mantendo public/
--   extensions/vrtech/ufersin como estao, nao remover nenhum).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS ufersin;
SET search_path TO ufersin, public, extensions;

-- ───────────────────────────────────────────────────────────────────
-- [migration] 0001_init.sql
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE motoboys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active BIGINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX idx_customers_whatsapp ON customers(whatsapp);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price DOUBLE PRECISION NOT NULL,
  quantity BIGINT NOT NULL DEFAULT 0,
  image_url TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  active BIGINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_whatsapp TEXT NOT NULL,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('entrega','retirada')),
  neighborhood TEXT,
  address TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix','cartao','dinheiro')),
  payment_status TEXT NOT NULL DEFAULT 'pendente' CHECK (payment_status IN ('pendente','pago')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN (
    'pendente','montando_pedido','pedido_pronto','aguardando_localizacao',
    'em_rota_de_entrega','entregue','retiradas','concluido'
  )),
  shipping_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  total DOUBLE PRECISION NOT NULL,
  motoboy_id TEXT REFERENCES motoboys(id),
  pix_payment_id TEXT,
  pix_qr_base64 TEXT,
  pix_copia_cola TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_whatsapp ON orders(customer_whatsapp);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_price DOUBLE PRECISION NOT NULL,
  quantity BIGINT NOT NULL
);

CREATE TABLE neighborhood_shipping_rates (
  neighborhood TEXT PRIMARY KEY,
  price DOUBLE PRECISION NOT NULL DEFAULT 0
);

-- ───────────────────────────────────────────────────────────────────
-- sunset_public_rls_and_rpc.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — RLS + RPCs para o frontend (Vercel) falar
-- DIRETO com o Supabase via supabase-js, sem passar pelo
-- backend Rust no Railway.
--
-- Execute no SQL Editor do MESMO projeto Supabase que já é
-- compartilhado com o VRTech.
--
-- ISOLAMENTO: tudo abaixo é escopado ao schema `ufersin` — nada
-- aqui cria, altera ou remove qualquer tabela/função/policy dos
-- schemas `vrtech` ou `public`. As tabelas do Sunset já existem
-- (criadas pelo backend Rust via sqlx migrate), este script só
-- adiciona RLS e funções por cima delas.
--
-- IMPORTANTE (fazer manualmente DEPOIS de rodar este SQL):
--   Supabase Dashboard → Settings → API → Data API Settings →
--   "Exposed schemas" → ADICIONAR "ufersin" na lista, mantendo
--   "public" e "vrtech" que já estão lá (não remover nenhum).
-- =====================================================

GRANT USAGE ON SCHEMA ufersin TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 1. RLS — habilita em todas as tabelas do Sunset
-- ─────────────────────────────────────────────────────

ALTER TABLE ufersin.products                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ufersin.categories                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ufersin.neighborhood_shipping_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ufersin.orders                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ufersin.order_items                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE ufersin.customers                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ufersin.admins                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ufersin.motoboys                    ENABLE ROW LEVEL SECURITY;

-- Catálogo: leitura pública direta (equivalente às rotas GET sem
-- autenticação que hoje existem no backend Rust).
GRANT SELECT ON ufersin.products TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_active_products" ON ufersin.products;
CREATE POLICY "sunset_anon_select_active_products" ON ufersin.products
  FOR SELECT TO anon, authenticated USING (active = 1);

GRANT SELECT ON ufersin.categories TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_categories" ON ufersin.categories;
CREATE POLICY "sunset_anon_select_categories" ON ufersin.categories
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON ufersin.neighborhood_shipping_rates TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_shipping_rates" ON ufersin.neighborhood_shipping_rates;
CREATE POLICY "sunset_anon_select_shipping_rates" ON ufersin.neighborhood_shipping_rates
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

CREATE OR REPLACE FUNCTION ufersin.create_order(
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
SET search_path = ufersin, public
AS $$
DECLARE
  v_item        jsonb;
  v_product     ufersin.products%ROWTYPE;
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

    SELECT * INTO v_product FROM ufersin.products
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
    SELECT price INTO v_shipping FROM ufersin.neighborhood_shipping_rates
      WHERE neighborhood = p_neighborhood;
    v_shipping := COALESCE(v_shipping, 0);
  END IF;
  v_total := v_total + v_shipping;

  -- upsert do cliente por whatsapp
  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, payment_method, payment_status, status,
    shipping_price, total
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION ufersin.create_order(text,text,text,text,text,text,jsonb) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 3. RPC: buscar 1 pedido por id (com itens embutidos)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ufersin, public
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
      FROM ufersin.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM ufersin.orders o
  WHERE o.id = p_order_id;
$$;

GRANT EXECUTE ON FUNCTION ufersin.get_order(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 4. RPC: rastrear pedidos por telefone (tela /consultar)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.track_orders_by_phone(p_whatsapp text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
  SELECT COALESCE(jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
  FROM ufersin.orders o
  WHERE o.customer_whatsapp = p_whatsapp;
$$;

GRANT EXECUTE ON FUNCTION ufersin.track_orders_by_phone(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_admin_auth.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — login de admin/motoboy 100% dentro do
-- schema `ufersin`, SEM usar o Supabase Auth (auth.users).
--
-- POR QUÊ NÃO USAR auth.users: ele é compartilhado por TODO o
-- projeto Supabase (o mesmo projeto usado pelo VRTech). Além de
-- um login não ter como "pertencer" a um app só, as policies do
-- VRTech usam `TO authenticated USING (true)` em várias tabelas
-- — ou seja, qualquer login feito ali (inclusive um admin do
-- Sunset) passaria a enxergar dados do VRTech também. Pra não
-- criar esse vazamento entre os dois projetos, o Sunset usa sua
-- própria tabela de sessões dentro do schema `ufersin`, nunca
-- toca no papel "authenticated" do Postgres, e continua 100%
-- isolado — igual products/orders/etc já são.
--
-- Execute no SQL Editor do Supabase, DEPOIS de já ter rodado
-- sunset_public_rls_and_rpc.sql.
-- =====================================================

-- Necessário pra crypt()/gen_salt() (hash de senha) e
-- gen_random_bytes() (token de sessão). Extensão de projeto
-- inteiro, não é específica de nenhum schema — comum em
-- qualquer projeto Supabase, não afeta dados do VRTech.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────
-- 1. Tabela de sessões (token opaco, sem JWT)
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ufersin.sessions (
  token text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('admin', 'motoboy')),
  subject_id text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ufersin.sessions ENABLE ROW LEVEL SECURITY;
-- Sem nenhuma policy pra anon/authenticated de propósito: essa
-- tabela só é lida/escrita pelas funções SECURITY DEFINER abaixo,
-- nunca diretamente pela API REST.

-- Remove duplicatas (ex.: sobras de execuções anteriores desse script),
-- mantendo só a linha mais antiga entre os e-mails de teste conhecidos —
-- evita "duplicate key" no UPDATE logo abaixo, não importa quantas vezes
-- esse arquivo já foi rodado antes.
DELETE FROM ufersin.admins a
  USING ufersin.admins b
  WHERE a.email IN ('admin@resolutoo-demo.com', 'ufersin@gmail.com', 'pablo2@gmail.com')
    AND b.email IN ('admin@resolutoo-demo.com', 'ufersin@gmail.com', 'pablo2@gmail.com')
    AND a.created_at > b.created_at;

-- Re-hash das credenciais seedadas pelo backend Rust em argon2 (que o
-- Postgres não verifica nativamente) pra bcrypt via pgcrypto, e troca o
-- admin de teste pro e-mail/senha reais. WHERE cobre os e-mails antigos e o
-- novo pra esse UPDATE poder ser re-executado sem erro.
UPDATE ufersin.admins SET email = 'pablo2@gmail.com', password_hash = crypt('123456', gen_salt('bf'))
  WHERE email IN ('admin@resolutoo-demo.com', 'ufersin@gmail.com', 'pablo2@gmail.com');
UPDATE ufersin.motoboys SET password_hash = crypt('motoboy123', gen_salt('bf'))
  WHERE email = 'motoboy@resolutoo-demo.com';

-- ─────────────────────────────────────────────────────
-- 2. Login
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_login(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public, extensions
AS $$
DECLARE
  v_admin ufersin.admins%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_admin FROM ufersin.admins WHERE email = p_email;
  IF NOT FOUND OR v_admin.password_hash <> crypt(p_password, v_admin.password_hash) THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO ufersin.sessions (token, role, subject_id) VALUES (v_token, 'admin', v_admin.id);

  RETURN jsonb_build_object('token', v_token, 'name', v_admin.name);
END;
$$;

GRANT EXECUTE ON FUNCTION ufersin.admin_login(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.motoboy_login(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public, extensions
AS $$
DECLARE
  v_m ufersin.motoboys%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_m FROM ufersin.motoboys WHERE email = p_email;
  IF NOT FOUND OR v_m.active = 0 OR v_m.password_hash <> crypt(p_password, v_m.password_hash) THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO ufersin.sessions (token, role, subject_id) VALUES (v_token, 'motoboy', v_m.id);

  RETURN jsonb_build_object('token', v_token, 'name', v_m.name);
END;
$$;

GRANT EXECUTE ON FUNCTION ufersin.motoboy_login(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.logout(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ufersin, public, extensions
AS $$
  DELETE FROM ufersin.sessions WHERE token = p_token;
$$;

GRANT EXECUTE ON FUNCTION ufersin.logout(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 3. Helpers internos (usados pelas próximas RPCs de CRUD do
--    admin/motoboy — não chamados direto pelo frontend)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._require_admin(p_token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public, extensions
AS $$
DECLARE
  v_subject text;
BEGIN
  SELECT subject_id INTO v_subject FROM ufersin.sessions
    WHERE token = p_token AND role = 'admin' AND expires_at > now();
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN v_subject;
END;
$$;

CREATE OR REPLACE FUNCTION ufersin._require_motoboy(p_token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public, extensions
AS $$
DECLARE
  v_subject text;
BEGIN
  SELECT subject_id INTO v_subject FROM ufersin.sessions
    WHERE token = p_token AND role = 'motoboy' AND expires_at > now();
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN v_subject;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 4. Trocar a própria senha (painel admin → /admin/senha).
--    O token já prova que é o admin logado, não pede senha atual
--    de novo — é só um usuário admin único, sem e-mail trocável
--    por aqui (fixo no seed).
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_set_password(p_token text, p_new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public, extensions
AS $$
DECLARE
  v_admin_id text := ufersin._require_admin(p_token);
BEGIN
  IF length(trim(p_new_password)) < 6 THEN
    RAISE EXCEPTION 'new password must be at least 6 characters';
  END IF;
  UPDATE ufersin.admins SET password_hash = crypt(p_new_password, gen_salt('bf')) WHERE id = v_admin_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ufersin.admin_set_password(text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_admin_crud.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — CRUD do painel admin e fila do motoboy,
-- tudo via RPC (SECURITY DEFINER) escopado ao schema `ufersin`,
-- usando o mesmo token de ufersin.sessions (ver
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

CREATE OR REPLACE FUNCTION ufersin.admin_list_categories(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name) FROM ufersin.categories),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_categories(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_create_category(p_token text, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  BEGIN
    INSERT INTO ufersin.categories (id, name) VALUES (v_id, p_name);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'category name already exists';
  END;
  RETURN jsonb_build_object('id', v_id, 'name', p_name);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_category(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_category(p_token text, p_id text, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  UPDATE ufersin.categories SET name = p_name WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category not found';
  END IF;
  RETURN jsonb_build_object('id', p_id, 'name', p_name);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_category(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_delete_category(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  DELETE FROM ufersin.categories WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_category(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 2. Produtos
-- ─────────────────────────────────────────────────────

-- Custo de aquisição (pra calcular estoque valorizado a custo + markup)
-- e ponto de reposição (quantidade em estoque que, ao ser atingida,
-- coloca o produto na lista "precisa repor" do /admin/produtos). Ambas
-- opcionais -- produto sem esses dados preenchidos simplesmente não
-- entra nos totais/nunca aparece como "precisa repor".
ALTER TABLE ufersin.products ADD COLUMN IF NOT EXISTS cost_price double precision;
ALTER TABLE ufersin.products ADD COLUMN IF NOT EXISTS low_stock_threshold bigint;

CREATE OR REPLACE FUNCTION ufersin._product_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price,
    'quantity', p.quantity, 'image_url', p.image_url, 'category_id', p.category_id,
    'category_name', c.name, 'active', (p.active <> 0),
    'cost_price', p.cost_price, 'low_stock_threshold', p.low_stock_threshold
  )
  FROM ufersin.products p
  LEFT JOIN ufersin.categories c ON c.id = p.category_id
  WHERE p.id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_list_products(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(ufersin._product_json(p.id) ORDER BY p.name) FROM ufersin.products p),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_products(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_get_product(p_token text, p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  v_result := ufersin._product_json(p_id);
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'product not found';
  END IF;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_get_product(text, text) TO anon, authenticated;

-- DROP explícito da assinatura antiga antes do CREATE OR REPLACE --
-- adicionar parâmetros no fim faria o Postgres tratar como uma NOVA
-- função sobrecarregada (overload) em vez de substituir a antiga, o
-- que deixaria as duas coexistindo e o PostgREST sem saber qual RPC
-- escolher.
DROP FUNCTION IF EXISTS ufersin.admin_create_product(text, text, text, double precision, bigint, text, text, boolean);
CREATE OR REPLACE FUNCTION ufersin.admin_create_product(
  p_token text, p_name text, p_description text, p_price double precision,
  p_quantity bigint, p_image_url text, p_category_id text, p_active boolean DEFAULT true,
  p_cost_price double precision DEFAULT NULL, p_low_stock_threshold bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  INSERT INTO ufersin.products (id, name, description, price, quantity, image_url, category_id, active, cost_price, low_stock_threshold)
    VALUES (v_id, p_name, p_description, p_price, p_quantity, p_image_url, p_category_id,
      CASE WHEN p_active THEN 1 ELSE 0 END, p_cost_price, p_low_stock_threshold);
  RETURN ufersin._product_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_product(text, text, text, double precision, bigint, text, text, boolean, double precision, bigint) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_product(text, text, text, text, double precision, bigint, text, text, boolean);
CREATE OR REPLACE FUNCTION ufersin.admin_update_product(
  p_token text, p_id text, p_name text, p_description text, p_price double precision,
  p_quantity bigint, p_image_url text, p_category_id text, p_active boolean DEFAULT true,
  p_cost_price double precision DEFAULT NULL, p_low_stock_threshold bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  UPDATE ufersin.products SET
    name = p_name, description = p_description, price = p_price, quantity = p_quantity,
    image_url = p_image_url, category_id = p_category_id, active = CASE WHEN p_active THEN 1 ELSE 0 END,
    cost_price = p_cost_price, low_stock_threshold = p_low_stock_threshold
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found';
  END IF;
  RETURN ufersin._product_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_product(text, text, text, text, double precision, bigint, text, text, boolean, double precision, bigint) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_delete_product(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  DELETE FROM ufersin.products WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_product(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 3. Motoboys
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._motoboy_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
  SELECT jsonb_build_object('id', id, 'name', name, 'phone', phone, 'email', email, 'active', (active <> 0))
  FROM ufersin.motoboys WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_list_motoboys(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(ufersin._motoboy_json(id) ORDER BY name) FROM ufersin.motoboys),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_motoboys(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_create_motoboy(p_token text, p_name text, p_phone text, p_email text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_password IS NULL OR trim(p_password) = '' THEN
    RAISE EXCEPTION 'password is required to create a motoboy';
  END IF;
  BEGIN
    INSERT INTO ufersin.motoboys (id, name, phone, email, password_hash, active)
      VALUES (v_id, p_name, p_phone, p_email, crypt(p_password, gen_salt('bf')), 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN ufersin._motoboy_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_motoboy(text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_motoboy(
  p_token text, p_id text, p_name text, p_phone text, p_email text,
  p_password text DEFAULT NULL, p_active boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE ufersin.motoboys SET
      name = p_name, phone = p_phone, email = p_email,
      password_hash = crypt(p_password, gen_salt('bf')), active = CASE WHEN p_active THEN 1 ELSE 0 END
    WHERE id = p_id;
  ELSE
    UPDATE ufersin.motoboys SET
      name = p_name, phone = p_phone, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
  RETURN ufersin._motoboy_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_motoboy(text, text, text, text, text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_delete_motoboy(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  DELETE FROM ufersin.motoboys WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_motoboy(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 4. Fluxo de status (portado de backend/src/status_flow.rs)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._confirm_payment_if_needed(p_payment_method text, p_payment_status text, p_payment_confirmed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
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

CREATE OR REPLACE FUNCTION ufersin._admin_apply_transition(
  p_current_status text, p_target_status text, p_delivery_type text,
  p_payment_method text, p_payment_status text, p_payment_confirmed boolean
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
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
    RETURN ufersin._confirm_payment_if_needed(p_payment_method, p_payment_status, p_payment_confirmed);
  ELSE
    RAISE EXCEPTION 'invalid status transition: % -> %', p_current_status, p_target_status;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ufersin._motoboy_apply_transition(
  p_current_status text, p_target_status text,
  p_payment_method text, p_payment_status text, p_payment_confirmed boolean
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  IF p_current_status = 'aguardando_localizacao' AND p_target_status = 'em_rota_de_entrega' THEN
    RETURN false;
  ELSIF p_current_status = 'em_rota_de_entrega' AND p_target_status = 'entregue' THEN
    RETURN ufersin._confirm_payment_if_needed(p_payment_method, p_payment_status, p_payment_confirmed);
  ELSIF p_current_status = 'entregue' AND p_target_status = 'concluido' THEN
    IF p_payment_status = 'pago' THEN
      RETURN false;
    ELSE
      RETURN ufersin._confirm_payment_if_needed(p_payment_method, p_payment_status, p_payment_confirmed);
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid status transition: % -> %', p_current_status, p_target_status;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 5. Pedidos (admin)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_list_orders(p_token text, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at DESC)
     FROM ufersin.orders o
     WHERE p_status IS NULL OR o.status = p_status),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_orders(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_order_status(p_token text, p_order_id text, p_status text, p_payment_confirmed boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_order ufersin.orders%ROWTYPE;
  v_set_paid boolean;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_order FROM ufersin.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_set_paid := ufersin._admin_apply_transition(
    v_order.status, p_status, v_order.delivery_type, v_order.payment_method, v_order.payment_status, p_payment_confirmed
  );

  IF v_set_paid THEN
    UPDATE ufersin.orders SET status = p_status, payment_status = 'pago', updated_at = now()::text WHERE id = p_order_id;
  ELSE
    UPDATE ufersin.orders SET status = p_status, updated_at = now()::text WHERE id = p_order_id;
  END IF;

  RETURN ufersin.get_order(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_order_status(text, text, text, boolean) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 6. Frete
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_list_shipping_rates(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(jsonb_build_object('neighborhood', neighborhood, 'price', price) ORDER BY neighborhood)
     FROM ufersin.neighborhood_shipping_rates),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_shipping_rates(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_shipping_rate(p_token text, p_neighborhood text, p_price double precision)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  INSERT INTO ufersin.neighborhood_shipping_rates (neighborhood, price) VALUES (p_neighborhood, p_price)
    ON CONFLICT (neighborhood) DO UPDATE SET price = EXCLUDED.price;
  RETURN jsonb_build_object('neighborhood', p_neighborhood, 'price', p_price);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_shipping_rate(text, text, double precision) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 7. Financeiro
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_total_revenue double precision;
  v_total_orders bigint;
  v_status_counts jsonb;
  v_top_products jsonb;
  v_recent_orders jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);

  SELECT COALESCE(SUM(total), 0) INTO v_total_revenue FROM ufersin.orders WHERE payment_status = 'pago';
  SELECT COUNT(*) INTO v_total_orders FROM ufersin.orders;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', cnt)), '[]'::jsonb)
    INTO v_status_counts
    FROM (SELECT status, COUNT(*) AS cnt FROM ufersin.orders GROUP BY status) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'product_name', product_name,
      'quantity_sold', qty, 'revenue', rev
    ) ORDER BY qty DESC), '[]'::jsonb)
    INTO v_top_products
    FROM (
      SELECT oi.product_id, oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.unit_price * oi.quantity) AS rev
      FROM ufersin.order_items oi JOIN ufersin.orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'pago'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY qty DESC LIMIT 10
    ) t;

  SELECT COALESCE(jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_recent_orders
    FROM (SELECT id, created_at FROM ufersin.orders ORDER BY created_at DESC LIMIT 20) o;

  RETURN jsonb_build_object(
    'total_revenue', v_total_revenue,
    'total_orders', v_total_orders,
    'orders_by_status', v_status_counts,
    'top_products', v_top_products,
    'recent_orders', v_recent_orders
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_financeiro(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 8. Fila do motoboy
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.motoboy_list_orders(p_token text, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
BEGIN
  IF p_status NOT IN ('pedido_pronto', 'aguardando_localizacao', 'em_rota_de_entrega', 'concluido') THEN
    RAISE EXCEPTION 'invalid status filter';
  END IF;

  IF p_status = 'pedido_pronto' THEN
    RETURN COALESCE(
      (SELECT jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at ASC)
       FROM ufersin.orders o
       WHERE o.delivery_type = 'entrega' AND o.status = 'pedido_pronto' AND o.motoboy_id IS NULL),
      '[]'::jsonb
    );
  ELSIF p_status = 'em_rota_de_entrega' THEN
    RETURN COALESCE(
      (SELECT jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at DESC)
       FROM ufersin.orders o
       WHERE o.delivery_type = 'entrega' AND o.status IN ('em_rota_de_entrega', 'entregue') AND o.motoboy_id = v_motoboy_id),
      '[]'::jsonb
    );
  ELSE
    RETURN COALESCE(
      (SELECT jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at DESC)
       FROM ufersin.orders o
       WHERE o.delivery_type = 'entrega' AND o.status = p_status AND o.motoboy_id = v_motoboy_id),
      '[]'::jsonb
    );
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.motoboy_list_orders(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.motoboy_request_location(p_token text, p_order_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
  v_order_id text;
  v_order ufersin.orders%ROWTYPE;
  v_updated jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    SELECT * INTO v_order FROM ufersin.orders WHERE id = v_order_id;

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

    UPDATE ufersin.orders SET motoboy_id = v_motoboy_id, status = 'aguardando_localizacao', updated_at = now()::text
      WHERE id = v_order_id;
    v_updated := v_updated || ufersin.get_order(v_order_id);
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.motoboy_request_location(text, text[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.motoboy_update_order_status(p_token text, p_order_id text, p_status text, p_payment_confirmed boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
  v_order ufersin.orders%ROWTYPE;
  v_set_paid boolean;
BEGIN
  SELECT * INTO v_order FROM ufersin.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;
  IF v_order.motoboy_id IS DISTINCT FROM v_motoboy_id THEN
    RAISE EXCEPTION 'order is not assigned to you';
  END IF;

  v_set_paid := ufersin._motoboy_apply_transition(
    v_order.status, p_status, v_order.payment_method, v_order.payment_status, p_payment_confirmed
  );

  IF v_set_paid THEN
    UPDATE ufersin.orders SET status = p_status, payment_status = 'pago', updated_at = now()::text WHERE id = p_order_id;
  ELSE
    UPDATE ufersin.orders SET status = p_status, updated_at = now()::text WHERE id = p_order_id;
  END IF;

  RETURN ufersin.get_order(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.motoboy_update_order_status(text, text, text, boolean) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_motoboy_financeiro.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — comissão do motoboy (whatsapp + porcentagem no
-- cadastro) e telas de financeiro (admin e motoboy).
--
-- Ganho do motoboy por entrega = shipping_price (frete) * commission_percent / 100
-- (usa o frete, não o total do pedido — o motoboy não deveria ganhar
-- comissão em cima do preço dos produtos, só do frete que ele carrega).
--
-- Execute no SQL Editor DEPOIS de sunset_admin_crud.sql.
-- =====================================================

ALTER TABLE ufersin.motoboys ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE ufersin.motoboys ADD COLUMN IF NOT EXISTS commission_percent double precision NOT NULL DEFAULT 0;

-- Precisa trocar a assinatura (parâmetros novos) — CREATE OR REPLACE não
-- troca lista de parâmetros, só sobrescreve se for idêntica, então dropa
-- as versões antigas primeiro pra não ficar com as duas coexistindo.
DROP FUNCTION IF EXISTS ufersin._motoboy_json(text);
DROP FUNCTION IF EXISTS ufersin.admin_create_motoboy(text, text, text, text, text);
DROP FUNCTION IF EXISTS ufersin.admin_update_motoboy(text, text, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION ufersin._motoboy_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'phone', phone, 'email', email, 'whatsapp', whatsapp,
    'commission_percent', commission_percent, 'active', (active <> 0)
  )
  FROM ufersin.motoboys WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_create_motoboy(
  p_token text, p_name text, p_phone text, p_email text, p_password text,
  p_whatsapp text DEFAULT NULL, p_commission_percent double precision DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_password IS NULL OR trim(p_password) = '' THEN
    RAISE EXCEPTION 'password is required to create a motoboy';
  END IF;
  BEGIN
    INSERT INTO ufersin.motoboys (id, name, phone, email, password_hash, whatsapp, commission_percent, active)
      VALUES (v_id, p_name, p_phone, p_email, crypt(p_password, gen_salt('bf')), p_whatsapp, p_commission_percent, 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN ufersin._motoboy_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_motoboy(text, text, text, text, text, text, double precision) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_motoboy(
  p_token text, p_id text, p_name text, p_phone text, p_email text,
  p_password text DEFAULT NULL, p_active boolean DEFAULT true,
  p_whatsapp text DEFAULT NULL, p_commission_percent double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE ufersin.motoboys SET
      name = p_name, phone = p_phone, email = p_email,
      password_hash = crypt(p_password, gen_salt('bf')), active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp),
      commission_percent = COALESCE(p_commission_percent, commission_percent)
    WHERE id = p_id;
  ELSE
    UPDATE ufersin.motoboys SET
      name = p_name, phone = p_phone, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp),
      commission_percent = COALESCE(p_commission_percent, commission_percent)
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
  RETURN ufersin._motoboy_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_motoboy(text, text, text, text, text, text, boolean, text, double precision) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Financeiro do motoboy (própria fila)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.motoboy_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
  v_commission double precision;
  v_deliveries jsonb;
  v_total_shipping double precision;
BEGIN
  SELECT commission_percent INTO v_commission FROM ufersin.motoboys WHERE id = v_motoboy_id;

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
  FROM ufersin.orders o
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
GRANT EXECUTE ON FUNCTION ufersin.motoboy_financeiro(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Financeiro do admin — adiciona a seção "motoboys" (mesma
-- assinatura de antes, então CREATE OR REPLACE substitui direto)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_total_revenue double precision;
  v_total_orders bigint;
  v_status_counts jsonb;
  v_top_products jsonb;
  v_recent_orders jsonb;
  v_motoboys jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);

  SELECT COALESCE(SUM(total), 0) INTO v_total_revenue FROM ufersin.orders WHERE payment_status = 'pago';
  SELECT COUNT(*) INTO v_total_orders FROM ufersin.orders;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', cnt)), '[]'::jsonb)
    INTO v_status_counts
    FROM (SELECT status, COUNT(*) AS cnt FROM ufersin.orders GROUP BY status) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'product_name', product_name,
      'quantity_sold', qty, 'revenue', rev
    ) ORDER BY qty DESC), '[]'::jsonb)
    INTO v_top_products
    FROM (
      SELECT oi.product_id, oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.unit_price * oi.quantity) AS rev
      FROM ufersin.order_items oi JOIN ufersin.orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'pago'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY qty DESC LIMIT 10
    ) t;

  SELECT COALESCE(jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_recent_orders
    FROM (SELECT id, created_at FROM ufersin.orders ORDER BY created_at DESC LIMIT 20) o;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'commission_percent', m.commission_percent,
      'total_deliveries', d.cnt, 'total_shipping', d.total_shipping,
      'total_earnings', round((d.total_shipping * m.commission_percent / 100)::numeric, 2)
    ) ORDER BY m.name), '[]'::jsonb)
    INTO v_motoboys
    FROM ufersin.motoboys m
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(o.shipping_price), 0) AS total_shipping
      FROM ufersin.orders o
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
GRANT EXECUTE ON FUNCTION ufersin.admin_financeiro(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- [migration] 0002_order_geolocation.sql
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN customer_lat DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN customer_lng DOUBLE PRECISION;

-- ───────────────────────────────────────────────────────────────────
-- sunset_order_geolocation.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — expõe customer_lat/customer_lng (capturados via
-- webhook da Evolution API quando o cliente compartilha localização
-- no WhatsApp) no retorno de ufersin.get_order — usado por toda
-- consulta de pedido (admin, motoboy, financeiro), então essa
-- única troca já propaga os campos novos pra tudo.
--
-- IMPORTANTE: rode isso DEPOIS que o backend Rust no Railway já
-- tiver redeployado com a migration 0002_order_geolocation.sql
-- (cria as colunas customer_lat/customer_lng em ufersin.orders — o
-- Rust roda essa migration sozinho no boot). Se rodar este arquivo
-- antes disso, vai dar erro "column does not exist".
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ufersin, public
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
    'customer_lat', o.customer_lat,
    'customer_lng', o.customer_lng,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'product_name', oi.product_name,
        'unit_price', oi.unit_price,
        'quantity', oi.quantity
      ))
      FROM ufersin.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM ufersin.orders o
  WHERE o.id = p_order_id;
$$;

GRANT EXECUTE ON FUNCTION ufersin.get_order(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_products_storage.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — bucket de imagens de produto.
--
-- O upload em si passa pelo backend Rust (usa a service_role key,
-- que ignora RLS) — só precisa dessa policy pra leitura pública
-- funcionar (o <img src=...> do navegador do cliente/admin).
-- =====================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('ufersin-products', 'ufersin-products', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "sunset_public_read_products" ON storage.objects;
CREATE POLICY "sunset_public_read_products" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'ufersin-products');

-- ───────────────────────────────────────────────────────────────────
-- sunset_motoboy_counts.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — contagem de pedidos por status pro motoboy (mostra
-- o número em cada aba da fila, tipo "Pedido pronto (3)"). Espelha
-- exatamente os mesmos WHERE de ufersin.motoboy_list_orders, só que
-- devolve COUNT em vez da lista inteira — mais leve, principalmente
-- pra "concluído" que só cresce com o tempo.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.motoboy_order_counts(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
BEGIN
  RETURN jsonb_build_object(
    'pedido_pronto', (
      SELECT COUNT(*) FROM ufersin.orders
      WHERE delivery_type = 'entrega' AND status = 'pedido_pronto' AND motoboy_id IS NULL
    ),
    'aguardando_localizacao', (
      SELECT COUNT(*) FROM ufersin.orders
      WHERE delivery_type = 'entrega' AND status = 'aguardando_localizacao' AND motoboy_id = v_motoboy_id
    ),
    'em_rota_de_entrega', (
      SELECT COUNT(*) FROM ufersin.orders
      WHERE delivery_type = 'entrega' AND status IN ('em_rota_de_entrega', 'entregue') AND motoboy_id = v_motoboy_id
    ),
    'concluido', (
      SELECT COUNT(*) FROM ufersin.orders
      WHERE delivery_type = 'entrega' AND status = 'concluido' AND motoboy_id = v_motoboy_id
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION ufersin.motoboy_order_counts(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- [migration] 0003_drop_neighborhood_shipping_rates.sql
-- ───────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS neighborhood_shipping_rates;

-- ───────────────────────────────────────────────────────────────────
-- sunset_shipping_by_distance.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — frete calculado por DISTÂNCIA real (loja → cliente)
-- em vez de tabela fixa por bairro. Substitui inteiramente
-- neighborhood_shipping_rates.
--
-- store_lat/store_lng são um ponto de referência dentro do bairro
-- José Américo de Almeida (o endereço exato da loja não está
-- mapeado no OpenStreetMap) — dá pra corrigir depois rodando um
-- UPDATE manual em ufersin.shipping_settings se você tiver a
-- coordenada exata (ex.: soltando o pino no Google Maps e copiando
-- lat/lng).
--
-- Execute DEPOIS que o backend Rust já tiver rodado a migration
-- 0003_drop_neighborhood_shipping_rates.sql (senão o DROP abaixo já
-- resolve isso também, tanto faz a ordem dessa vez).
-- =====================================================

DROP TABLE IF EXISTS ufersin.neighborhood_shipping_rates CASCADE;
DROP FUNCTION IF EXISTS ufersin.admin_list_shipping_rates(text);
DROP FUNCTION IF EXISTS ufersin.admin_update_shipping_rate(text, text, double precision);

CREATE TABLE IF NOT EXISTS ufersin.shipping_settings (
  id int PRIMARY KEY DEFAULT 1,
  price_per_km double precision NOT NULL DEFAULT 1.5,
  store_lat double precision NOT NULL,
  store_lng double precision NOT NULL,
  CHECK (id = 1)
);

INSERT INTO ufersin.shipping_settings (id, price_per_km, store_lat, store_lng)
VALUES (1, 1.5, -7.1746, -34.8576)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE ufersin.shipping_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON ufersin.shipping_settings TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_shipping_settings" ON ufersin.shipping_settings;
CREATE POLICY "sunset_anon_select_shipping_settings" ON ufersin.shipping_settings
  FOR SELECT TO anon, authenticated USING (true);

-- Distância em linha reta (Haversine), em km. IMMUTABLE = calculável sem
-- tocar o banco, só matemática — mesma fórmula usada no frontend
-- (frontend/src/lib/geo/rotas.ts) pra estimativa ao vivo no checkout.
CREATE OR REPLACE FUNCTION ufersin._distance_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  ));
$$;

-- Estimativa pública (sem token) — o checkout chama isso enquanto o
-- cliente ajusta o pino, pra mostrar o valor do frete antes de confirmar
-- o pedido. O valor final de verdade é recalculado de novo dentro de
-- create_order (nunca confia no que o cliente mandou).
CREATE OR REPLACE FUNCTION ufersin.estimate_shipping(p_lat double precision, p_lng double precision)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_settings ufersin.shipping_settings%ROWTYPE;
  v_km double precision;
BEGIN
  SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
  v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_lat, p_lng);
  RETURN jsonb_build_object(
    'km', round(v_km::numeric, 2),
    'price', round((v_km * v_settings.price_per_km)::numeric, 2)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.estimate_shipping(double precision, double precision) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_shipping_settings(p_token text, p_price_per_km double precision)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_price_per_km IS NULL OR p_price_per_km < 0 THEN
    RAISE EXCEPTION 'price_per_km must be a non-negative number';
  END IF;
  UPDATE ufersin.shipping_settings SET price_per_km = p_price_per_km WHERE id = 1;
  RETURN jsonb_build_object('price_per_km', p_price_per_km);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_shipping_settings(text, double precision) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- create_order — troca o lookup por bairro pelo cálculo por distância.
-- Precisa dropar a assinatura antiga (7 parâmetros) já que a nova tem 2 a
-- mais (lat/lng do cliente) — CREATE OR REPLACE não troca lista de
-- parâmetros, só sobrescreve se for idêntica.
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin.create_order(text, text, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
DECLARE
  v_item        jsonb;
  v_product     ufersin.products%ROWTYPE;
  v_quantity    bigint;
  v_total       double precision := 0;
  v_shipping    double precision := 0;
  v_customer_id text;
  v_order_id    text := gen_random_uuid()::text;
  v_item_id     text;
  v_settings    ufersin.shipping_settings%ROWTYPE;
  v_km          double precision;
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  -- valida itens + calcula total, travando as linhas de estoque
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

  -- frete: só pra entrega, calculado por distância real (nunca confia no
  -- valor vindo do cliente, só nas coordenadas — o preço é recalculado
  -- aqui do zero)
  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;
  v_total := v_total + v_shipping;

  -- upsert do cliente por whatsapp
  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION ufersin.create_order(text,text,text,text,text,text,jsonb,double precision,double precision) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- [migration] 0004_order_reference_point.sql
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN reference_point TEXT;

-- ───────────────────────────────────────────────────────────────────
-- sunset_order_reference_point.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — adiciona "ponto de referência" (número da casa,
-- condomínio, observações de entrega) ao pedido. Complementa
-- customer_lat/customer_lng: a coordenada localiza o endereço no mapa,
-- o ponto de referência é o texto livre que o motoboy lê pra achar a
-- porta certa.
--
-- IMPORTANTE: rode isso DEPOIS que o backend Rust no Railway já tiver
-- redeployado com a migration 0004_order_reference_point.sql (cria a
-- coluna reference_point em ufersin.orders). Se rodar antes, vai dar
-- erro "column does not exist".
-- =====================================================

-- get_order alimenta admin_list_orders, motoboy_list_orders e
-- track_orders_by_phone (todos chamam essa função por pedido) — uma
-- única troca aqui já propaga o campo novo pra tudo.
CREATE OR REPLACE FUNCTION ufersin.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'customer_name', o.customer_name,
    'customer_whatsapp', o.customer_whatsapp,
    'delivery_type', o.delivery_type,
    'neighborhood', o.neighborhood,
    'address', o.address,
    'reference_point', o.reference_point,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'status', o.status,
    'shipping_price', o.shipping_price,
    'total', o.total,
    'motoboy_id', o.motoboy_id,
    'pix_payment_id', o.pix_payment_id,
    'pix_qr_base64', o.pix_qr_base64,
    'pix_copia_cola', o.pix_copia_cola,
    'customer_lat', o.customer_lat,
    'customer_lng', o.customer_lng,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'product_name', oi.product_name,
        'unit_price', oi.unit_price,
        'quantity', oi.quantity
      ))
      FROM ufersin.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM ufersin.orders o
  WHERE o.id = p_order_id;
$$;

GRANT EXECUTE ON FUNCTION ufersin.get_order(text) TO anon, authenticated;

-- create_order — troca a assinatura de 9 pra 10 parâmetros (novo
-- p_reference_point no fim) — precisa dropar a antiga primeiro.
DROP FUNCTION IF EXISTS ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision);

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
DECLARE
  v_item        jsonb;
  v_product     ufersin.products%ROWTYPE;
  v_quantity    bigint;
  v_total       double precision := 0;
  v_shipping    double precision := 0;
  v_customer_id text;
  v_order_id    text := gen_random_uuid()::text;
  v_item_id     text;
  v_settings    ufersin.shipping_settings%ROWTYPE;
  v_km          double precision;
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  -- valida itens + calcula total, travando as linhas de estoque
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

  -- frete: só pra entrega, calculado por distância real (nunca confia no
  -- valor vindo do cliente, só nas coordenadas — o preço é recalculado
  -- aqui do zero)
  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;
  v_total := v_total + v_shipping;

  -- upsert do cliente por whatsapp
  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION ufersin.create_order(text,text,text,text,text,text,jsonb,double precision,double precision,text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_motoboy_payout.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — motoboy fica com 100% do frete (fim da comissão em %)
-- + baixa de pagamento pelo admin (dinheiro/Pix), com histórico.
--
-- 100% do shipping_price de cada entrega concluída é do motoboy. O que
-- muda é só CONTROLE DE REPASSE: motoboy_paid_at marca quando aquele
-- frete já foi entregue em mãos ao motoboy; motoboy_settlements guarda
-- o histórico de cada "acerto" (pode agrupar várias entregas de uma vez).
--
-- Não depende de nenhuma migration do Rust — pode rodar isso direto.
-- =====================================================

ALTER TABLE ufersin.orders ADD COLUMN IF NOT EXISTS motoboy_paid_at timestamptz;

CREATE TABLE IF NOT EXISTS ufersin.motoboy_settlements (
  id text PRIMARY KEY,
  motoboy_id text NOT NULL REFERENCES ufersin.motoboys(id) ON DELETE CASCADE,
  amount double precision NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('dinheiro','pix')),
  order_ids text[] NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ufersin.motoboy_settlements ENABLE ROW LEVEL SECURITY;
-- Sem policies de propósito — só acessível via RPC SECURITY DEFINER,
-- mesmo padrão de ufersin.orders/ufersin.motoboys.

ALTER TABLE ufersin.motoboys DROP COLUMN IF EXISTS commission_percent;

-- ─────────────────────────────────────────────────────
-- CRUD de motoboy sem commission_percent — precisa trocar assinatura.
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin._motoboy_json(text);
DROP FUNCTION IF EXISTS ufersin.admin_create_motoboy(text, text, text, text, text, text, double precision);
DROP FUNCTION IF EXISTS ufersin.admin_update_motoboy(text, text, text, text, text, text, boolean, text, double precision);

CREATE OR REPLACE FUNCTION ufersin._motoboy_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'phone', phone, 'email', email, 'whatsapp', whatsapp,
    'active', (active <> 0)
  )
  FROM ufersin.motoboys WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_create_motoboy(
  p_token text, p_name text, p_phone text, p_email text, p_password text,
  p_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_password IS NULL OR trim(p_password) = '' THEN
    RAISE EXCEPTION 'password is required to create a motoboy';
  END IF;
  BEGIN
    INSERT INTO ufersin.motoboys (id, name, phone, email, password_hash, whatsapp, active)
      VALUES (v_id, p_name, p_phone, p_email, crypt(p_password, gen_salt('bf')), p_whatsapp, 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN ufersin._motoboy_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_motoboy(text, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_motoboy(
  p_token text, p_id text, p_name text, p_phone text, p_email text,
  p_password text DEFAULT NULL, p_active boolean DEFAULT true,
  p_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE ufersin.motoboys SET
      name = p_name, phone = p_phone, email = p_email,
      password_hash = crypt(p_password, gen_salt('bf')), active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp)
    WHERE id = p_id;
  ELSE
    UPDATE ufersin.motoboys SET
      name = p_name, phone = p_phone, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp)
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
  RETURN ufersin._motoboy_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_motoboy(text, text, text, text, text, text, boolean, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Quanto cada motoboy tem a receber agora (entregas concluídas, ainda
-- não repassadas) — usado tanto pelo popup "Pagar" do admin quanto,
-- indiretamente, pelo financeiro de cada um.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._motoboy_pending(p_motoboy_id text)
RETURNS TABLE(order_ids text[], amount double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT COALESCE(array_agg(id), ARRAY[]::text[]), COALESCE(SUM(shipping_price), 0)
  FROM ufersin.orders
  WHERE motoboy_id = p_motoboy_id AND status = 'concluido' AND delivery_type = 'entrega'
    AND motoboy_paid_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_motoboy_pending(p_token text, p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_pending RECORD;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_pending FROM ufersin._motoboy_pending(p_id);
  RETURN jsonb_build_object(
    'pending_amount', v_pending.amount,
    'pending_deliveries', array_length(v_pending.order_ids, 1)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_motoboy_pending(text, text) TO anon, authenticated;

-- Dá baixa: marca as entregas pendentes como pagas e registra o acerto.
-- Idempotente contra duplo-clique: se não há nada pendente, dá erro em
-- vez de criar um settlement de R$0.
CREATE OR REPLACE FUNCTION ufersin.admin_pay_motoboy(p_token text, p_motoboy_id text, p_payment_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_pending RECORD;
  v_settlement_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_payment_method NOT IN ('dinheiro','pix') THEN
    RAISE EXCEPTION 'invalid payment_method';
  END IF;

  SELECT * INTO v_pending FROM ufersin._motoboy_pending(p_motoboy_id);
  IF v_pending.amount IS NULL OR v_pending.amount <= 0 THEN
    RAISE EXCEPTION 'motoboy has nothing pending to pay';
  END IF;

  UPDATE ufersin.orders SET motoboy_paid_at = now() WHERE id = ANY(v_pending.order_ids);

  INSERT INTO ufersin.motoboy_settlements (id, motoboy_id, amount, payment_method, order_ids)
    VALUES (v_settlement_id, p_motoboy_id, v_pending.amount, p_payment_method, v_pending.order_ids);

  RETURN jsonb_build_object(
    'id', v_settlement_id, 'amount', v_pending.amount, 'payment_method', p_payment_method
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_pay_motoboy(text, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Financeiro do motoboy (própria fila) — 100% do frete, sem comissão.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.motoboy_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
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
  FROM ufersin.orders o
  WHERE o.motoboy_id = v_motoboy_id AND o.status = 'concluido' AND o.delivery_type = 'entrega';

  SELECT * INTO v_pending FROM ufersin._motoboy_pending(v_motoboy_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM ufersin.motoboy_settlements WHERE motoboy_id = v_motoboy_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'amount', amount, 'payment_method', payment_method, 'paid_at', paid_at
    ) ORDER BY paid_at DESC), '[]'::jsonb)
    INTO v_settlements
    FROM ufersin.motoboy_settlements WHERE motoboy_id = v_motoboy_id;

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
GRANT EXECUTE ON FUNCTION ufersin.motoboy_financeiro(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Financeiro do admin — troca comissão/total_earnings por
-- pending_amount/total_paid por motoboy.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_total_revenue double precision;
  v_total_orders bigint;
  v_status_counts jsonb;
  v_top_products jsonb;
  v_recent_orders jsonb;
  v_motoboys jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);

  SELECT COALESCE(SUM(total), 0) INTO v_total_revenue FROM ufersin.orders WHERE payment_status = 'pago';
  SELECT COUNT(*) INTO v_total_orders FROM ufersin.orders;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', cnt)), '[]'::jsonb)
    INTO v_status_counts
    FROM (SELECT status, COUNT(*) AS cnt FROM ufersin.orders GROUP BY status) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'product_name', product_name,
      'quantity_sold', qty, 'revenue', rev
    ) ORDER BY qty DESC), '[]'::jsonb)
    INTO v_top_products
    FROM (
      SELECT oi.product_id, oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.unit_price * oi.quantity) AS rev
      FROM ufersin.order_items oi JOIN ufersin.orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'pago'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY qty DESC LIMIT 10
    ) t;

  SELECT COALESCE(jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_recent_orders
    FROM (SELECT id, created_at FROM ufersin.orders ORDER BY created_at DESC LIMIT 20) o;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name,
      'total_deliveries', d.cnt, 'total_shipping', d.total_shipping,
      'pending_amount', p.amount,
      'total_paid', COALESCE(s.total_paid, 0)
    ) ORDER BY m.name), '[]'::jsonb)
    INTO v_motoboys
    FROM ufersin.motoboys m
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(o.shipping_price), 0) AS total_shipping
      FROM ufersin.orders o
      WHERE o.motoboy_id = m.id AND o.status = 'concluido' AND o.delivery_type = 'entrega'
    ) d ON true
    LEFT JOIN LATERAL (SELECT * FROM ufersin._motoboy_pending(m.id)) p ON true
    LEFT JOIN LATERAL (
      SELECT SUM(amount) AS total_paid FROM ufersin.motoboy_settlements WHERE motoboy_id = m.id
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
GRANT EXECUTE ON FUNCTION ufersin.admin_financeiro(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_motoboy_runs.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — corrida do motoboy (revolução da fila + rastreamento
-- ao vivo). Substitui o fluxo antigo de "pedir localização por WhatsApp"
-- (obsoleto agora que o checkout já captura customer_lat/lng no mapa):
-- o motoboy seleciona um lote de pedidos prontos e clica "Iniciar
-- entrega(s)" — daí em diante a corrida existe no banco (não na tela),
-- sobrevive a reload/troca de página, e só termina quando cada entrega
-- do lote for concluída uma a uma, na ordem otimizada por distância.
--
-- 100% em Supabase, sem dependência de deploy do Rust.
--
-- IMPORTANTE — ordem de execução: rode DEPOIS de sunset_motoboy_payout.sql
-- (usa ufersin._motoboy_pending e ufersin.motoboy_settlements) e depois que
-- a coluna ufersin.orders.reference_point já existir (migration 0004 do
-- Rust já rodada — se você já rodou sunset_order_reference_point.sql com
-- sucesso, está tudo certo).
-- =====================================================

ALTER TABLE ufersin.orders ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz;
ALTER TABLE ufersin.orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE TABLE IF NOT EXISTS ufersin.motoboy_runs (
  id text PRIMARY KEY,
  motoboy_id text NOT NULL REFERENCES ufersin.motoboys(id) ON DELETE CASCADE,
  order_ids text[] NOT NULL,
  current_index int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'concluido')),
  motoboy_lat double precision,
  motoboy_lng double precision,
  motoboy_heading double precision,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Só uma corrida ativa por motoboy — é isso que impede ele de "sumir" da
-- corrida: não existe como abrir uma segunda enquanto a primeira não
-- terminar, e o front sempre consegue reidratar qual é a ativa.
CREATE UNIQUE INDEX IF NOT EXISTS motoboy_runs_one_active_per_motoboy
  ON ufersin.motoboy_runs (motoboy_id) WHERE status = 'ativo';

ALTER TABLE ufersin.motoboy_runs ENABLE ROW LEVEL SECURITY;
-- Sem policies de propósito — só acessível via RPC SECURITY DEFINER.

-- ─────────────────────────────────────────────────────
-- Otimização de rota: nearest-neighbor guloso a partir da loja. Simples
-- e O(n²), mais que suficiente pro tamanho real de um lote de entregas.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._optimize_route(p_order_ids text[])
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_settings  ufersin.shipping_settings%ROWTYPE;
  v_remaining text[] := p_order_ids;
  v_result    text[] := ARRAY[]::text[];
  v_cur_lat   double precision;
  v_cur_lng   double precision;
  v_best_id   text;
  v_best_dist double precision;
  v_id        text;
  v_lat       double precision;
  v_lng       double precision;
  v_dist      double precision;
BEGIN
  SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
  v_cur_lat := v_settings.store_lat;
  v_cur_lng := v_settings.store_lng;

  WHILE array_length(v_remaining, 1) > 0 LOOP
    v_best_id := NULL;
    v_best_dist := NULL;
    FOREACH v_id IN ARRAY v_remaining LOOP
      SELECT customer_lat, customer_lng INTO v_lat, v_lng FROM ufersin.orders WHERE id = v_id;
      v_dist := ufersin._distance_km(v_cur_lat, v_cur_lng, v_lat, v_lng);
      IF v_best_dist IS NULL OR v_dist < v_best_dist THEN
        v_best_dist := v_dist;
        v_best_id := v_id;
      END IF;
    END LOOP;
    v_result := v_result || v_best_id;
    SELECT customer_lat, customer_lng INTO v_cur_lat, v_cur_lng FROM ufersin.orders WHERE id = v_best_id;
    v_remaining := array_remove(v_remaining, v_best_id);
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION ufersin._run_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'current_index', r.current_index,
    'order_ids', r.order_ids,
    'motoboy_lat', r.motoboy_lat,
    'motoboy_lng', r.motoboy_lng,
    'motoboy_heading', r.motoboy_heading,
    'started_at', r.started_at,
    'finished_at', r.finished_at,
    'orders', COALESCE((
      SELECT jsonb_agg(ufersin.get_order(oid))
      FROM unnest(r.order_ids) AS oid
    ), '[]'::jsonb)
  )
  FROM ufersin.motoboy_runs r WHERE r.id = p_id;
$$;

-- ─────────────────────────────────────────────────────
-- RPCs do motoboy
-- ─────────────────────────────────────────────────────

-- Reidrata a corrida ativa (ou null) — chamado ao abrir qualquer página
-- do dashboard do motoboy, é isso que garante que a corrida nunca "some"
-- se ele sair da tela de mapa ou recarregar.
CREATE OR REPLACE FUNCTION ufersin.motoboy_active_run(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
  v_run_id text;
BEGIN
  SELECT id INTO v_run_id FROM ufersin.motoboy_runs WHERE motoboy_id = v_motoboy_id AND status = 'ativo';
  IF v_run_id IS NULL THEN RETURN NULL; END IF;
  RETURN ufersin._run_json(v_run_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.motoboy_active_run(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.motoboy_start_run(p_token text, p_order_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
  v_run_id text := gen_random_uuid()::text;
  v_sequence text[];
  v_order ufersin.orders%ROWTYPE;
  v_distinct_ids text[];
  v_found_count int;
BEGIN
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'select at least one order to start a run';
  END IF;
  IF EXISTS (SELECT 1 FROM ufersin.motoboy_runs WHERE motoboy_id = v_motoboy_id AND status = 'ativo') THEN
    RAISE EXCEPTION 'you already have an active run — finish it before starting another';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_distinct_ids FROM unnest(p_order_ids) AS x;
  SELECT COUNT(*) INTO v_found_count FROM ufersin.orders WHERE id = ANY(v_distinct_ids);
  IF v_found_count <> array_length(v_distinct_ids, 1) THEN
    RAISE EXCEPTION 'one or more order ids do not exist';
  END IF;

  FOR v_order IN SELECT * FROM ufersin.orders WHERE id = ANY(v_distinct_ids) LOOP
    IF v_order.delivery_type <> 'entrega' OR v_order.status <> 'pedido_pronto' OR v_order.motoboy_id IS NOT NULL THEN
      RAISE EXCEPTION 'order % is not available to start a delivery run', v_order.id;
    END IF;
  END LOOP;

  v_sequence := ufersin._optimize_route(v_distinct_ids);

  UPDATE ufersin.orders
    SET motoboy_id = v_motoboy_id, status = 'em_rota_de_entrega',
        delivery_started_at = now(), updated_at = now()::text
    WHERE id = ANY(p_order_ids);

  INSERT INTO ufersin.motoboy_runs (id, motoboy_id, order_ids)
    VALUES (v_run_id, v_motoboy_id, v_sequence);

  RETURN ufersin._run_json(v_run_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.motoboy_start_run(text, text[]) TO anon, authenticated;

-- Chamado com frequência (a cada poucos segundos) enquanto o motoboy
-- navega — atualiza a posição ao vivo que o /consultar do cliente lê.
CREATE OR REPLACE FUNCTION ufersin.motoboy_update_run_position(
  p_token text, p_lat double precision, p_lng double precision, p_heading double precision DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
BEGIN
  UPDATE ufersin.motoboy_runs
    SET motoboy_lat = p_lat, motoboy_lng = p_lng, motoboy_heading = p_heading, updated_at = now()
    WHERE motoboy_id = v_motoboy_id AND status = 'ativo';
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.motoboy_update_run_position(text, double precision, double precision, double precision) TO anon, authenticated;

-- Conclui a entrega ATUAL da corrida (current_index) e avança pra
-- próxima; quando acaba a sequência, fecha a corrida inteira. Mesma
-- regra de confirmação de pagamento que já existia (pix não precisa,
-- cartão/dinheiro precisa do popup "recebeu?").
CREATE OR REPLACE FUNCTION ufersin.motoboy_complete_current_delivery(p_token text, p_payment_confirmed boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
  v_run ufersin.motoboy_runs%ROWTYPE;
  v_order_id text;
  v_order ufersin.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM ufersin.motoboy_runs WHERE motoboy_id = v_motoboy_id AND status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active run';
  END IF;

  v_order_id := v_run.order_ids[v_run.current_index + 1]; -- Postgres arrays são 1-indexados
  SELECT * INTO v_order FROM ufersin.orders WHERE id = v_order_id;

  PERFORM ufersin._confirm_payment_if_needed(v_order.payment_method, v_order.payment_status, p_payment_confirmed);

  UPDATE ufersin.orders SET
    status = 'concluido',
    payment_status = CASE WHEN v_order.payment_method = 'pix' THEN payment_status ELSE 'pago' END,
    delivered_at = now(), updated_at = now()::text
  WHERE id = v_order_id;

  IF v_run.current_index + 1 >= array_length(v_run.order_ids, 1) THEN
    UPDATE ufersin.motoboy_runs SET status = 'concluido', finished_at = now(), updated_at = now() WHERE id = v_run.id;
  ELSE
    UPDATE ufersin.motoboy_runs SET current_index = current_index + 1, updated_at = now() WHERE id = v_run.id;
  END IF;

  RETURN ufersin._run_json(v_run.id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.motoboy_complete_current_delivery(text, boolean) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Rastreamento público (tela /consultar do cliente) — poll a cada
-- poucos segundos enquanto o pedido está em_rota_de_entrega. Não expõe
-- nada além da posição do motoboy responsável por ESSE pedido
-- específico (o cliente só tem o id do próprio pedido, não enumera).
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.track_delivery_position(p_order_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_order ufersin.orders%ROWTYPE;
  v_run ufersin.motoboy_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM ufersin.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_order.status <> 'em_rota_de_entrega' OR v_order.motoboy_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_run FROM ufersin.motoboy_runs
    WHERE motoboy_id = v_order.motoboy_id AND status = 'ativo' AND p_order_id = ANY(order_ids);
  IF NOT FOUND OR v_run.motoboy_lat IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'lat', v_run.motoboy_lat,
    'lng', v_run.motoboy_lng,
    'heading', v_run.motoboy_heading,
    'updated_at', v_run.updated_at,
    'is_next_stop', (v_run.order_ids[v_run.current_index + 1] = p_order_id)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.track_delivery_position(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- get_order ganha delivery_started_at/delivered_at (duração da entrega).
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'customer_name', o.customer_name,
    'customer_whatsapp', o.customer_whatsapp,
    'delivery_type', o.delivery_type,
    'neighborhood', o.neighborhood,
    'address', o.address,
    'reference_point', o.reference_point,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'status', o.status,
    'shipping_price', o.shipping_price,
    'total', o.total,
    'motoboy_id', o.motoboy_id,
    'pix_payment_id', o.pix_payment_id,
    'pix_qr_base64', o.pix_qr_base64,
    'pix_copia_cola', o.pix_copia_cola,
    'customer_lat', o.customer_lat,
    'customer_lng', o.customer_lng,
    'motoboy_paid_at', o.motoboy_paid_at,
    'delivery_started_at', o.delivery_started_at,
    'delivered_at', o.delivered_at,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'product_name', oi.product_name,
        'unit_price', oi.unit_price,
        'quantity', oi.quantity
      ))
      FROM ufersin.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM ufersin.orders o
  WHERE o.id = p_order_id;
$$;

GRANT EXECUTE ON FUNCTION ufersin.get_order(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Contagem da fila do motoboy sem mais aguardando_localizacao (fluxo
-- extinto — a localização já vem do checkout).
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.motoboy_order_counts(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
  v_pronto bigint;
  v_em_rota bigint;
  v_concluido bigint;
BEGIN
  SELECT COUNT(*) INTO v_pronto FROM ufersin.orders
    WHERE delivery_type = 'entrega' AND status = 'pedido_pronto' AND motoboy_id IS NULL;
  SELECT COUNT(*) INTO v_em_rota FROM ufersin.orders
    WHERE delivery_type = 'entrega' AND status IN ('em_rota_de_entrega', 'entregue') AND motoboy_id = v_motoboy_id;
  SELECT COUNT(*) INTO v_concluido FROM ufersin.orders
    WHERE delivery_type = 'entrega' AND status = 'concluido' AND motoboy_id = v_motoboy_id;

  RETURN jsonb_build_object(
    'pedido_pronto', v_pronto,
    'em_rota_de_entrega', v_em_rota,
    'concluido', v_concluido
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.motoboy_order_counts(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Duração média de entrega (estatística) — financeiro do admin e do
-- motoboy passam a expor isso.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._avg_delivery_minutes(p_motoboy_id text DEFAULT NULL)
RETURNS double precision LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT AVG(EXTRACT(EPOCH FROM (delivered_at - delivery_started_at)) / 60)
  FROM ufersin.orders
  WHERE delivery_type = 'entrega' AND status = 'concluido'
    AND delivery_started_at IS NOT NULL AND delivered_at IS NOT NULL
    AND (p_motoboy_id IS NULL OR motoboy_id = p_motoboy_id);
$$;

CREATE OR REPLACE FUNCTION ufersin.motoboy_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
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
      'duration_minutes', CASE WHEN o.delivery_started_at IS NOT NULL AND o.delivered_at IS NOT NULL
        THEN round((EXTRACT(EPOCH FROM (o.delivered_at - o.delivery_started_at)) / 60)::numeric, 1) ELSE NULL END,
      'updated_at', o.updated_at
    ) ORDER BY o.updated_at DESC), '[]'::jsonb),
    COALESCE(SUM(o.shipping_price), 0)
  INTO v_deliveries, v_total_shipping
  FROM ufersin.orders o
  WHERE o.motoboy_id = v_motoboy_id AND o.status = 'concluido' AND o.delivery_type = 'entrega';

  SELECT * INTO v_pending FROM ufersin._motoboy_pending(v_motoboy_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM ufersin.motoboy_settlements WHERE motoboy_id = v_motoboy_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'amount', amount, 'payment_method', payment_method, 'paid_at', paid_at
    ) ORDER BY paid_at DESC), '[]'::jsonb)
    INTO v_settlements
    FROM ufersin.motoboy_settlements WHERE motoboy_id = v_motoboy_id;

  RETURN jsonb_build_object(
    'pending_amount', v_pending.amount,
    'total_paid', v_total_paid,
    'total_deliveries', jsonb_array_length(v_deliveries),
    'total_shipping', v_total_shipping,
    'avg_delivery_minutes', round(COALESCE(ufersin._avg_delivery_minutes(v_motoboy_id), 0)::numeric, 1),
    'deliveries', v_deliveries,
    'settlements', v_settlements
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.motoboy_financeiro(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_total_revenue double precision;
  v_total_orders bigint;
  v_status_counts jsonb;
  v_top_products jsonb;
  v_recent_orders jsonb;
  v_motoboys jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);

  SELECT COALESCE(SUM(total), 0) INTO v_total_revenue FROM ufersin.orders WHERE payment_status = 'pago';
  SELECT COUNT(*) INTO v_total_orders FROM ufersin.orders;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', cnt)), '[]'::jsonb)
    INTO v_status_counts
    FROM (SELECT status, COUNT(*) AS cnt FROM ufersin.orders GROUP BY status) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'product_name', product_name,
      'quantity_sold', qty, 'revenue', rev
    ) ORDER BY qty DESC), '[]'::jsonb)
    INTO v_top_products
    FROM (
      SELECT oi.product_id, oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.unit_price * oi.quantity) AS rev
      FROM ufersin.order_items oi JOIN ufersin.orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'pago'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY qty DESC LIMIT 10
    ) t;

  SELECT COALESCE(jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_recent_orders
    FROM (SELECT id, created_at FROM ufersin.orders ORDER BY created_at DESC LIMIT 20) o;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name,
      'total_deliveries', d.cnt, 'total_shipping', d.total_shipping,
      'pending_amount', p.amount,
      'total_paid', COALESCE(s.total_paid, 0),
      'avg_delivery_minutes', round(COALESCE(ufersin._avg_delivery_minutes(m.id), 0)::numeric, 1)
    ) ORDER BY m.name), '[]'::jsonb)
    INTO v_motoboys
    FROM ufersin.motoboys m
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(o.shipping_price), 0) AS total_shipping
      FROM ufersin.orders o
      WHERE o.motoboy_id = m.id AND o.status = 'concluido' AND o.delivery_type = 'entrega'
    ) d ON true
    LEFT JOIN LATERAL (SELECT * FROM ufersin._motoboy_pending(m.id)) p ON true
    LEFT JOIN LATERAL (
      SELECT SUM(amount) AS total_paid FROM ufersin.motoboy_settlements WHERE motoboy_id = m.id
    ) s ON true;

  RETURN jsonb_build_object(
    'total_revenue', v_total_revenue,
    'total_orders', v_total_orders,
    'orders_by_status', v_status_counts,
    'top_products', v_top_products,
    'recent_orders', v_recent_orders,
    'motoboys', v_motoboys,
    'avg_delivery_minutes', round(COALESCE(ufersin._avg_delivery_minutes(NULL), 0)::numeric, 1)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_financeiro(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_track_position_privacy.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — track_delivery_position só revela a posição do motoboy
-- pro pedido que é REALMENTE a parada atual da corrida (current_index).
-- Antes a posição vazava pra qualquer pedido do lote, mesmo enquanto o
-- motoboy ainda tava terminando outra entrega antes — exatamente o que o
-- Uber/99 evita: o cliente só vê o motoboy quando ele já está a caminho
-- DELE, não enquanto entrega pra outra pessoa do mesmo lote.
--
-- 100% em Supabase, sem dependência de deploy do Rust.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.track_delivery_position(p_order_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_order ufersin.orders%ROWTYPE;
  v_run ufersin.motoboy_runs%ROWTYPE;
  v_is_next boolean;
BEGIN
  SELECT * INTO v_order FROM ufersin.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_order.status <> 'em_rota_de_entrega' OR v_order.motoboy_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_run FROM ufersin.motoboy_runs
    WHERE motoboy_id = v_order.motoboy_id AND status = 'ativo' AND p_order_id = ANY(order_ids);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_is_next := (v_run.order_ids[v_run.current_index + 1] = p_order_id);

  -- Ainda não chegou a vez desse pedido no lote — não revela lat/lng.
  IF NOT v_is_next THEN
    RETURN jsonb_build_object('is_next_stop', false);
  END IF;

  IF v_run.motoboy_lat IS NULL THEN
    RETURN jsonb_build_object('is_next_stop', true);
  END IF;

  RETURN jsonb_build_object(
    'lat', v_run.motoboy_lat,
    'lng', v_run.motoboy_lng,
    'heading', v_run.motoboy_heading,
    'updated_at', v_run.updated_at,
    'is_next_stop', true
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.track_delivery_position(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_max_radius_and_motoboy_contact.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ecommerce — raio máximo de entrega + contato do motoboy no /consultar
--
-- 1) admin define uma distância máxima (km) de entrega em ufersin.shipping_settings.
--    max_km NULL = sem limite (comportamento atual, compatível).
--    Enforçado tanto em estimate_shipping (avisa o cliente antes de confirmar
--    a localização) quanto em create_order (nunca confia só no front — barra
--    de verdade o pedido se a distância exceder o limite).
-- 2) get_order passa a incluir o nome/whatsapp do motoboy responsável, pra
--    o cliente conseguir falar com ele direto em /consultar quando o pedido
--    já está em_rota_de_entrega.
-- =====================================================

ALTER TABLE ufersin.shipping_settings ADD COLUMN IF NOT EXISTS max_km double precision;

-- estimate_shipping — mesma assinatura, só passa a devolver max_km/within_range
-- junto pro frontend avisar o cliente antes de ele confirmar a localização.
CREATE OR REPLACE FUNCTION ufersin.estimate_shipping(p_lat double precision, p_lng double precision)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_settings ufersin.shipping_settings%ROWTYPE;
  v_km double precision;
BEGIN
  SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
  v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_lat, p_lng);
  RETURN jsonb_build_object(
    'km', round(v_km::numeric, 2),
    'price', round((v_km * v_settings.price_per_km)::numeric, 2),
    'max_km', v_settings.max_km,
    'within_range', (v_settings.max_km IS NULL OR v_km <= v_settings.max_km)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.estimate_shipping(double precision, double precision) TO anon, authenticated;

-- admin_update_shipping_settings ganhou um parâmetro novo (p_max_km) — troca
-- a lista de argumentos, então precisa dropar a assinatura antiga de 2
-- parâmetros antes (CREATE OR REPLACE não troca assinatura, só sobrescreve
-- se for idêntica).
DROP FUNCTION IF EXISTS ufersin.admin_update_shipping_settings(text, double precision);

CREATE OR REPLACE FUNCTION ufersin.admin_update_shipping_settings(
  p_token text,
  p_price_per_km double precision,
  p_max_km double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_price_per_km IS NULL OR p_price_per_km < 0 THEN
    RAISE EXCEPTION 'price_per_km must be a non-negative number';
  END IF;
  IF p_max_km IS NOT NULL AND p_max_km <= 0 THEN
    RAISE EXCEPTION 'max_km must be a positive number';
  END IF;
  UPDATE ufersin.shipping_settings SET price_per_km = p_price_per_km, max_km = p_max_km WHERE id = 1;
  RETURN jsonb_build_object('price_per_km', p_price_per_km, 'max_km', p_max_km);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_shipping_settings(text, double precision, double precision) TO anon, authenticated;

-- create_order — mesma assinatura de sunset_order_reference_point.sql, só
-- adiciona a checagem do raio máximo antes de gravar o pedido. Nunca confia
-- no front: recalcula a distância aqui de novo, igual já fazia pro preço.
CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
DECLARE
  v_item        jsonb;
  v_product     ufersin.products%ROWTYPE;
  v_quantity    bigint;
  v_total       double precision := 0;
  v_shipping    double precision := 0;
  v_customer_id text;
  v_order_id    text := gen_random_uuid()::text;
  v_item_id     text;
  v_settings    ufersin.shipping_settings%ROWTYPE;
  v_km          double precision;
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  -- valida itens + calcula total, travando as linhas de estoque
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

  -- frete: só pra entrega, calculado por distância real (nunca confia no
  -- valor vindo do cliente, só nas coordenadas — o preço é recalculado
  -- aqui do zero). Também barra o pedido se exceder o raio máximo
  -- configurado pelo admin.
  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;
  v_total := v_total + v_shipping;

  -- upsert do cliente por whatsapp
  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;

-- get_order — mesma assinatura, só passa a trazer nome/whatsapp do motoboy
-- responsável (LEFT JOIN, fica null se ainda não tiver motoboy atribuído)
-- pro botão "Falar com motoboy" em /consultar.
CREATE OR REPLACE FUNCTION ufersin.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'customer_name', o.customer_name,
    'customer_whatsapp', o.customer_whatsapp,
    'delivery_type', o.delivery_type,
    'neighborhood', o.neighborhood,
    'address', o.address,
    'reference_point', o.reference_point,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'status', o.status,
    'shipping_price', o.shipping_price,
    'total', o.total,
    'motoboy_id', o.motoboy_id,
    'motoboy_name', m.name,
    'motoboy_whatsapp', m.whatsapp,
    'pix_payment_id', o.pix_payment_id,
    'pix_qr_base64', o.pix_qr_base64,
    'pix_copia_cola', o.pix_copia_cola,
    'customer_lat', o.customer_lat,
    'customer_lng', o.customer_lng,
    'motoboy_paid_at', o.motoboy_paid_at,
    'delivery_started_at', o.delivery_started_at,
    'delivered_at', o.delivered_at,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'product_name', oi.product_name,
        'unit_price', oi.unit_price,
        'quantity', oi.quantity
      ))
      FROM ufersin.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM ufersin.orders o
  LEFT JOIN ufersin.motoboys m ON m.id = o.motoboy_id
  WHERE o.id = p_order_id;
$$;

-- ───────────────────────────────────────────────────────────────────
-- sunset_motoboy_start_run_precomputed.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- ufersin.motoboy_start_run ganha um 3º parâmetro opcional: a ordem de
-- entrega JÁ CALCULADA pelo backend Rust via Google Routes API (distância
-- real de rua, respeitando trânsito/mão-e-contramão) quando
-- GOOGLE_ROUTES_API_KEY estiver configurada. Sem ela (hoje), o backend
-- chama essa mesma função sem o 3º parâmetro e tudo continua exatamente
-- como antes — cai no heurístico de linha reta (_optimize_route).
--
-- Todas as validações de negócio (pedido disponível, motoboy sem corrida
-- ativa, ids existem etc.) continuam morando só aqui — o Rust só decide a
-- ORDEM antes de chamar, nunca faz a escrita ele mesmo.
--
-- Precisa dropar a assinatura antiga (2 parâmetros) primeiro — adicionar
-- parâmetro muda a assinatura, CREATE OR REPLACE não troca isso sozinho.
-- =====================================================

DROP FUNCTION IF EXISTS ufersin.motoboy_start_run(text, text[]);

CREATE OR REPLACE FUNCTION ufersin.motoboy_start_run(
  p_token text,
  p_order_ids text[],
  p_precomputed_order text[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_motoboy_id text := ufersin._require_motoboy(p_token);
  v_run_id text := gen_random_uuid()::text;
  v_sequence text[];
  v_order ufersin.orders%ROWTYPE;
  v_distinct_ids text[];
  v_found_count int;
BEGIN
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'select at least one order to start a run';
  END IF;
  IF EXISTS (SELECT 1 FROM ufersin.motoboy_runs WHERE motoboy_id = v_motoboy_id AND status = 'ativo') THEN
    RAISE EXCEPTION 'you already have an active run — finish it before starting another';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_distinct_ids FROM unnest(p_order_ids) AS x;
  SELECT COUNT(*) INTO v_found_count FROM ufersin.orders WHERE id = ANY(v_distinct_ids);
  IF v_found_count <> array_length(v_distinct_ids, 1) THEN
    RAISE EXCEPTION 'one or more order ids do not exist';
  END IF;

  FOR v_order IN SELECT * FROM ufersin.orders WHERE id = ANY(v_distinct_ids) LOOP
    IF v_order.delivery_type <> 'entrega' OR v_order.status <> 'pedido_pronto' OR v_order.motoboy_id IS NOT NULL THEN
      RAISE EXCEPTION 'order % is not available to start a delivery run', v_order.id;
    END IF;
  END LOOP;

  -- Se o backend Rust já mandou a ordem calculada com distância real de
  -- rua, usa ela — só confirma que é exatamente o mesmo conjunto de ids
  -- (nunca confia cegamente numa lista vinda de fora), pra não deixar
  -- entrar/sumir pedido do lote por essa via.
  IF p_precomputed_order IS NOT NULL THEN
    IF (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(p_precomputed_order) AS x)
       IS DISTINCT FROM (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(v_distinct_ids) AS x) THEN
      RAISE EXCEPTION 'precomputed order does not match the given order ids';
    END IF;
    v_sequence := p_precomputed_order;
  ELSE
    v_sequence := ufersin._optimize_route(v_distinct_ids);
  END IF;

  UPDATE ufersin.orders
    SET motoboy_id = v_motoboy_id, status = 'em_rota_de_entrega',
        delivery_started_at = now(), updated_at = now()::text
    WHERE id = ANY(p_order_ids);

  INSERT INTO ufersin.motoboy_runs (id, motoboy_id, order_ids)
    VALUES (v_run_id, v_motoboy_id, v_sequence);

  RETURN ufersin._run_json(v_run_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.motoboy_start_run(text, text[], text[]) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_vendedor_pdv.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Vendedor (novo papel) + PDV (venda presencial no balcão)
--
-- Vendedor usa a MESMA tela do admin (layout compartilhado no front), mas
-- só enxerga PDV + Relatórios — reforçado no front (nav filtrado + guarda
-- de rota) e no banco (cada RPC só aceita os papéis certos via
-- _require_admin / _require_admin_or_vendedor).
-- =====================================================

-- 1. sessions ganha o papel 'vendedor' ------------------------------------
ALTER TABLE ufersin.sessions DROP CONSTRAINT IF EXISTS sessions_role_check;
ALTER TABLE ufersin.sessions ADD CONSTRAINT sessions_role_check CHECK (role IN ('admin', 'motoboy', 'vendedor'));

-- 2. tabela vendedores (espelha ufersin.motoboys, sem telefone/whatsapp —
--    vendedor não tem instância própria de WhatsApp; toda mensagem de
--    venda no PDV sai do número da LOJA) -----------------------------------
CREATE TABLE IF NOT EXISTS ufersin.vendedores (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active        BIGINT NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (now()::text)
);

CREATE OR REPLACE FUNCTION ufersin.vendedor_login(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_v ufersin.vendedores%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_v FROM ufersin.vendedores WHERE email = p_email;
  IF NOT FOUND OR v_v.active = 0 OR v_v.password_hash <> crypt(p_password, v_v.password_hash) THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO ufersin.sessions (token, role, subject_id) VALUES (v_token, 'vendedor', v_v.id);

  RETURN jsonb_build_object('token', v_token, 'name', v_v.name);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.vendedor_login(text, text) TO anon, authenticated;

-- Aceita admin OU vendedor — usado pelo PDV e pelos relatórios, que os
-- dois papéis acessam (cada um vê o recorte de dados certo dentro da RPC).
CREATE OR REPLACE FUNCTION ufersin._require_admin_or_vendedor(p_token text)
RETURNS TABLE(subject_id text, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_subject text;
  v_role text;
BEGIN
  SELECT s.subject_id, s.role INTO v_subject, v_role FROM ufersin.sessions s
    WHERE s.token = p_token AND s.role IN ('admin', 'vendedor') AND s.expires_at > now();
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY SELECT v_subject, v_role;
END;
$$;

-- 3. CRUD de vendedores (só admin) -----------------------------------------
CREATE OR REPLACE FUNCTION ufersin._vendedor_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object('id', id, 'name', name, 'email', email, 'active', (active <> 0))
  FROM ufersin.vendedores WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_list_vendedores(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(ufersin._vendedor_json(id) ORDER BY name) FROM ufersin.vendedores), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_vendedores(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_create_vendedor(p_token text, p_name text, p_email text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'name and email are required';
  END IF;
  IF p_password IS NULL OR trim(p_password) = '' THEN
    RAISE EXCEPTION 'password is required to create a vendedor';
  END IF;
  BEGIN
    INSERT INTO ufersin.vendedores (id, name, email, password_hash)
      VALUES (v_id, p_name, p_email, crypt(p_password, gen_salt('bf')));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN ufersin._vendedor_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_vendedor(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_vendedor(
  p_token text, p_id text, p_name text, p_email text, p_active boolean DEFAULT true, p_password text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE ufersin.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      password_hash = crypt(p_password, gen_salt('bf'))
    WHERE id = p_id;
  ELSE
    UPDATE ufersin.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendedor not found';
  END IF;
  RETURN ufersin._vendedor_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_vendedor(text, text, text, text, boolean, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_delete_vendedor(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  DELETE FROM ufersin.vendedores WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendedor not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_vendedor(text, text) TO anon, authenticated;

-- 4. código de barras nos produtos ------------------------------------------
ALTER TABLE ufersin.products ADD COLUMN IF NOT EXISTS barcode text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON ufersin.products (barcode) WHERE barcode IS NOT NULL;

CREATE OR REPLACE FUNCTION ufersin._product_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price,
    'quantity', p.quantity, 'image_url', p.image_url, 'category_id', p.category_id,
    'category_name', c.name, 'active', (p.active <> 0), 'barcode', p.barcode
  )
  FROM ufersin.products p
  LEFT JOIN ufersin.categories c ON c.id = p.category_id
  WHERE p.id = p_id;
$$;

-- admin_create_product/admin_update_product ganham p_barcode — muda
-- assinatura, precisa dropar a antiga primeiro.
DROP FUNCTION IF EXISTS ufersin.admin_create_product(text, text, text, double precision, bigint, text, text, boolean);

CREATE OR REPLACE FUNCTION ufersin.admin_create_product(
  p_token text, p_name text, p_description text, p_price double precision,
  p_quantity bigint, p_image_url text, p_category_id text, p_active boolean DEFAULT true,
  p_barcode text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  BEGIN
    INSERT INTO ufersin.products (id, name, description, price, quantity, image_url, category_id, active, barcode)
      VALUES (v_id, p_name, p_description, p_price, p_quantity, p_image_url, p_category_id,
        CASE WHEN p_active THEN 1 ELSE 0 END, NULLIF(trim(p_barcode), ''));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'barcode already in use by another product';
  END;
  RETURN ufersin._product_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_product(text, text, text, double precision, bigint, text, text, boolean, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_product(text, text, text, text, double precision, bigint, text, text, boolean);

CREATE OR REPLACE FUNCTION ufersin.admin_update_product(
  p_token text, p_id text, p_name text, p_description text, p_price double precision,
  p_quantity bigint, p_image_url text, p_category_id text, p_active boolean DEFAULT true,
  p_barcode text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  BEGIN
    UPDATE ufersin.products SET
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
  RETURN ufersin._product_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_product(text, text, text, text, double precision, bigint, text, text, boolean, text) TO anon, authenticated;

-- 5. orders ganha colunas de atribuição de venda PDV + 'balcao' como
--    delivery_type válido (venda direta no balcão, sem entrega nem
--    retirada de pedido feito online) --------------------------------------
ALTER TABLE ufersin.orders ADD COLUMN IF NOT EXISTS sold_by_role text;
ALTER TABLE ufersin.orders ADD COLUMN IF NOT EXISTS sold_by_id text;

ALTER TABLE ufersin.orders DROP CONSTRAINT IF EXISTS orders_delivery_type_check;
ALTER TABLE ufersin.orders ADD CONSTRAINT orders_delivery_type_check CHECK (delivery_type IN ('entrega', 'retirada', 'balcao'));

-- 6. criar venda no PDV -----------------------------------------------------
-- Nome/WhatsApp do cliente são OPCIONAIS (cliente de balcão pode não
-- querer informar) — sem eles, "Cliente balcão" é usado só como rótulo,
-- SEM vincular/criar registro em ufersin.customers (evita amontoar
-- "clientes" fantasmas sem WhatsApp de verdade).
CREATE OR REPLACE FUNCTION ufersin.pdv_create_sale(
  p_token text,
  p_items jsonb,
  p_payment_method text,
  p_customer_name text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public, extensions
AS $$
DECLARE
  v_subject     text;
  v_role        text;
  v_item        jsonb;
  v_product     ufersin.products%ROWTYPE;
  v_quantity    bigint;
  v_total       double precision := 0;
  v_customer_id text;
  v_order_id    text := gen_random_uuid()::text;
  v_item_id     text;
  v_name        text;
  v_whatsapp    text;
BEGIN
  SELECT * INTO v_subject, v_role FROM ufersin._require_admin_or_vendedor(p_token);

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

    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id') FOR UPDATE;
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
    SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = v_whatsapp;
    IF v_customer_id IS NULL THEN
      v_customer_id := gen_random_uuid()::text;
      INSERT INTO ufersin.customers (id, name, whatsapp) VALUES (v_customer_id, v_name, v_whatsapp);
    ELSE
      UPDATE ufersin.customers SET name = v_name WHERE id = v_customer_id;
    END IF;
  END IF;

  -- Venda de balcão já nasce paga e concluída — não existe fluxo de
  -- preparo/entrega pra ela, é um só passo (diferente do checkout online).
  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    payment_method, payment_status, status, shipping_price, total,
    sold_by_role, sold_by_id
  ) VALUES (
    v_order_id, v_customer_id, v_name, COALESCE(v_whatsapp, ''), 'balcao',
    p_payment_method, 'pago', 'concluido', 0, v_total,
    v_role, v_subject
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.pdv_create_sale(text, jsonb, text, text, text) TO anon, authenticated;

-- 7. relatório de vendas — vendedor só vê as próprias vendas de balcão;
--    admin vê todas (de qualquer vendedor + as que ele mesmo bateu) -------
CREATE OR REPLACE FUNCTION ufersin.vendedor_relatorio(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_subject     text;
  v_role        text;
  v_total_sales double precision;
  v_total_count bigint;
  v_sales       jsonb;
BEGIN
  SELECT * INTO v_subject, v_role FROM ufersin._require_admin_or_vendedor(p_token);

  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_total_sales, v_total_count
    FROM ufersin.orders
    WHERE delivery_type = 'balcao'
      AND (v_role = 'admin' OR (sold_by_role = 'vendedor' AND sold_by_id = v_subject));

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id, 'total', o.total, 'payment_method', o.payment_method,
      'customer_name', o.customer_name, 'created_at', o.created_at,
      'sold_by_role', o.sold_by_role,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_name', oi.product_name, 'quantity', oi.quantity, 'unit_price', oi.unit_price
        )) FROM ufersin.order_items oi WHERE oi.order_id = o.id
      ), '[]'::jsonb)
    ) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_sales
    FROM (
      SELECT * FROM ufersin.orders
      WHERE delivery_type = 'balcao'
        AND (v_role = 'admin' OR (sold_by_role = 'vendedor' AND sold_by_id = v_subject))
      ORDER BY created_at DESC
      LIMIT 100
    ) o;

  RETURN jsonb_build_object('total_sales', v_total_sales, 'total_count', v_total_count, 'sales', v_sales);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.vendedor_relatorio(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_pdv_fix_customer_id.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Corrige bug real do pdv_create_sale: orders.customer_id é NOT NULL, mas
-- a função deixava null quando o cliente do balcão não informa WhatsApp
-- (opcional de propósito) — toda venda assim vai pra um cliente-placeholder
-- fixo e reutilizado ("Cliente balcão"), em vez de inventar um novo
-- registro por venda.
--
-- De quebra, habilita RLS em ufersin.vendedores (esqueci no script
-- original) — sem política nenhuma, igual ufersin.sessions/motoboys: só
-- alcançável via função SECURITY DEFINER, nunca direto pelo cliente.
-- =====================================================

ALTER TABLE ufersin.vendedores ENABLE ROW LEVEL SECURITY;

INSERT INTO ufersin.customers (id, name, whatsapp)
VALUES ('pdv-balcao-anonimo', 'Cliente balcão', 'pdv-balcao-anonimo')
ON CONFLICT (id) DO NOTHING;

-- DROP explícito da assinatura antiga -- adicionar parâmetros no fim faria
-- o Postgres tratar como uma NOVA função sobrecarregada em vez de
-- substituir a antiga (mesmo problema já resolvido em admin_create_product
-- /admin_update_product, ver sunset_admin_crud.sql).
DROP FUNCTION IF EXISTS ufersin.pdv_create_sale(text, jsonb, text, text, text);
CREATE OR REPLACE FUNCTION ufersin.pdv_create_sale(
  p_token text,
  p_items jsonb,
  p_payment_method text,
  p_customer_name text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public, extensions
AS $$
DECLARE
  v_subject     text;
  v_role        text;
  v_item        jsonb;
  v_product     ufersin.products%ROWTYPE;
  v_quantity    bigint;
  v_subtotal    double precision := 0;
  v_discount    double precision := 0;
  v_total       double precision := 0;
  v_customer_id text;
  v_order_id    text := gen_random_uuid()::text;
  v_item_id     text;
  v_name        text;
  v_whatsapp    text;
BEGIN
  SELECT * INTO v_subject, v_role FROM ufersin._require_admin_or_vendedor(p_token);

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'sale must have at least one item';
  END IF;
  IF p_payment_method NOT IN ('pix', 'cartao', 'dinheiro') THEN
    RAISE EXCEPTION 'invalid payment_method';
  END IF;
  IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid discount_type';
  END IF;

  v_name := COALESCE(NULLIF(trim(p_customer_name), ''), 'Cliente balcão');
  v_whatsapp := NULLIF(trim(p_customer_whatsapp), '');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id') FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product % not found', v_item->>'product_id';
    END IF;
    IF v_product.active = 0 THEN
      RAISE EXCEPTION 'product % is not available', v_product.name;
    END IF;
    IF v_product.quantity < v_quantity THEN
      RAISE EXCEPTION 'insufficient stock for product %', v_product.name;
    END IF;

    v_subtotal := v_subtotal + v_product.price * v_quantity;
  END LOOP;

  -- Desconto manual opcional do vendedor no ato da venda (nunca um cupom
  -- de verdade, não fica gravado em nenhum cadastro -- só abate o total
  -- desta venda específica). Sempre travado entre 0 e o subtotal, nunca
  -- deixa o total negativo.
  IF p_discount_type = 'percent' THEN
    v_discount := v_subtotal * COALESCE(p_discount_value, 0) / 100;
  ELSIF p_discount_type = 'fixed' THEN
    v_discount := COALESCE(p_discount_value, 0);
  END IF;
  v_discount := LEAST(GREATEST(v_discount, 0), v_subtotal);
  v_total := v_subtotal - v_discount;

  IF v_whatsapp IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = v_whatsapp;
    IF v_customer_id IS NULL THEN
      v_customer_id := gen_random_uuid()::text;
      INSERT INTO ufersin.customers (id, name, whatsapp) VALUES (v_customer_id, v_name, v_whatsapp);
    ELSE
      UPDATE ufersin.customers SET name = v_name WHERE id = v_customer_id;
    END IF;
  ELSE
    v_customer_id := 'pdv-balcao-anonimo';
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    payment_method, payment_status, status, shipping_price, total, discount_amount,
    sold_by_role, sold_by_id
  ) VALUES (
    v_order_id, v_customer_id, v_name, COALESCE(v_whatsapp, ''), 'balcao',
    p_payment_method, 'pago', 'concluido', 0, v_total, v_discount,
    v_role, v_subject
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.pdv_create_sale(text, jsonb, text, text, text, text, double precision) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_vendedor_pedidos_access.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Vendedor ganha acesso à página /admin/pedidos: pode ver e avançar os
-- pedidos feitos por cliente na landingpage, do mesmo jeito que o admin
-- (pendente -> montando -> pronto -> retirada/entrega -> concluído),
-- incluindo dar baixa em retiradas. Pedidos online não têm dono
-- (nenhum vendedor específico), então a listagem não é filtrada por quem
-- está logado — admin e vendedor enxergam a mesma fila.
--
-- Reaproveita ufersin._require_admin_or_vendedor (já criada em
-- sunset_vendedor_pdv.sql) só trocando _require_admin por ela nessas duas
-- funções.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.admin_list_orders(p_token text, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin_or_vendedor(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at DESC)
     FROM ufersin.orders o
     WHERE p_status IS NULL OR o.status = p_status),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_orders(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_order_status(p_token text, p_order_id text, p_status text, p_payment_confirmed boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_order ufersin.orders%ROWTYPE;
  v_set_paid boolean;
BEGIN
  PERFORM ufersin._require_admin_or_vendedor(p_token);
  SELECT * INTO v_order FROM ufersin.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_set_paid := ufersin._admin_apply_transition(
    v_order.status, p_status, v_order.delivery_type, v_order.payment_method, v_order.payment_status, p_payment_confirmed
  );

  IF v_set_paid THEN
    UPDATE ufersin.orders SET status = p_status, payment_status = 'pago', updated_at = now()::text WHERE id = p_order_id;
  ELSE
    UPDATE ufersin.orders SET status = p_status, updated_at = now()::text WHERE id = p_order_id;
  END IF;

  RETURN ufersin.get_order(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_order_status(text, text, text, boolean) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_checkout_birthdate.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Data de nascimento obrigatória no checkout — exigência legal (tabacaria só
-- pode vender pra maior de idade). Guardada no cliente (mesmo padrão de
-- name/whatsapp, upsert a cada pedido) e validada a cada create_order (18+),
-- nunca só no front.
-- =====================================================

ALTER TABLE ufersin.customers ADD COLUMN IF NOT EXISTS birthdate text;

-- create_order ganha um parâmetro novo (p_customer_birthdate) — precisa
-- dropar a assinatura antiga de 10 parâmetros antes (CREATE OR REPLACE só
-- sobrescreve se a lista de parâmetros for idêntica, senão cria um segundo
-- overload e o antigo continua "vivo" e chamável).
DROP FUNCTION IF EXISTS ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text);

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
DECLARE
  v_item        jsonb;
  v_product     ufersin.products%ROWTYPE;
  v_quantity    bigint;
  v_total       double precision := 0;
  v_shipping    double precision := 0;
  v_customer_id text;
  v_order_id    text := gen_random_uuid()::text;
  v_item_id     text;
  v_settings    ufersin.shipping_settings%ROWTYPE;
  v_km          double precision;
  v_birthdate   date;
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  -- valida itens + calcula total, travando as linhas de estoque
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

  -- frete: só pra entrega, calculado por distância real (nunca confia no
  -- valor vindo do cliente, só nas coordenadas — o preço é recalculado
  -- aqui do zero). Também barra o pedido se exceder o raio máximo
  -- configurado pelo admin.
  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;
  v_total := v_total + v_shipping;

  -- upsert do cliente por whatsapp
  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_campanhas_cupons.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Campanhas (banner + desconto, aparecem no carrossel da landing) e cupons
-- (código digitado no checkout) — página /admin/campanhas.
--
-- Campanha: precisa de imagem E de um desconto associado (produto(s) e/ou
-- frete grátis) pra poder ser criada — nunca existe campanha "vazia".
-- Clicar no banner leva direto pro checkout já com o(s) produto(s) da
-- campanha carregados e o desconto aplicado (sem passar pelo carrinho).
--
-- Cupom: código alfanumérico digitado manualmente no checkout normal.
-- Pode ser fixo (sem validade), com prazo (expires_at) e/ou com limite de
-- uso (max_uses). "allow_campaign_checkout" controla se ele TAMBÉM pode ser
-- combinado com uma campanha já aplicada (por padrão, não). Um cupom
-- kind='frete' zera o frete que o CLIENTE paga sem mexer no shipping_price
-- — o motoboy recebe o valor cheio do frete de qualquer jeito, quem
-- absorve o desconto é o lojista.
-- =====================================================

CREATE TABLE IF NOT EXISTS ufersin.coupons (
  id                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code                     TEXT NOT NULL UNIQUE,
  kind                     TEXT NOT NULL DEFAULT 'desconto' CHECK (kind IN ('desconto', 'frete')),
  discount_type            TEXT CHECK (discount_type IN ('percent', 'fixed')),
  discount_value           DOUBLE PRECISION,
  allow_campaign_checkout  BIGINT NOT NULL DEFAULT 0,
  active                   BIGINT NOT NULL DEFAULT 1,
  expires_at               TEXT,
  max_uses                 BIGINT,
  used_count               BIGINT NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (now()::text),
  CONSTRAINT coupons_desconto_needs_type CHECK (kind = 'frete' OR (discount_type IS NOT NULL AND discount_value IS NOT NULL))
);
ALTER TABLE ufersin.coupons ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS ufersin.campaigns (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title           TEXT NOT NULL,
  image_url       TEXT NOT NULL,
  product_ids     TEXT[] NOT NULL DEFAULT '{}',
  discount_type   TEXT CHECK (discount_type IN ('percent', 'fixed')),
  discount_value  DOUBLE PRECISION,
  free_shipping   BIGINT NOT NULL DEFAULT 0,
  active          BIGINT NOT NULL DEFAULT 1,
  starts_at       TEXT,
  expires_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (now()::text),
  CONSTRAINT campaigns_has_discount CHECK ((discount_type IS NOT NULL AND discount_value IS NOT NULL) OR free_shipping <> 0),
  CONSTRAINT campaigns_has_products CHECK (array_length(product_ids, 1) > 0)
);
ALTER TABLE ufersin.campaigns ENABLE ROW LEVEL SECURITY;

-- Rastreio no pedido: shipping_price NUNCA muda (é o que o motoboy recebe);
-- discount_amount/shipping_discount são só o quanto o CLIENTE deixou de
-- pagar, financiado pelo lojista.
ALTER TABLE ufersin.orders ADD COLUMN IF NOT EXISTS discount_amount double precision NOT NULL DEFAULT 0;
ALTER TABLE ufersin.orders ADD COLUMN IF NOT EXISTS shipping_discount double precision NOT NULL DEFAULT 0;
ALTER TABLE ufersin.orders ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE ufersin.orders ADD COLUMN IF NOT EXISTS campaign_id text;

-- ─────────────────────────────────────────────────────
-- Cupons — CRUD admin
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'code', code, 'kind', kind, 'discount_type', discount_type, 'discount_value', discount_value,
    'allow_campaign_checkout', (allow_campaign_checkout <> 0), 'active', (active <> 0),
    'expires_at', expires_at, 'max_uses', max_uses, 'used_count', used_count, 'created_at', created_at
  ) FROM ufersin.coupons WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_list_coupons(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(ufersin._coupon_json(id) ORDER BY created_at DESC) FROM ufersin.coupons), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_coupons(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_create_coupon(
  p_token text, p_code text, p_kind text,
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_allow_campaign_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_kind NOT IN ('desconto', 'frete') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  IF p_kind = 'desconto' THEN
    IF p_discount_type IS NULL OR p_discount_value IS NULL THEN
      RAISE EXCEPTION 'discount_type and discount_value are required for kind=desconto';
    END IF;
    IF p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  BEGIN
    INSERT INTO ufersin.coupons (id, code, kind, discount_type, discount_value, allow_campaign_checkout, expires_at, max_uses)
      VALUES (
        v_id, v_code, p_kind,
        CASE WHEN p_kind = 'frete' THEN NULL ELSE p_discount_type END,
        CASE WHEN p_kind = 'frete' THEN NULL ELSE p_discount_value END,
        CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;
  RETURN ufersin._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_coupon(
  p_token text, p_id text, p_active boolean, p_allow_campaign_checkout boolean,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  UPDATE ufersin.coupons SET
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    allow_campaign_checkout = CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  RETURN ufersin._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_coupon(text, text, boolean, boolean, text, bigint) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_delete_coupon(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  DELETE FROM ufersin.coupons WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_coupon(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Campanhas — CRUD admin
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._campaign_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'title', title, 'image_url', image_url, 'product_ids', to_jsonb(product_ids),
    'discount_type', discount_type, 'discount_value', discount_value, 'free_shipping', (free_shipping <> 0),
    'active', (active <> 0), 'starts_at', starts_at, 'expires_at', expires_at, 'created_at', created_at
  ) FROM ufersin.campaigns WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_list_campaigns(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(ufersin._campaign_json(id) ORDER BY created_at DESC) FROM ufersin.campaigns), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_campaigns(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_create_campaign(
  p_token text, p_title text, p_image_url text, p_product_ids text[],
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_free_shipping boolean DEFAULT false,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required to create a campaign';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF NOT p_free_shipping AND (p_discount_type IS NULL OR p_discount_value IS NULL) THEN
    RAISE EXCEPTION 'a campaign needs a product discount and/or free shipping';
  END IF;
  IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid discount_type';
  END IF;
  IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
    RAISE EXCEPTION 'percent discount must be between 0 and 100';
  END IF;
  IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
    RAISE EXCEPTION 'fixed discount must be positive';
  END IF;
  INSERT INTO ufersin.campaigns (id, title, image_url, product_ids, discount_type, discount_value, free_shipping, starts_at, expires_at)
    VALUES (
      v_id, trim(p_title), p_image_url, p_product_ids, p_discount_type, p_discount_value,
      CASE WHEN p_free_shipping THEN 1 ELSE 0 END, NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), '')
    );
  RETURN ufersin._campaign_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campaign(text, text, text, text[], text, double precision, boolean, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_campaign(
  p_token text, p_id text, p_title text, p_image_url text, p_product_ids text[],
  p_discount_type text, p_discount_value double precision, p_free_shipping boolean, p_active boolean,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF NOT p_free_shipping AND (p_discount_type IS NULL OR p_discount_value IS NULL) THEN
    RAISE EXCEPTION 'a campaign needs a product discount and/or free shipping';
  END IF;
  UPDATE ufersin.campaigns SET
    title = trim(p_title), image_url = p_image_url, product_ids = p_product_ids,
    discount_type = p_discount_type, discount_value = p_discount_value,
    free_shipping = CASE WHEN p_free_shipping THEN 1 ELSE 0 END,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''), expires_at = NULLIF(trim(p_expires_at), '')
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found';
  END IF;
  RETURN ufersin._campaign_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campaign(text, text, text, text, text[], text, double precision, boolean, boolean, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_delete_campaign(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  DELETE FROM ufersin.campaigns WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_campaign(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Público — carrossel da landing + checkout
-- ─────────────────────────────────────────────────────

-- Carrossel da landing: só campanhas ativas e dentro da janela de validade.
CREATE OR REPLACE FUNCTION ufersin.list_active_campaigns()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'title', title, 'image_url', image_url, 'product_ids', to_jsonb(product_ids),
    'discount_type', discount_type, 'discount_value', discount_value, 'free_shipping', (free_shipping <> 0),
    'expires_at', expires_at
  ) ORDER BY created_at DESC), '[]'::jsonb)
  FROM ufersin.campaigns
  WHERE active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION ufersin.list_active_campaigns() TO anon, authenticated;

-- Clique no banner -> checkout busca os dados certos da campanha (produtos
-- reais, preço, desconto) direto daqui, nunca confia no que veio da URL.
CREATE OR REPLACE FUNCTION ufersin.get_campaign(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'title', title, 'image_url', image_url, 'product_ids', to_jsonb(product_ids),
    'discount_type', discount_type, 'discount_value', discount_value, 'free_shipping', (free_shipping <> 0),
    'expires_at', expires_at
  )
  FROM ufersin.campaigns
  WHERE id = p_id AND active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION ufersin.get_campaign(text) TO anon, authenticated;

-- Preview do cupom no checkout (não incrementa used_count — só reserva de
-- verdade quando o pedido é criado em create_order).
CREATE OR REPLACE FUNCTION ufersin.validate_coupon(p_code text, p_campaign_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_coupon ufersin.coupons%ROWTYPE;
BEGIN
  SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF v_coupon.active = 0 THEN
    RAISE EXCEPTION 'coupon is not active';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
  END IF;
  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.validate_coupon(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- create_order ganha cupom + campanha
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text);

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_campaign_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
DECLARE
  v_item              jsonb;
  v_product           ufersin.products%ROWTYPE;
  v_quantity          bigint;
  v_subtotal          double precision := 0;
  v_shipping          double precision := 0;
  v_discount_amount   double precision := 0;
  v_shipping_discount double precision := 0;
  v_customer_id       text;
  v_order_id          text := gen_random_uuid()::text;
  v_item_id           text;
  v_settings          ufersin.shipping_settings%ROWTYPE;
  v_km                double precision;
  v_birthdate         date;
  v_campaign          ufersin.campaigns%ROWTYPE;
  v_coupon            ufersin.coupons%ROWTYPE;
  v_coupon_code       text;
  v_total             double precision;
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  -- campanha: janela ativa + todo item do carrinho tem que pertencer ao
  -- conjunto de produtos da campanha (não deixa aplicar desconto de
  -- campanha em produto fora dela).
  IF p_campaign_id IS NOT NULL THEN
    SELECT * INTO v_campaign FROM ufersin.campaigns WHERE id = p_campaign_id;
    IF NOT FOUND OR v_campaign.active = 0
       OR (v_campaign.starts_at IS NOT NULL AND v_campaign.starts_at::timestamptz > now())
       OR (v_campaign.expires_at IS NOT NULL AND v_campaign.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'campaign is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_campaign.product_ids))
    ) THEN
      RAISE EXCEPTION 'this campaign checkout can only contain the campaign products';
    END IF;
  END IF;

  -- valida itens + calcula subtotal, travando as linhas de estoque
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

    v_subtotal := v_subtotal + v_product.price * v_quantity;
  END LOOP;

  -- frete: preço real (nunca confia no cliente) — é sempre a base do
  -- repasse do motoboy. Cupom/campanha de frete grátis desconta só o que o
  -- CLIENTE paga (shipping_discount); shipping_price nunca muda.
  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  -- desconto da campanha
  IF v_campaign.id IS NOT NULL THEN
    IF v_campaign.discount_type = 'percent' THEN
      v_discount_amount := v_discount_amount + round((v_subtotal * v_campaign.discount_value / 100)::numeric, 2);
    ELSIF v_campaign.discount_type = 'fixed' THEN
      v_discount_amount := v_discount_amount + v_campaign.discount_value;
    END IF;
    IF v_campaign.free_shipping <> 0 THEN
      v_shipping_discount := v_shipping;
    END IF;
  END IF;

  -- cupom digitado no checkout
  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
    END IF;
    IF v_coupon.kind = 'frete' THEN
      v_shipping_discount := v_shipping;
    ELSE
      IF v_coupon.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_discount_amount := v_discount_amount + v_coupon.discount_value;
      END IF;
    END IF;
    UPDATE ufersin.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
    v_coupon_code := v_coupon.code;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  -- upsert do cliente por whatsapp
  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, campaign_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_campaign_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

-- get_order — mesma assinatura, só passa a trazer os campos de desconto.
CREATE OR REPLACE FUNCTION ufersin.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'customer_name', o.customer_name,
    'customer_whatsapp', o.customer_whatsapp,
    'delivery_type', o.delivery_type,
    'neighborhood', o.neighborhood,
    'address', o.address,
    'reference_point', o.reference_point,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'status', o.status,
    'shipping_price', o.shipping_price,
    'total', o.total,
    'discount_amount', o.discount_amount,
    'shipping_discount', o.shipping_discount,
    'coupon_code', o.coupon_code,
    'campaign_id', o.campaign_id,
    'motoboy_id', o.motoboy_id,
    'motoboy_name', m.name,
    'motoboy_whatsapp', m.whatsapp,
    'pix_payment_id', o.pix_payment_id,
    'pix_qr_base64', o.pix_qr_base64,
    'pix_copia_cola', o.pix_copia_cola,
    'customer_lat', o.customer_lat,
    'customer_lng', o.customer_lng,
    'motoboy_paid_at', o.motoboy_paid_at,
    'delivery_started_at', o.delivery_started_at,
    'delivered_at', o.delivered_at,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'product_name', oi.product_name,
        'unit_price', oi.unit_price,
        'quantity', oi.quantity
      ))
      FROM ufersin.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM ufersin.orders o
  LEFT JOIN ufersin.motoboys m ON m.id = o.motoboy_id
  WHERE o.id = p_order_id;
$$;

-- ───────────────────────────────────────────────────────────────────
-- sunset_campanhas_frete_aniversario.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Ajustes em campanhas/cupons:
-- 1) frete deixa de ser "grátis ou nada" e vira desconto configurável
--    (percentual ou valor fixo) — mais realista pro lojista que não quer
--    zerar o frete inteiro. campaigns.free_shipping (boolean) é substituído
--    por shipping_discount_type/shipping_discount_value (mesmo padrão do
--    desconto de produto). Em cupom, o kind 'frete' passa a reaproveitar as
--    MESMAS colunas discount_type/discount_value (que já existiam mas só
--    valiam pra kind='desconto') — agora valem pra qualquer kind.
-- 2) novo kind de cupom 'aniversario': só é válido durante o mês de
--    aniversário do cliente (usa customer_birthdate, que o checkout já
--    coleta) — validate_coupon ganha um parâmetro novo pra poder checar
--    isso na pré-visualização, não só na hora de criar o pedido.
-- =====================================================

ALTER TABLE ufersin.campaigns DROP CONSTRAINT IF EXISTS campaigns_has_discount;
ALTER TABLE ufersin.campaigns ADD COLUMN IF NOT EXISTS shipping_discount_type TEXT CHECK (shipping_discount_type IN ('percent', 'fixed'));
ALTER TABLE ufersin.campaigns ADD COLUMN IF NOT EXISTS shipping_discount_value DOUBLE PRECISION;
UPDATE ufersin.campaigns SET shipping_discount_type = 'percent', shipping_discount_value = 100 WHERE free_shipping <> 0 AND shipping_discount_type IS NULL;
ALTER TABLE ufersin.campaigns DROP COLUMN IF EXISTS free_shipping;
ALTER TABLE ufersin.campaigns ADD CONSTRAINT campaigns_has_discount CHECK (
  (discount_type IS NOT NULL AND discount_value IS NOT NULL) OR
  (shipping_discount_type IS NOT NULL AND shipping_discount_value IS NOT NULL)
);

ALTER TABLE ufersin.coupons DROP CONSTRAINT IF EXISTS coupons_desconto_needs_type;
ALTER TABLE ufersin.coupons DROP CONSTRAINT IF EXISTS coupons_kind_check;
ALTER TABLE ufersin.coupons ADD CONSTRAINT coupons_kind_check CHECK (kind IN ('desconto', 'frete', 'aniversario'));
ALTER TABLE ufersin.coupons ADD CONSTRAINT coupons_needs_discount CHECK (discount_type IS NOT NULL AND discount_value IS NOT NULL);

-- ─────────────────────────────────────────────────────
-- Campanhas — CRUD admin (mesmas assinaturas, corpo troca free_shipping
-- por shipping_discount_type/value)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._campaign_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'title', title, 'image_url', image_url, 'product_ids', to_jsonb(product_ids),
    'discount_type', discount_type, 'discount_value', discount_value,
    'shipping_discount_type', shipping_discount_type, 'shipping_discount_value', shipping_discount_value,
    'active', (active <> 0), 'starts_at', starts_at, 'expires_at', expires_at, 'created_at', created_at
  ) FROM ufersin.campaigns WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS ufersin.admin_create_campaign(text, text, text, text[], text, double precision, boolean, text, text);

CREATE OR REPLACE FUNCTION ufersin.admin_create_campaign(
  p_token text, p_title text, p_image_url text, p_product_ids text[],
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL, p_shipping_discount_value double precision DEFAULT NULL,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required to create a campaign';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF (p_discount_type IS NULL OR p_discount_value IS NULL) AND (p_shipping_discount_type IS NULL OR p_shipping_discount_value IS NULL) THEN
    RAISE EXCEPTION 'a campaign needs a product discount and/or a shipping discount';
  END IF;
  IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid discount_type';
  END IF;
  IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
    RAISE EXCEPTION 'percent discount must be between 0 and 100';
  END IF;
  IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
    RAISE EXCEPTION 'fixed discount must be positive';
  END IF;
  IF p_shipping_discount_type IS NOT NULL AND p_shipping_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid shipping_discount_type';
  END IF;
  IF p_shipping_discount_type = 'percent' AND (p_shipping_discount_value <= 0 OR p_shipping_discount_value > 100) THEN
    RAISE EXCEPTION 'percent shipping discount must be between 0 and 100';
  END IF;
  IF p_shipping_discount_type = 'fixed' AND p_shipping_discount_value <= 0 THEN
    RAISE EXCEPTION 'fixed shipping discount must be positive';
  END IF;
  INSERT INTO ufersin.campaigns (
    id, title, image_url, product_ids, discount_type, discount_value,
    shipping_discount_type, shipping_discount_value, starts_at, expires_at
  ) VALUES (
    v_id, trim(p_title), p_image_url, p_product_ids, p_discount_type, p_discount_value,
    p_shipping_discount_type, p_shipping_discount_value, NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), '')
  );
  RETURN ufersin._campaign_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campaign(text, text, text, text[], text, double precision, text, double precision, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_campaign(text, text, text, text, text[], text, double precision, boolean, boolean, text, text);

CREATE OR REPLACE FUNCTION ufersin.admin_update_campaign(
  p_token text, p_id text, p_title text, p_image_url text, p_product_ids text[],
  p_discount_type text, p_discount_value double precision,
  p_shipping_discount_type text, p_shipping_discount_value double precision,
  p_active boolean, p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF (p_discount_type IS NULL OR p_discount_value IS NULL) AND (p_shipping_discount_type IS NULL OR p_shipping_discount_value IS NULL) THEN
    RAISE EXCEPTION 'a campaign needs a product discount and/or a shipping discount';
  END IF;
  UPDATE ufersin.campaigns SET
    title = trim(p_title), image_url = p_image_url, product_ids = p_product_ids,
    discount_type = p_discount_type, discount_value = p_discount_value,
    shipping_discount_type = p_shipping_discount_type, shipping_discount_value = p_shipping_discount_value,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''), expires_at = NULLIF(trim(p_expires_at), '')
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found';
  END IF;
  RETURN ufersin._campaign_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campaign(text, text, text, text, text[], text, double precision, text, double precision, boolean, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.list_active_campaigns()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'title', title, 'image_url', image_url, 'product_ids', to_jsonb(product_ids),
    'discount_type', discount_type, 'discount_value', discount_value,
    'shipping_discount_type', shipping_discount_type, 'shipping_discount_value', shipping_discount_value,
    'expires_at', expires_at
  ) ORDER BY created_at DESC), '[]'::jsonb)
  FROM ufersin.campaigns
  WHERE active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION ufersin.list_active_campaigns() TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.get_campaign(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'title', title, 'image_url', image_url, 'product_ids', to_jsonb(product_ids),
    'discount_type', discount_type, 'discount_value', discount_value,
    'shipping_discount_type', shipping_discount_type, 'shipping_discount_value', shipping_discount_value,
    'expires_at', expires_at
  )
  FROM ufersin.campaigns
  WHERE id = p_id AND active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION ufersin.get_campaign(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Cupons — CRUD admin (discount_type/value passam a valer pra QUALQUER
-- kind: em 'frete' representam o desconto sobre o frete, em 'aniversario'
-- o desconto de produto liberado só no mês do aniversário do cliente)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'code', code, 'kind', kind, 'discount_type', discount_type, 'discount_value', discount_value,
    'allow_campaign_checkout', (allow_campaign_checkout <> 0), 'active', (active <> 0),
    'expires_at', expires_at, 'max_uses', max_uses, 'used_count', used_count, 'created_at', created_at
  ) FROM ufersin.coupons WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS ufersin.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint);

CREATE OR REPLACE FUNCTION ufersin.admin_create_coupon(
  p_token text, p_code text, p_kind text, p_discount_type text, p_discount_value double precision,
  p_allow_campaign_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_kind NOT IN ('desconto', 'frete', 'aniversario') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  IF p_discount_type IS NULL OR p_discount_value IS NULL THEN
    RAISE EXCEPTION 'discount_type and discount_value are required';
  END IF;
  IF p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid discount_type';
  END IF;
  IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
    RAISE EXCEPTION 'percent discount must be between 0 and 100';
  END IF;
  IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
    RAISE EXCEPTION 'fixed discount must be positive';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  BEGIN
    INSERT INTO ufersin.coupons (id, code, kind, discount_type, discount_value, allow_campaign_checkout, expires_at, max_uses)
      VALUES (v_id, v_code, p_kind, p_discount_type, p_discount_value,
        CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END, NULLIF(trim(p_expires_at), ''), p_max_uses);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;
  RETURN ufersin._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Público — validate_coupon ganha p_customer_birthdate (checa mês de
-- aniversário pra kind='aniversario')
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin.validate_coupon(text, text);

CREATE OR REPLACE FUNCTION ufersin.validate_coupon(p_code text, p_campaign_id text DEFAULT NULL, p_customer_birthdate text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_coupon ufersin.coupons%ROWTYPE;
BEGIN
  SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF v_coupon.active = 0 THEN
    RAISE EXCEPTION 'coupon is not active';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
  END IF;
  IF v_coupon.kind = 'aniversario' THEN
    IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = ''
       OR extract(month FROM p_customer_birthdate::date) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.validate_coupon(text, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- create_order — mesma assinatura de sunset_campanhas_cupons.sql, corpo
-- troca free_shipping por desconto percentual/fixo de frete e passa a
-- checar o mês de aniversário pra kind='aniversario'.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_campaign_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
DECLARE
  v_item              jsonb;
  v_product           ufersin.products%ROWTYPE;
  v_quantity          bigint;
  v_subtotal          double precision := 0;
  v_shipping          double precision := 0;
  v_discount_amount   double precision := 0;
  v_shipping_discount double precision := 0;
  v_customer_id       text;
  v_order_id          text := gen_random_uuid()::text;
  v_item_id           text;
  v_settings          ufersin.shipping_settings%ROWTYPE;
  v_km                double precision;
  v_birthdate         date;
  v_campaign          ufersin.campaigns%ROWTYPE;
  v_coupon            ufersin.coupons%ROWTYPE;
  v_coupon_code       text;
  v_total             double precision;
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_campaign_id IS NOT NULL THEN
    SELECT * INTO v_campaign FROM ufersin.campaigns WHERE id = p_campaign_id;
    IF NOT FOUND OR v_campaign.active = 0
       OR (v_campaign.starts_at IS NOT NULL AND v_campaign.starts_at::timestamptz > now())
       OR (v_campaign.expires_at IS NOT NULL AND v_campaign.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'campaign is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_campaign.product_ids))
    ) THEN
      RAISE EXCEPTION 'this campaign checkout can only contain the campaign products';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

    v_subtotal := v_subtotal + v_product.price * v_quantity;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_campaign.id IS NOT NULL THEN
    IF v_campaign.discount_type = 'percent' THEN
      v_discount_amount := v_discount_amount + round((v_subtotal * v_campaign.discount_value / 100)::numeric, 2);
    ELSIF v_campaign.discount_type = 'fixed' THEN
      v_discount_amount := v_discount_amount + v_campaign.discount_value;
    END IF;
    IF v_campaign.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_campaign.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_campaign.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_campaign.shipping_discount_value;
    END IF;
  END IF;

  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    IF v_coupon.kind = 'frete' THEN
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_discount_amount := v_discount_amount + v_coupon.discount_value;
      END IF;
    END IF;
    UPDATE ufersin.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
    v_coupon_code := v_coupon.code;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, campaign_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_campaign_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm.sql
-- ───────────────────────────────────────────────────────────────────
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
ALTER TABLE ufersin.customers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION ufersin.admin_crm_customers(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'whatsapp', c.whatsapp, 'birthdate', c.birthdate,
      'total_spent', COALESCE(stats.total_spent, 0),
      'order_count', COALESCE(stats.order_count, 0),
      'last_order_at', stats.last_order_at
    ) ORDER BY COALESCE(stats.total_spent, 0) DESC)
    FROM ufersin.customers c
    LEFT JOIN (
      SELECT customer_id, SUM(total) AS total_spent, COUNT(*) AS order_count, MAX(created_at) AS last_order_at
      FROM ufersin.orders
      WHERE payment_status = 'pago'
      GROUP BY customer_id
    ) stats ON stats.customer_id = c.id
    WHERE c.id <> 'pdv-balcao-anonimo'
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_crm_customers(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_cupom_alvo.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Cupom alvo (criado a partir de um filtro de clientes no CRM): em vez de
-- um código público que qualquer um pode digitar, fica amarrado a
-- clientes específicos (por whatsapp — a chave primária real do cliente,
-- não o nome) via ufersin.coupon_grants. Intransferível: só quem tem uma
-- concessão pra aquele cupom pode usá-lo, e cada concessão carrega quantas
-- vezes AQUELE cliente pode usar (permite conceder o mesmo código várias
-- vezes pro mesmo cliente).
--
-- Um cupom em ufersin.coupons vira "alvo" só por TER concessões associadas
-- (EXISTS coupon_grants) — não precisa de uma coluna própria pra isso.
-- =====================================================

ALTER TABLE ufersin.coupons ADD COLUMN IF NOT EXISTS notify_customers BIGINT NOT NULL DEFAULT 1;
ALTER TABLE ufersin.coupons ADD COLUMN IF NOT EXISTS combinable_with_public BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ufersin.coupon_grants (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  coupon_id         TEXT NOT NULL REFERENCES ufersin.coupons(id) ON DELETE CASCADE,
  customer_whatsapp TEXT NOT NULL,
  granted_uses      BIGINT NOT NULL DEFAULT 1,
  used_count        BIGINT NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS coupon_grants_whatsapp_idx ON ufersin.coupon_grants (customer_whatsapp);
CREATE INDEX IF NOT EXISTS coupon_grants_coupon_idx ON ufersin.coupon_grants (coupon_id);
ALTER TABLE ufersin.coupon_grants ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────
-- admin_crm_customers — mesma ideia, mas agora traz o suficiente pra
-- segmentação/filtro inteiro rodar no FRONT (escala de uma tabacaria só,
-- não precisa de função SQL paramétrica gigante pra cada combinação de
-- filtro): primeira compra, bairros onde já entregou, e cada produto
-- comprado com a data — pra filtro tipo "comprou X entre A e B".
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_crm_customers(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((
    WITH paid_orders AS (
      SELECT * FROM ufersin.orders WHERE payment_status = 'pago'
    ),
    order_stats AS (
      SELECT
        customer_id,
        SUM(total) AS total_spent,
        COUNT(*) AS order_count,
        MIN(created_at) AS first_order_at,
        MAX(created_at) AS last_order_at,
        COALESCE(jsonb_agg(DISTINCT neighborhood) FILTER (WHERE neighborhood IS NOT NULL), '[]'::jsonb) AS neighborhoods
      FROM paid_orders
      GROUP BY customer_id
    ),
    purchase_events AS (
      SELECT o.customer_id, jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'created_at', o.created_at)) AS purchases
      FROM paid_orders o
      JOIN ufersin.order_items oi ON oi.order_id = o.id
      GROUP BY o.customer_id
    )
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'whatsapp', c.whatsapp, 'birthdate', c.birthdate,
      'total_spent', COALESCE(os.total_spent, 0),
      'order_count', COALESCE(os.order_count, 0),
      'first_order_at', os.first_order_at,
      'last_order_at', os.last_order_at,
      'neighborhoods', COALESCE(os.neighborhoods, '[]'::jsonb),
      'purchases', COALESCE(pe.purchases, '[]'::jsonb)
    ) ORDER BY c.name)
    FROM ufersin.customers c
    LEFT JOIN order_stats os ON os.customer_id = c.id
    LEFT JOIN purchase_events pe ON pe.customer_id = c.id
    WHERE c.id <> 'pdv-balcao-anonimo'
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_crm_customers(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Criação de cupom alvo — cupom + concessões numa chamada só
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_create_targeted_coupon(
  p_token text,
  p_code text,
  p_kind text,
  p_discount_type text,
  p_discount_value double precision,
  p_customer_whatsapps text[],
  p_uses_per_customer bigint DEFAULT 1,
  p_notify_customers boolean DEFAULT true,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_campaign_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_whatsapp text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_kind NOT IN ('desconto', 'frete', 'aniversario') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  IF p_discount_type IS NULL OR p_discount_value IS NULL THEN
    RAISE EXCEPTION 'discount_type and discount_value are required';
  END IF;
  IF p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid discount_type';
  END IF;
  IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
    RAISE EXCEPTION 'percent discount must be between 0 and 100';
  END IF;
  IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
    RAISE EXCEPTION 'fixed discount must be positive';
  END IF;
  IF p_customer_whatsapps IS NULL OR array_length(p_customer_whatsapps, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one customer is required';
  END IF;
  IF p_uses_per_customer IS NULL OR p_uses_per_customer <= 0 THEN
    RAISE EXCEPTION 'uses_per_customer must be positive';
  END IF;

  BEGIN
    INSERT INTO ufersin.coupons (
      id, code, kind, discount_type, discount_value, allow_campaign_checkout,
      notify_customers, combinable_with_public, expires_at, max_uses
    ) VALUES (
      v_id, v_code, p_kind, p_discount_type, p_discount_value,
      CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
      CASE WHEN p_notify_customers THEN 1 ELSE 0 END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      NULLIF(trim(p_expires_at), ''), p_max_uses
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
    INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses)
      VALUES (gen_random_uuid()::text, v_id, v_whatsapp, p_uses_per_customer);
  END LOOP;

  RETURN ufersin._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_targeted_coupon(text, text, text, text, double precision, text[], bigint, boolean, boolean, boolean, text, bigint) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_list_coupon_grants(p_token text, p_coupon_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id, 'customer_whatsapp', g.customer_whatsapp, 'customer_name', c.name,
      'granted_uses', g.granted_uses, 'used_count', g.used_count
    ) ORDER BY c.name)
    FROM ufersin.coupon_grants g
    LEFT JOIN ufersin.customers c ON c.whatsapp = g.customer_whatsapp
    WHERE g.coupon_id = p_coupon_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_coupon_grants(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Checkout: descobrir cupons alvo disponíveis pro whatsapp digitado
-- (auto-aplicação, sem precisar digitar código) + validar/consumir
-- respeitando a concessão por cliente (intransferível).
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.list_customer_coupons(p_customer_whatsapp text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'allow_campaign_checkout', (c.allow_campaign_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0)
  )), '[]'::jsonb)
  FROM ufersin.coupon_grants g
  JOIN ufersin.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = p_customer_whatsapp
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at::timestamptz > now())
    AND (c.max_uses IS NULL OR c.used_count < c.max_uses);
$$;
GRANT EXECUTE ON FUNCTION ufersin.list_customer_coupons(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.validate_coupon(text, text, text);

CREATE OR REPLACE FUNCTION ufersin.validate_coupon(
  p_code text,
  p_campaign_id text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_coupon ufersin.coupons%ROWTYPE;
  v_grant  ufersin.coupon_grants%ROWTYPE;
  v_is_targeted boolean;
BEGIN
  SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF v_coupon.active = 0 THEN
    RAISE EXCEPTION 'coupon is not active';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
  END IF;
  IF v_coupon.kind = 'aniversario' THEN
    IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = ''
       OR extract(month FROM p_customer_birthdate::date) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
  IF v_is_targeted THEN
    IF p_customer_whatsapp IS NULL OR trim(p_customer_whatsapp) = '' THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
    SELECT * INTO v_grant FROM ufersin.coupon_grants
      WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value,
    'combinable_with_public', (v_coupon.combinable_with_public <> 0)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.validate_coupon(text, text, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- create_order — mesma assinatura de sunset_campanhas_frete_aniversario.sql,
-- corpo passa a checar concessão (intransferível) quando o cupom é alvo, e
-- consome a concessão específica em vez do contador global do cupom.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_campaign_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
DECLARE
  v_item              jsonb;
  v_product           ufersin.products%ROWTYPE;
  v_quantity          bigint;
  v_subtotal          double precision := 0;
  v_shipping          double precision := 0;
  v_discount_amount   double precision := 0;
  v_shipping_discount double precision := 0;
  v_customer_id       text;
  v_order_id          text := gen_random_uuid()::text;
  v_item_id           text;
  v_settings          ufersin.shipping_settings%ROWTYPE;
  v_km                double precision;
  v_birthdate         date;
  v_campaign          ufersin.campaigns%ROWTYPE;
  v_coupon            ufersin.coupons%ROWTYPE;
  v_coupon_code       text;
  v_grant             ufersin.coupon_grants%ROWTYPE;
  v_is_targeted       boolean;
  v_total             double precision;
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_campaign_id IS NOT NULL THEN
    SELECT * INTO v_campaign FROM ufersin.campaigns WHERE id = p_campaign_id;
    IF NOT FOUND OR v_campaign.active = 0
       OR (v_campaign.starts_at IS NOT NULL AND v_campaign.starts_at::timestamptz > now())
       OR (v_campaign.expires_at IS NOT NULL AND v_campaign.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'campaign is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_campaign.product_ids))
    ) THEN
      RAISE EXCEPTION 'this campaign checkout can only contain the campaign products';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

    v_subtotal := v_subtotal + v_product.price * v_quantity;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_campaign.id IS NOT NULL THEN
    IF v_campaign.discount_type = 'percent' THEN
      v_discount_amount := v_discount_amount + round((v_subtotal * v_campaign.discount_value / 100)::numeric, 2);
    ELSIF v_campaign.discount_type = 'fixed' THEN
      v_discount_amount := v_discount_amount + v_campaign.discount_value;
    END IF;
    IF v_campaign.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_campaign.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_campaign.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_campaign.shipping_discount_value;
    END IF;
  END IF;

  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    -- cupom alvo (veio de um filtro no CRM): só vale pra quem tem
    -- concessão de verdade — intransferível, não é só o código que
    -- importa. Consome a concessão específica do cliente, não o contador
    -- global do cupom (que continua existindo só como teto opcional).
    SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM ufersin.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE ufersin.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;

    IF v_coupon.kind = 'frete' THEN
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_discount_amount := v_discount_amount + v_coupon.discount_value;
      END IF;
    END IF;
    UPDATE ufersin.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
    v_coupon_code := v_coupon.code;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, campaign_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_campaign_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_coupon_grant_count.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- _coupon_json passa a trazer grant_count — só assim o front consegue
-- distinguir "cupom avulso" (grant_count = 0, qualquer um pode digitar)
-- de "cupom alvo" (grant_count > 0, só quem tem concessão pode usar) na
-- listagem, sem precisar de uma chamada extra por cupom.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'allow_campaign_checkout', (c.allow_campaign_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'active', (c.active <> 0),
    'expires_at', c.expires_at, 'max_uses', c.max_uses, 'used_count', c.used_count, 'created_at', c.created_at,
    'grant_count', (SELECT COUNT(*) FROM ufersin.coupon_grants g WHERE g.coupon_id = c.id)
  ) FROM ufersin.coupons c WHERE c.id = p_id;
$$;

-- ───────────────────────────────────────────────────────────────────
-- sunset_financeiro_desconto.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- admin_financeiro ganha total_discount_given: soma de discount_amount +
-- shipping_discount de todo pedido pago — quanto o lojista "abriu mão"
-- em campanha/cupom. total_revenue já é o valor líquido (depois do
-- desconto), então total_revenue + total_discount_given = quanto teria
-- sido faturado sem nenhuma promoção.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.admin_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_total_revenue double precision;
  v_total_discount_given double precision;
  v_total_orders bigint;
  v_status_counts jsonb;
  v_top_products jsonb;
  v_recent_orders jsonb;
  v_motoboys jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);

  SELECT COALESCE(SUM(total), 0), COALESCE(SUM(discount_amount + shipping_discount), 0)
    INTO v_total_revenue, v_total_discount_given
    FROM ufersin.orders WHERE payment_status = 'pago';
  SELECT COUNT(*) INTO v_total_orders FROM ufersin.orders;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', cnt)), '[]'::jsonb)
    INTO v_status_counts
    FROM (SELECT status, COUNT(*) AS cnt FROM ufersin.orders GROUP BY status) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'product_name', product_name,
      'quantity_sold', qty, 'revenue', rev
    ) ORDER BY qty DESC), '[]'::jsonb)
    INTO v_top_products
    FROM (
      SELECT oi.product_id, oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.unit_price * oi.quantity) AS rev
      FROM ufersin.order_items oi JOIN ufersin.orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'pago'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY qty DESC LIMIT 10
    ) t;

  SELECT COALESCE(jsonb_agg(ufersin.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_recent_orders
    FROM (SELECT id, created_at FROM ufersin.orders ORDER BY created_at DESC LIMIT 20) o;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name,
      'total_deliveries', d.cnt, 'total_shipping', d.total_shipping,
      'pending_amount', p.amount,
      'total_paid', COALESCE(s.total_paid, 0),
      'avg_delivery_minutes', round(COALESCE(ufersin._avg_delivery_minutes(m.id), 0)::numeric, 1)
    ) ORDER BY m.name), '[]'::jsonb)
    INTO v_motoboys
    FROM ufersin.motoboys m
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(o.shipping_price), 0) AS total_shipping
      FROM ufersin.orders o
      WHERE o.motoboy_id = m.id AND o.status = 'concluido' AND o.delivery_type = 'entrega'
    ) d ON true
    LEFT JOIN LATERAL (SELECT * FROM ufersin._motoboy_pending(m.id)) p ON true
    LEFT JOIN LATERAL (
      SELECT SUM(amount) AS total_paid FROM ufersin.motoboy_settlements WHERE motoboy_id = m.id
    ) s ON true;

  RETURN jsonb_build_object(
    'total_revenue', v_total_revenue,
    'total_discount_given', v_total_discount_given,
    'total_orders', v_total_orders,
    'orders_by_status', v_status_counts,
    'top_products', v_top_products,
    'recent_orders', v_recent_orders,
    'motoboys', v_motoboys,
    'avg_delivery_minutes', round(COALESCE(ufersin._avg_delivery_minutes(NULL), 0)::numeric, 1)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_financeiro(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_comissao_origem_pedido.sql
-- ───────────────────────────────────────────────────────────────────
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

ALTER TABLE ufersin.vendedores ADD COLUMN IF NOT EXISTS commission_active BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ufersin.vendedores ADD COLUMN IF NOT EXISTS commission_percent DOUBLE PRECISION;

CREATE OR REPLACE FUNCTION ufersin._vendedor_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'email', email, 'active', (active <> 0),
    'commission_active', (commission_active <> 0), 'commission_percent', commission_percent
  )
  FROM ufersin.vendedores WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS ufersin.admin_create_vendedor(text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.admin_create_vendedor(
  p_token text, p_name text, p_email text, p_password text,
  p_commission_active boolean DEFAULT false, p_commission_percent double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
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
    INSERT INTO ufersin.vendedores (id, name, email, password_hash, commission_active, commission_percent)
      VALUES (
        v_id, p_name, p_email, crypt(p_password, gen_salt('bf')),
        CASE WHEN p_commission_active THEN 1 ELSE 0 END,
        CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
      );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN ufersin._vendedor_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_vendedor(text, text, text, text, boolean, double precision) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_vendedor(text, text, text, text, boolean, text);

CREATE OR REPLACE FUNCTION ufersin.admin_update_vendedor(
  p_token text, p_id text, p_name text, p_email text, p_active boolean DEFAULT true, p_password text DEFAULT NULL,
  p_commission_active boolean DEFAULT false, p_commission_percent double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_commission_active AND (p_commission_percent IS NULL OR p_commission_percent <= 0 OR p_commission_percent > 100) THEN
    RAISE EXCEPTION 'commission_percent must be between 0 and 100';
  END IF;
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE ufersin.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      password_hash = crypt(p_password, gen_salt('bf')),
      commission_active = CASE WHEN p_commission_active THEN 1 ELSE 0 END,
      commission_percent = CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
    WHERE id = p_id;
  ELSE
    UPDATE ufersin.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      commission_active = CASE WHEN p_commission_active THEN 1 ELSE 0 END,
      commission_percent = CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendedor not found';
  END IF;
  RETURN ufersin._vendedor_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_vendedor(text, text, text, text, boolean, text, boolean, double precision) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Origem do pedido — admin-only, nunca no get_order público
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._get_order_admin(p_order_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT ufersin.get_order(p_order_id) || jsonb_build_object(
    'sold_by_role', o.sold_by_role,
    'sold_by_id', o.sold_by_id,
    'sold_by_name', CASE
      WHEN o.sold_by_role = 'vendedor' THEN v.name
      WHEN o.sold_by_role = 'admin' THEN 'Admin'
      ELSE NULL
    END
  )
  FROM ufersin.orders o
  LEFT JOIN ufersin.vendedores v ON v.id = o.sold_by_id AND o.sold_by_role = 'vendedor'
  WHERE o.id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_list_orders(p_token text, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin_or_vendedor(p_token);
  RETURN COALESCE(
    (SELECT jsonb_agg(ufersin._get_order_admin(o.id) ORDER BY o.created_at DESC)
     FROM ufersin.orders o
     WHERE p_status IS NULL OR o.status = p_status),
    '[]'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_orders(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_order_status(p_token text, p_order_id text, p_status text, p_payment_confirmed boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_order ufersin.orders%ROWTYPE;
  v_set_paid boolean;
BEGIN
  PERFORM ufersin._require_admin_or_vendedor(p_token);
  SELECT * INTO v_order FROM ufersin.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_set_paid := ufersin._admin_apply_transition(
    v_order.status, p_status, v_order.delivery_type, v_order.payment_method, v_order.payment_status, p_payment_confirmed
  );

  IF v_set_paid THEN
    UPDATE ufersin.orders SET status = p_status, payment_status = 'pago', updated_at = now()::text WHERE id = p_order_id;
  ELSE
    UPDATE ufersin.orders SET status = p_status, updated_at = now()::text WHERE id = p_order_id;
  END IF;

  RETURN ufersin._get_order_admin(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_order_status(text, text, text, boolean) TO anon, authenticated;

-- create_order (checkout do site) sempre grava sold_by_role/sold_by_id
-- como NULL — só pdv_create_sale preenche. Reforça isso não é enforcement
-- novo, só documentação: nenhuma mudança de corpo necessária aqui.

-- vendedor_relatorio ganha sold_by_id/sold_by_name em cada venda — permite
-- o financeiro agrupar por vendedor no front (abas "fulano"/"desempenho
-- geral") sem precisar de uma RPC por vendedor.
CREATE OR REPLACE FUNCTION ufersin.vendedor_relatorio(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_subject     text;
  v_role        text;
  v_total_sales double precision;
  v_total_count bigint;
  v_sales       jsonb;
BEGIN
  SELECT * INTO v_subject, v_role FROM ufersin._require_admin_or_vendedor(p_token);

  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_total_sales, v_total_count
    FROM ufersin.orders
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
        )) FROM ufersin.order_items oi WHERE oi.order_id = o.id
      ), '[]'::jsonb)
    ) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_sales
    FROM (
      SELECT * FROM ufersin.orders
      WHERE delivery_type = 'balcao'
        AND (v_role = 'admin' OR (sold_by_role = 'vendedor' AND sold_by_id = v_subject))
      ORDER BY created_at DESC
      LIMIT 100
    ) o
    LEFT JOIN ufersin.vendedores v ON v.id = o.sold_by_id AND o.sold_by_role = 'vendedor';

  RETURN jsonb_build_object('total_sales', v_total_sales, 'total_count', v_total_count, 'sales', v_sales);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.vendedor_relatorio(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_filtros_v2.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- admin_crm_customers ganha, por cliente:
-- - orders: [{total, created_at}] (pedidos pagos, um por pedido — não item
--   por item como "purchases") — alimenta os filtros "gastou acima/abaixo
--   de R$X em Y dias" e "reduziu a frequência de compra em X%".
-- - distance_km: distância (haversine) do endereço de entrega mais recente
--   até a loja, calculada AQUI (as coordenadas da loja nunca saem do
--   banco/backend) — alimenta "distância de no máximo Xkm".
-- - total_items: soma de quantidade de itens comprados (não nº de pedidos)
--   — alimenta "maior volume de compras".
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.admin_crm_customers(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_settings ufersin.shipping_settings%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;

  RETURN COALESCE((
    WITH paid_orders AS (
      SELECT * FROM ufersin.orders WHERE payment_status = 'pago'
    ),
    order_stats AS (
      SELECT
        customer_id,
        SUM(total) AS total_spent,
        COUNT(*) AS order_count,
        MIN(created_at) AS first_order_at,
        MAX(created_at) AS last_order_at,
        COALESCE(jsonb_agg(DISTINCT neighborhood) FILTER (WHERE neighborhood IS NOT NULL), '[]'::jsonb) AS neighborhoods,
        COALESCE(jsonb_agg(jsonb_build_object('total', total, 'created_at', created_at) ORDER BY created_at DESC), '[]'::jsonb) AS orders
      FROM paid_orders
      GROUP BY customer_id
    ),
    purchase_events AS (
      SELECT o.customer_id,
        jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'created_at', o.created_at)) AS purchases,
        SUM(oi.quantity) AS total_items
      FROM paid_orders o
      JOIN ufersin.order_items oi ON oi.order_id = o.id
      GROUP BY o.customer_id
    ),
    last_location AS (
      SELECT DISTINCT ON (customer_id) customer_id, customer_lat, customer_lng
      FROM paid_orders
      WHERE customer_lat IS NOT NULL AND customer_lng IS NOT NULL
      ORDER BY customer_id, created_at DESC
    )
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'whatsapp', c.whatsapp, 'birthdate', c.birthdate,
      'total_spent', COALESCE(os.total_spent, 0),
      'order_count', COALESCE(os.order_count, 0),
      'total_items', COALESCE(pe.total_items, 0),
      'first_order_at', os.first_order_at,
      'last_order_at', os.last_order_at,
      'neighborhoods', COALESCE(os.neighborhoods, '[]'::jsonb),
      'purchases', COALESCE(pe.purchases, '[]'::jsonb),
      'orders', COALESCE(os.orders, '[]'::jsonb),
      'distance_km', CASE WHEN ll.customer_lat IS NULL THEN NULL
        ELSE round(ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, ll.customer_lat, ll.customer_lng)::numeric, 1)
      END
    ) ORDER BY c.name)
    FROM ufersin.customers c
    LEFT JOIN order_stats os ON os.customer_id = c.id
    LEFT JOIN purchase_events pe ON pe.customer_id = c.id
    LEFT JOIN last_location ll ON ll.customer_id = c.id
    WHERE c.id <> 'pdv-balcao-anonimo'
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_crm_customers(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_cupom_exclusivo_v2.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Cupom exclusivo (CRM) deixa de ser um "kind" único e vira composicional:
-- o admin pode combinar desconto no frete com desconto no produto (seja
-- flat sobre o total, seja por produto específico) no MESMO cupom. Tipo
-- 'aniversario' sai do formulário de cupom exclusivo (isso já é feito
-- via segmentação na lista do CRM) — continua existindo só pra cupom
-- avulso, que não muda.
--
-- coupons.discount_type/discount_value continuam com o significado
-- ANTIGO pra kind='frete' (era a única forma de desconto de frete antes
-- de hoje — cupom avulso 'frete' não muda). Pra kind='desconto'/'produto',
-- passam a significar SÓ o desconto flat sobre o produto; o desconto de
-- frete adicional (quando combinado) mora nos campos novos
-- shipping_discount_type/shipping_discount_value. kind='produto' ignora
-- discount_type/value (usa coupon_product_discounts em vez disso).
-- =====================================================

ALTER TABLE ufersin.coupons ADD COLUMN IF NOT EXISTS shipping_discount_type TEXT CHECK (shipping_discount_type IN ('percent', 'fixed'));
ALTER TABLE ufersin.coupons ADD COLUMN IF NOT EXISTS shipping_discount_value DOUBLE PRECISION;

ALTER TABLE ufersin.coupons DROP CONSTRAINT IF EXISTS coupons_kind_check;
ALTER TABLE ufersin.coupons ADD CONSTRAINT coupons_kind_check CHECK (kind IN ('desconto', 'frete', 'aniversario', 'produto'));
ALTER TABLE ufersin.coupons DROP CONSTRAINT IF EXISTS coupons_needs_discount;
ALTER TABLE ufersin.coupons ADD CONSTRAINT coupons_needs_discount CHECK (
  kind = 'produto' OR (discount_type IS NOT NULL AND discount_value IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS ufersin.coupon_product_discounts (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  coupon_id      TEXT NOT NULL REFERENCES ufersin.coupons(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES ufersin.products(id),
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS coupon_product_discounts_coupon_idx ON ufersin.coupon_product_discounts (coupon_id);
ALTER TABLE ufersin.coupon_product_discounts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION ufersin._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_campaign_checkout', (c.allow_campaign_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'active', (c.active <> 0),
    'expires_at', c.expires_at, 'max_uses', c.max_uses, 'used_count', c.used_count, 'created_at', c.created_at,
    'grant_count', (SELECT COUNT(*) FROM ufersin.coupon_grants g WHERE g.coupon_id = c.id),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  ) FROM ufersin.coupons c WHERE c.id = p_id;
$$;

-- ─────────────────────────────────────────────────────
-- Criação de cupom exclusivo — composicional agora
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin.admin_create_targeted_coupon(text, text, text, text, double precision, text[], bigint, boolean, boolean, boolean, text, bigint);

CREATE OR REPLACE FUNCTION ufersin.admin_create_targeted_coupon(
  p_token text,
  p_code text,
  p_customer_whatsapps text[],
  p_uses_per_customer bigint DEFAULT 1,
  p_notify_customers boolean DEFAULT true,
  p_custom_message text DEFAULT NULL,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_campaign_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_whatsapp text;
  v_kind text;
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_customer_whatsapps IS NULL OR array_length(p_customer_whatsapps, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one customer is required';
  END IF;
  IF p_uses_per_customer IS NULL OR p_uses_per_customer <= 0 THEN
    RAISE EXCEPTION 'uses_per_customer must be positive';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a targeted coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;

  IF v_has_products THEN
    v_kind := 'produto';
  ELSIF p_discount_type IS NOT NULL THEN
    v_kind := 'desconto';
  ELSE
    v_kind := 'frete';
  END IF;

  IF p_discount_type IS NOT NULL THEN
    IF p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;
  IF p_shipping_discount_type IS NOT NULL THEN
    IF p_shipping_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid shipping_discount_type';
    END IF;
    IF p_shipping_discount_type = 'percent' AND (p_shipping_discount_value <= 0 OR p_shipping_discount_value > 100) THEN
      RAISE EXCEPTION 'percent shipping discount must be between 0 and 100';
    END IF;
    IF p_shipping_discount_type = 'fixed' AND p_shipping_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed shipping discount must be positive';
    END IF;
  END IF;

  BEGIN
    IF v_kind = 'frete' THEN
      -- frete-only: reaproveita discount_type/value com o significado
      -- ANTIGO (é a própria taxa de frete), igual cupom avulso 'frete'.
      INSERT INTO ufersin.coupons (
        id, code, kind, discount_type, discount_value, allow_campaign_checkout,
        notify_customers, combinable_with_public, expires_at, max_uses
      ) VALUES (
        v_id, v_code, 'frete', p_shipping_discount_type, p_shipping_discount_value,
        CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
        CASE WHEN p_notify_customers THEN 1 ELSE 0 END,
        CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
    ELSE
      INSERT INTO ufersin.coupons (
        id, code, kind, discount_type, discount_value,
        shipping_discount_type, shipping_discount_value, allow_campaign_checkout,
        notify_customers, combinable_with_public, expires_at, max_uses
      ) VALUES (
        v_id, v_code, v_kind, p_discount_type, p_discount_value,
        p_shipping_discount_type, p_shipping_discount_value,
        CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
        CASE WHEN p_notify_customers THEN 1 ELSE 0 END,
        CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (
          gen_random_uuid()::text, v_id, v_pd->>'product_id',
          v_pd->>'discount_type', (v_pd->>'discount_value')::double precision
        );
    END LOOP;
  END IF;

  FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
    INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses)
      VALUES (gen_random_uuid()::text, v_id, v_whatsapp, p_uses_per_customer);
  END LOOP;

  RETURN ufersin._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_targeted_coupon(text, text, text[], bigint, boolean, text, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- list_customer_coupons (auto-detecção no checkout) ganha os mesmos campos
-- novos de validate_coupon, pro checkout aplicar certo sem precisar digitar
-- código.
CREATE OR REPLACE FUNCTION ufersin.list_customer_coupons(p_customer_whatsapp text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_campaign_checkout', (c.allow_campaign_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  FROM ufersin.coupon_grants g
  JOIN ufersin.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = p_customer_whatsapp
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at::timestamptz > now())
    AND (c.max_uses IS NULL OR c.used_count < c.max_uses);
$$;

-- ─────────────────────────────────────────────────────
-- validate_coupon e create_order passam a considerar shipping_discount_*
-- (independente do kind) e coupon_product_discounts (kind='produto').
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin.validate_coupon(text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.validate_coupon(
  p_code text,
  p_campaign_id text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_coupon ufersin.coupons%ROWTYPE;
  v_is_targeted boolean;
BEGIN
  SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF v_coupon.active = 0 THEN
    RAISE EXCEPTION 'coupon is not active';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
  END IF;
  IF v_coupon.kind = 'aniversario' THEN
    IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = ''
       OR extract(month FROM p_customer_birthdate::date) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
  IF v_is_targeted THEN
    IF p_customer_whatsapp IS NULL OR trim(p_customer_whatsapp) = '' THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM ufersin.coupon_grants
      WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
    ) THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value,
    'shipping_discount_type', v_coupon.shipping_discount_type, 'shipping_discount_value', v_coupon.shipping_discount_value,
    'combinable_with_public', (v_coupon.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = v_coupon.id
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.validate_coupon(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_campaign_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
DECLARE
  v_item              jsonb;
  v_product           ufersin.products%ROWTYPE;
  v_quantity          bigint;
  v_subtotal          double precision := 0;
  v_shipping          double precision := 0;
  v_discount_amount   double precision := 0;
  v_shipping_discount double precision := 0;
  v_customer_id       text;
  v_order_id          text := gen_random_uuid()::text;
  v_item_id           text;
  v_settings          ufersin.shipping_settings%ROWTYPE;
  v_km                double precision;
  v_birthdate         date;
  v_campaign          ufersin.campaigns%ROWTYPE;
  v_coupon            ufersin.coupons%ROWTYPE;
  v_coupon_code       text;
  v_grant             ufersin.coupon_grants%ROWTYPE;
  v_is_targeted       boolean;
  v_pd                ufersin.coupon_product_discounts%ROWTYPE;
  v_item_total        double precision;
  v_total             double precision;
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_campaign_id IS NOT NULL THEN
    SELECT * INTO v_campaign FROM ufersin.campaigns WHERE id = p_campaign_id;
    IF NOT FOUND OR v_campaign.active = 0
       OR (v_campaign.starts_at IS NOT NULL AND v_campaign.starts_at::timestamptz > now())
       OR (v_campaign.expires_at IS NOT NULL AND v_campaign.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'campaign is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_campaign.product_ids))
    ) THEN
      RAISE EXCEPTION 'this campaign checkout can only contain the campaign products';
    END IF;
  END IF;

  -- resolve o cupom cedo (antes do loop de itens) só pra saber, no caso
  -- kind='produto', quais itens têm desconto específico
  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM ufersin.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE ufersin.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;
    v_coupon_code := v_coupon.code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

    v_item_total := v_product.price * v_quantity;
    v_subtotal := v_subtotal + v_item_total;

    -- cupom kind='produto': desconto específico por item, se esse produto
    -- estiver na lista do cupom
    IF v_coupon.kind = 'produto' THEN
      SELECT * INTO v_pd FROM ufersin.coupon_product_discounts
        WHERE coupon_id = v_coupon.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_pd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_pd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_pd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_campaign.id IS NOT NULL THEN
    IF v_campaign.discount_type = 'percent' THEN
      v_discount_amount := v_discount_amount + round((v_subtotal * v_campaign.discount_value / 100)::numeric, 2);
    ELSIF v_campaign.discount_type = 'fixed' THEN
      v_discount_amount := v_discount_amount + v_campaign.discount_value;
    END IF;
    IF v_campaign.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_campaign.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_campaign.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_campaign.shipping_discount_value;
    END IF;
  END IF;

  IF v_coupon.id IS NOT NULL THEN
    IF v_coupon.kind = 'frete' THEN
      -- frete-only: discount_type/value É a taxa de frete (significado antigo)
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.kind = 'desconto' AND v_coupon.discount_type IS NOT NULL THEN
        IF v_coupon.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + v_coupon.discount_value;
        END IF;
      END IF;
      -- kind='produto' já foi somado no loop de itens acima
      IF v_coupon.shipping_discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.shipping_discount_value / 100)::numeric, 2);
      ELSIF v_coupon.shipping_discount_type = 'fixed' THEN
        v_shipping_discount := v_shipping_discount + v_coupon.shipping_discount_value;
      END IF;
    END IF;
    UPDATE ufersin.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, campaign_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_campaign_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_cupom_produto_promocao.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Cupom avulso (público) ganha o kind='produto' também (antes só cupom
-- exclusivo tinha) — produto(s) com desconto próprio, sem precisar
-- digitar código: aparecem destacados em /catalogo na categoria
-- "Promoção", com o desconto já visível (preço original riscado + preço
-- final) e aplicado automaticamente no checkout assim que o produto entra
-- no carrinho.
-- =====================================================

DROP FUNCTION IF EXISTS ufersin.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint);

CREATE OR REPLACE FUNCTION ufersin.admin_create_coupon(
  p_token text, p_code text, p_kind text, p_discount_type text, p_discount_value double precision,
  p_allow_campaign_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_kind NOT IN ('desconto', 'frete', 'aniversario', 'produto') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  IF p_kind = 'produto' THEN
    IF NOT v_has_products THEN
      RAISE EXCEPTION 'at least one product is required for kind=produto';
    END IF;
  ELSE
    IF p_discount_type IS NULL OR p_discount_value IS NULL THEN
      RAISE EXCEPTION 'discount_type and discount_value are required';
    END IF;
    IF p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  BEGIN
    INSERT INTO ufersin.coupons (id, code, kind, discount_type, discount_value, allow_campaign_checkout, expires_at, max_uses)
      VALUES (
        v_id, v_code, p_kind,
        CASE WHEN p_kind = 'produto' THEN NULL ELSE p_discount_type END,
        CASE WHEN p_kind = 'produto' THEN NULL ELSE p_discount_value END,
        CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (
          gen_random_uuid()::text, v_id, v_pd->>'product_id',
          v_pd->>'discount_type', (v_pd->>'discount_value')::double precision
        );
    END LOOP;
  END IF;

  RETURN ufersin._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint, jsonb) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Catálogo público: produtos em promoção (cupom avulso kind='produto',
-- sem concessão = qualquer cliente vê e aproveita) — categoria "Promoção".
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.list_promotional_products()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', pd.product_id, 'coupon_code', c.code,
    'discount_type', pd.discount_type, 'discount_value', pd.discount_value
  )), '[]'::jsonb)
  FROM ufersin.coupon_product_discounts pd
  JOIN ufersin.coupons c ON c.id = pd.coupon_id
  WHERE c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at::timestamptz > now())
    AND (c.max_uses IS NULL OR c.used_count < c.max_uses)
    AND NOT EXISTS (SELECT 1 FROM ufersin.coupon_grants g WHERE g.coupon_id = c.id);
$$;
GRANT EXECUTE ON FUNCTION ufersin.list_promotional_products() TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_financeiro_timeseries.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Série temporal (últimos N dias) pro gráfico do financeiro: quantidade
-- vendida por dia, faturamento por dia, e uso de cupom/campanha por dia
-- (contagem de pedidos + desconto concedido) — o front pluga isso num
-- gráfico com checkbox "cupom"/"campanha" pra ligar/desligar cada série.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.admin_financeiro_timeseries(p_token text, p_days bigint DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_days bigint := GREATEST(LEAST(COALESCE(p_days, 30), 180), 1);
  v_result jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);

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
      FROM ufersin.orders
      WHERE payment_status = 'pago' AND created_at::date = d.day::date
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT SUM(oi.quantity) AS qty
      FROM ufersin.order_items oi JOIN ufersin.orders ord ON ord.id = oi.order_id
      WHERE ord.payment_status = 'pago' AND ord.created_at::date = d.day::date
    ) q ON true;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_financeiro_timeseries(text, bigint) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_campanhas_selfie_kit.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Diferenciação de campanha "selfie service" (cliente monta o próprio
-- carrinho a partir dos itens da campanha, em /banner, cada produto com
-- seu desconto próprio) vs "kit" (pacote fechado — ou compra tudo, ou não
-- compra nada — desconto único sobre o valor total somado).
--
-- kit: mantém discount_type/discount_value existentes (desconto sobre
-- v_subtotal) — "Desconto no valor total". O checkout só aceita o pedido
-- se ele contiver EXATAMENTE todos os produtos da campanha.
-- selfie_service: desconto por produto (campaign_product_discounts,
-- mesma forma de coupon_product_discounts) — "Desconto no produto". O
-- checkout aceita qualquer subconjunto não vazio dos produtos da campanha.
-- =====================================================

ALTER TABLE ufersin.campaigns ADD COLUMN IF NOT EXISTS campaign_type TEXT NOT NULL DEFAULT 'kit' CHECK (campaign_type IN ('selfie_service', 'kit'));

CREATE TABLE IF NOT EXISTS ufersin.campaign_product_discounts (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campaign_id    TEXT NOT NULL REFERENCES ufersin.campaigns(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES ufersin.products(id),
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS campaign_product_discounts_campaign_idx ON ufersin.campaign_product_discounts (campaign_id);
ALTER TABLE ufersin.campaign_product_discounts ENABLE ROW LEVEL SECURITY;

-- kit precisa do desconto de valor total; selfie_service precisa de pelo
-- menos um produto com desconto cadastrado (checado no INSERT, não dá pra
-- expressar isso num CHECK simples porque envolve outra tabela).
ALTER TABLE ufersin.campaigns DROP CONSTRAINT IF EXISTS campaigns_has_discount;
ALTER TABLE ufersin.campaigns ADD CONSTRAINT campaigns_has_discount CHECK (
  campaign_type = 'selfie_service'
  OR (discount_type IS NOT NULL AND discount_value IS NOT NULL)
  OR (shipping_discount_type IS NOT NULL AND shipping_discount_value IS NOT NULL)
);

CREATE OR REPLACE FUNCTION ufersin._campaign_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'title', c.title, 'image_url', c.image_url, 'product_ids', to_jsonb(c.product_ids),
    'campaign_type', c.campaign_type,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'active', (c.active <> 0), 'starts_at', c.starts_at, 'expires_at', c.expires_at, 'created_at', c.created_at,
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.campaign_product_discounts pd WHERE pd.campaign_id = c.id
    ), '[]'::jsonb)
  ) FROM ufersin.campaigns c WHERE c.id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_list_campaigns(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(ufersin._campaign_json(id) ORDER BY created_at DESC) FROM ufersin.campaigns), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_campaigns(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_create_campaign(text, text, text, text[], text, double precision, text, double precision, text, text);

CREATE OR REPLACE FUNCTION ufersin.admin_create_campaign(
  p_token text, p_title text, p_image_url text, p_product_ids text[],
  p_campaign_type text DEFAULT 'kit',
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL, p_shipping_discount_value double precision DEFAULT NULL,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required to create a campaign';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF p_campaign_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid campaign_type';
  END IF;
  IF p_campaign_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service campaign';
    END IF;
  ELSE
    IF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
      RAISE EXCEPTION 'a kit campaign needs a product discount and/or a shipping discount';
    END IF;
    IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;

  INSERT INTO ufersin.campaigns (
    id, title, image_url, product_ids, campaign_type, discount_type, discount_value,
    shipping_discount_type, shipping_discount_value, starts_at, expires_at
  ) VALUES (
    v_id, trim(p_title), p_image_url, p_product_ids, p_campaign_type,
    CASE WHEN p_campaign_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    CASE WHEN p_campaign_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    p_shipping_discount_type, p_shipping_discount_value,
    NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), '')
  );

  IF p_campaign_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.campaign_product_discounts (id, campaign_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN ufersin._campaign_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campaign(text, text, text, text[], text, text, double precision, text, double precision, text, text, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_campaign(text, text, text, text, text[], text, double precision, text, double precision, boolean, text, text);

CREATE OR REPLACE FUNCTION ufersin.admin_update_campaign(
  p_token text, p_id text, p_title text, p_image_url text, p_product_ids text[],
  p_campaign_type text,
  p_discount_type text, p_discount_value double precision,
  p_shipping_discount_type text, p_shipping_discount_value double precision,
  p_active boolean,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF p_campaign_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid campaign_type';
  END IF;
  IF p_campaign_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service campaign';
    END IF;
  ELSIF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a kit campaign needs a product discount and/or a shipping discount';
  END IF;

  UPDATE ufersin.campaigns SET
    title = trim(p_title), image_url = p_image_url, product_ids = p_product_ids,
    campaign_type = p_campaign_type,
    discount_type = CASE WHEN p_campaign_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    discount_value = CASE WHEN p_campaign_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    shipping_discount_type = p_shipping_discount_type, shipping_discount_value = p_shipping_discount_value,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''), expires_at = NULLIF(trim(p_expires_at), '')
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found';
  END IF;

  DELETE FROM ufersin.campaign_product_discounts WHERE campaign_id = p_id;
  IF p_campaign_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.campaign_product_discounts (id, campaign_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN ufersin._campaign_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campaign(text, text, text, text, text[], text, text, double precision, text, double precision, boolean, text, text, jsonb) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Público — carrossel/banner + checkout
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.list_active_campaigns()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT COALESCE(jsonb_agg(ufersin._campaign_json(id) ORDER BY created_at DESC), '[]'::jsonb)
  FROM ufersin.campaigns
  WHERE active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION ufersin.list_active_campaigns() TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.get_campaign(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT ufersin._campaign_json(id)
  FROM ufersin.campaigns
  WHERE id = p_id AND active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION ufersin.get_campaign(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- create_order: kit exige o pacote completo (nem mais, nem menos produtos
-- distintos que a campanha); selfie_service aceita qualquer subconjunto e
-- usa desconto por produto (campaign_product_discounts) em vez do
-- desconto sobre o valor total.
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text,
  p_address text,
  p_items jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_campaign_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_item               jsonb;
  v_product            ufersin.products%ROWTYPE;
  v_quantity           bigint;
  v_subtotal           double precision := 0;
  v_shipping           double precision := 0;
  v_discount_amount    double precision := 0;
  v_shipping_discount  double precision := 0;
  v_customer_id        text;
  v_order_id           text := gen_random_uuid()::text;
  v_item_id            text;
  v_settings           ufersin.shipping_settings%ROWTYPE;
  v_km                 double precision;
  v_birthdate          date;
  v_campaign           ufersin.campaigns%ROWTYPE;
  v_coupon             ufersin.coupons%ROWTYPE;
  v_coupon_code        text;
  v_grant              ufersin.coupon_grants%ROWTYPE;
  v_is_targeted        boolean;
  v_pd                 ufersin.coupon_product_discounts%ROWTYPE;
  v_cpd                ufersin.campaign_product_discounts%ROWTYPE;
  v_item_total         double precision;
  v_total              double precision;
  v_submitted_ids      text[];
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_campaign_id IS NOT NULL THEN
    SELECT * INTO v_campaign FROM ufersin.campaigns WHERE id = p_campaign_id;
    IF NOT FOUND OR v_campaign.active = 0
       OR (v_campaign.starts_at IS NOT NULL AND v_campaign.starts_at::timestamptz > now())
       OR (v_campaign.expires_at IS NOT NULL AND v_campaign.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'campaign is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_campaign.product_ids))
    ) THEN
      RAISE EXCEPTION 'this campaign checkout can only contain the campaign products';
    END IF;
    IF v_campaign.campaign_type = 'kit' THEN
      SELECT array_agg(DISTINCT i->>'product_id') INTO v_submitted_ids FROM jsonb_array_elements(p_items) i;
      IF v_submitted_ids IS NULL OR array_length(v_submitted_ids, 1) <> array_length(v_campaign.product_ids, 1)
         OR NOT (v_submitted_ids @> v_campaign.product_ids) THEN
        RAISE EXCEPTION 'this kit campaign can only be purchased as the full bundle';
      END IF;
    END IF;
  END IF;

  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_campaign_id IS NOT NULL AND v_coupon.allow_campaign_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a campaign checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM ufersin.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE ufersin.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;
    v_coupon_code := v_coupon.code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

    v_item_total := v_product.price * v_quantity;
    v_subtotal := v_subtotal + v_item_total;

    IF v_coupon.kind = 'produto' THEN
      SELECT * INTO v_pd FROM ufersin.coupon_product_discounts
        WHERE coupon_id = v_coupon.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_pd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_pd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_pd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;

    IF v_campaign.id IS NOT NULL AND v_campaign.campaign_type = 'selfie_service' THEN
      SELECT * INTO v_cpd FROM ufersin.campaign_product_discounts
        WHERE campaign_id = v_campaign.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_cpd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_cpd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_cpd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_campaign.id IS NOT NULL THEN
    IF v_campaign.campaign_type = 'kit' THEN
      IF v_campaign.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_campaign.discount_value / 100)::numeric, 2);
      ELSIF v_campaign.discount_type = 'fixed' THEN
        v_discount_amount := v_discount_amount + v_campaign.discount_value;
      END IF;
    END IF;
    -- selfie_service já somou o desconto por item no loop acima
    IF v_campaign.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_campaign.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_campaign.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_campaign.shipping_discount_value;
    END IF;
  END IF;

  IF v_coupon.id IS NOT NULL THEN
    IF v_coupon.kind = 'frete' THEN
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.kind = 'desconto' AND v_coupon.discount_type IS NOT NULL THEN
        IF v_coupon.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + v_coupon.discount_value;
        END IF;
      END IF;
      IF v_coupon.shipping_discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.shipping_discount_value / 100)::numeric, 2);
      ELSIF v_coupon.shipping_discount_type = 'fixed' THEN
        v_shipping_discount := v_shipping_discount + v_coupon.shipping_discount_value;
      END IF;
    END IF;
    UPDATE ufersin.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, campaign_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_campaign_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_purchases_quantity.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- admin_crm_customers.purchases ganha "quantity" (antes só product_id +
-- created_at) — precisa pra filtrar "volume de produtos em X dias" no
-- front sem virar uma contagem de linhas de pedido em vez de itens.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.admin_crm_customers(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_settings ufersin.shipping_settings%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;

  RETURN COALESCE((
    WITH paid_orders AS (
      SELECT * FROM ufersin.orders WHERE payment_status = 'pago'
    ),
    order_stats AS (
      SELECT
        customer_id,
        SUM(total) AS total_spent,
        COUNT(*) AS order_count,
        MIN(created_at) AS first_order_at,
        MAX(created_at) AS last_order_at,
        COALESCE(jsonb_agg(DISTINCT neighborhood) FILTER (WHERE neighborhood IS NOT NULL), '[]'::jsonb) AS neighborhoods,
        COALESCE(jsonb_agg(jsonb_build_object('total', total, 'created_at', created_at) ORDER BY created_at DESC), '[]'::jsonb) AS orders
      FROM paid_orders
      GROUP BY customer_id
    ),
    purchase_events AS (
      SELECT o.customer_id,
        jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'created_at', o.created_at, 'quantity', oi.quantity)) AS purchases,
        SUM(oi.quantity) AS total_items
      FROM paid_orders o
      JOIN ufersin.order_items oi ON oi.order_id = o.id
      GROUP BY o.customer_id
    ),
    last_location AS (
      SELECT DISTINCT ON (customer_id) customer_id, customer_lat, customer_lng
      FROM paid_orders
      WHERE customer_lat IS NOT NULL AND customer_lng IS NOT NULL
      ORDER BY customer_id, created_at DESC
    )
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'whatsapp', c.whatsapp, 'birthdate', c.birthdate,
      'total_spent', COALESCE(os.total_spent, 0),
      'order_count', COALESCE(os.order_count, 0),
      'total_items', COALESCE(pe.total_items, 0),
      'first_order_at', os.first_order_at,
      'last_order_at', os.last_order_at,
      'neighborhoods', COALESCE(os.neighborhoods, '[]'::jsonb),
      'purchases', COALESCE(pe.purchases, '[]'::jsonb),
      'orders', COALESCE(os.orders, '[]'::jsonb),
      'distance_km', CASE WHEN ll.customer_lat IS NULL THEN NULL
        ELSE round(ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, ll.customer_lat, ll.customer_lng)::numeric, 1)
      END
    ) ORDER BY c.name)
    FROM ufersin.customers c
    LEFT JOIN order_stats os ON os.customer_id = c.id
    LEFT JOIN purchase_events pe ON pe.customer_id = c.id
    LEFT JOIN last_location ll ON ll.customer_id = c.id
    WHERE c.id <> 'pdv-balcao-anonimo'
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_crm_customers(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_hero_settings.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Imagem inicial do carrossel da landing — sempre obrigatória e sempre a
-- primeira a aparecer (mesmo quando existem campanhas cadastradas), o
-- admin pode trocá-la a qualquer momento em /admin/campanhas. Enquanto
-- nenhuma for enviada, hero_image_url fica null e o front cai no banner
-- estático padrão (asset local), sem quebrar o carrossel.
-- =====================================================

CREATE TABLE IF NOT EXISTS ufersin.site_settings (
  id int PRIMARY KEY DEFAULT 1,
  hero_image_url text,
  CHECK (id = 1)
);

INSERT INTO ufersin.site_settings (id, hero_image_url) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;

ALTER TABLE ufersin.site_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON ufersin.site_settings TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_site_settings" ON ufersin.site_settings;
CREATE POLICY "sunset_anon_select_site_settings" ON ufersin.site_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION ufersin.admin_update_hero_image(p_token text, p_image_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required';
  END IF;
  UPDATE ufersin.site_settings SET hero_image_url = p_image_url WHERE id = 1;
  RETURN jsonb_build_object('hero_image_url', p_image_url);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_hero_image(text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_segmentos.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Segmentações persistidas do CRM: substitui o dropdown rápido antigo
-- ("aniversariantes", "mais frequentes" etc, fixo no código) por
-- segmentações nomeadas e salvas, criadas a partir do filtro avançado —
-- nome, descrição e o próprio critério do filtro (jsonb, mesmo formato
-- que o front já monta), opcionalmente vinculadas a um cupom exclusivo
-- (ufersin.coupons, criado pra exatamente os clientes daquele filtro) e/ou
-- uma campanha existente (só referência, campanha não é por-cliente).
-- =====================================================

CREATE TABLE IF NOT EXISTS ufersin.crm_segments (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name             TEXT NOT NULL,
  description      TEXT,
  filter_criteria  JSONB NOT NULL,
  coupon_id        TEXT REFERENCES ufersin.coupons(id) ON DELETE SET NULL,
  campaign_id      TEXT REFERENCES ufersin.campaigns(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (now()::text)
);
ALTER TABLE ufersin.crm_segments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION ufersin._segment_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'description', description, 'filter_criteria', filter_criteria,
    'coupon_id', coupon_id, 'campaign_id', campaign_id, 'created_at', created_at
  ) FROM ufersin.crm_segments WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_list_segments(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(ufersin._segment_json(id) ORDER BY created_at DESC) FROM ufersin.crm_segments), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_segments(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_create_segment(
  p_token text, p_name text, p_description text, p_filter_criteria jsonb,
  p_coupon_id text DEFAULT NULL, p_campaign_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  INSERT INTO ufersin.crm_segments (id, name, description, filter_criteria, coupon_id, campaign_id)
    VALUES (v_id, trim(p_name), NULLIF(trim(p_description), ''), p_filter_criteria, p_coupon_id, p_campaign_id);
  RETURN ufersin._segment_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_segment(text, text, text, jsonb, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_segment(
  p_token text, p_id text, p_name text, p_description text, p_filter_criteria jsonb,
  p_coupon_id text DEFAULT NULL, p_campaign_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  UPDATE ufersin.crm_segments SET
    name = trim(p_name), description = NULLIF(trim(p_description), ''),
    filter_criteria = p_filter_criteria, coupon_id = p_coupon_id, campaign_id = p_campaign_id
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;
  RETURN ufersin._segment_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_segment(text, text, text, text, jsonb, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_delete_segment(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  DELETE FROM ufersin.crm_segments WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_segment(text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_cupom_editar.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Editar cupom (avulso e exclusivo/alvo) — antes só dava pra ativar/
-- desativar, mudar validade e limite de usos. Agora dá pra também
-- ajustar o desconto (produto ou por-produto) depois de criado. Código
-- e kind continuam fixos após a criação (evita confusão com um cupom já
-- divulgado/usado mudando de natureza no meio do caminho).
-- =====================================================

DROP FUNCTION IF EXISTS ufersin.admin_update_coupon(text, text, boolean, boolean, text, bigint);

CREATE OR REPLACE FUNCTION ufersin.admin_update_coupon(
  p_token text, p_id text, p_active boolean, p_allow_campaign_checkout boolean,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_kind text;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  SELECT kind INTO v_kind FROM ufersin.coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;

  UPDATE ufersin.coupons SET
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    allow_campaign_checkout = CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    discount_type = CASE WHEN v_kind = 'produto' THEN discount_type ELSE COALESCE(p_discount_type, discount_type) END,
    discount_value = CASE WHEN v_kind = 'produto' THEN discount_value ELSE COALESCE(p_discount_value, discount_value) END
  WHERE id = p_id;

  IF v_kind = 'produto' AND p_product_discounts IS NOT NULL THEN
    DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = p_id;
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN ufersin._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_coupon(text, text, boolean, boolean, text, bigint, text, double precision, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_targeted_coupon(
  p_token text,
  p_id text,
  p_active boolean,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_campaign_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_kind text;
  v_pd jsonb;
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM ufersin.coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  -- kind='frete': discount_type/value é a taxa de frete em si (significado
  -- legado), shipping_discount_type/value fica null — mesma remapeação já
  -- usada em admin_create_targeted_coupon.
  UPDATE ufersin.coupons SET
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_campaign_checkout = CASE WHEN p_allow_campaign_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = p_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = p_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE ufersin.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = p_id;

  RETURN ufersin._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_targeted_coupon(text, text, boolean, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_rename_campaign_to_promotion.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Rename: campanha -> promoção (banner)
--
-- O sistema de banners/carrossel (kit e selfie_service, com desconto de
-- produto e/ou frete) era chamado de "campanha"/"campaign" em todo o
-- banco. Uma nova feature de CRM (segmento de clientes -> disparo
-- automático de notificação por WhatsApp) também vai se chamar
-- "campanha" — pra evitar colisão de nomes entre os dois conceitos,
-- este arquivo renomeia TUDO relacionado ao banner/kit/selfie-service
-- de "campaign"/"campanha" para "promotion"/"promoção".
--
-- Isto é um rename puro de identificadores (tabelas, colunas, funções,
-- parâmetros, variáveis e mensagens de erro) — NENHUMA regra de negócio
-- muda. ufersin.crm_segments e ufersin.coupons não fazem parte deste
-- sistema, mas cada um tem uma única coluna que referenciava o conceito
-- renomeado (crm_segments.campaign_id e coupons.allow_campaign_checkout)
-- e por isso também são ajustadas aqui, junto com as funções que leem/
-- escrevem essas colunas.
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. Tabelas e colunas
-- ─────────────────────────────────────────────────────

ALTER TABLE IF EXISTS ufersin.campaigns RENAME TO promotions;
ALTER TABLE ufersin.promotions RENAME COLUMN campaign_type TO promotion_type;
ALTER TABLE ufersin.promotions RENAME CONSTRAINT campaigns_has_discount TO promotions_has_discount;
ALTER TABLE ufersin.promotions RENAME CONSTRAINT campaigns_has_products TO promotions_has_products;

ALTER TABLE IF EXISTS ufersin.campaign_product_discounts RENAME TO promotion_product_discounts;
ALTER TABLE ufersin.promotion_product_discounts RENAME COLUMN campaign_id TO promotion_id;
ALTER INDEX ufersin.campaign_product_discounts_campaign_idx RENAME TO promotion_product_discounts_promotion_idx;

ALTER TABLE ufersin.orders RENAME COLUMN campaign_id TO promotion_id;

-- Referência simples (não é dono da campanha/promoção, só um vínculo
-- opcional) — a FK continua apontando certo porque a tabela foi
-- renomeada, não recriada.
ALTER TABLE ufersin.crm_segments RENAME COLUMN campaign_id TO promotion_id;

-- allow_campaign_checkout controla se um cupom pode ser combinado com o
-- checkout de uma campanha/promoção — nome referenciava o conceito
-- renomeado, então acompanha o rename.
ALTER TABLE ufersin.coupons RENAME COLUMN allow_campaign_checkout TO allow_promotion_checkout;

-- ─────────────────────────────────────────────────────
-- 2. Promoções — CRUD admin (ex-campanhas)
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin._campaign_json(text);

CREATE OR REPLACE FUNCTION ufersin._promotion_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'title', c.title, 'image_url', c.image_url, 'product_ids', to_jsonb(c.product_ids),
    'promotion_type', c.promotion_type,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'active', (c.active <> 0), 'starts_at', c.starts_at, 'expires_at', c.expires_at, 'created_at', c.created_at,
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.promotion_product_discounts pd WHERE pd.promotion_id = c.id
    ), '[]'::jsonb)
  ) FROM ufersin.promotions c WHERE c.id = p_id;
$$;

DROP FUNCTION IF EXISTS ufersin.admin_list_campaigns(text);

CREATE OR REPLACE FUNCTION ufersin.admin_list_promotions(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(ufersin._promotion_json(id) ORDER BY created_at DESC) FROM ufersin.promotions), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_promotions(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_create_campaign(text, text, text, text[], text, text, double precision, text, double precision, text, text, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_create_promotion(
  p_token text, p_title text, p_image_url text, p_product_ids text[],
  p_promotion_type text DEFAULT 'kit',
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL, p_shipping_discount_value double precision DEFAULT NULL,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required to create a promotion';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF p_promotion_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid promotion_type';
  END IF;
  IF p_promotion_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service promotion';
    END IF;
  ELSE
    IF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
      RAISE EXCEPTION 'a kit promotion needs a product discount and/or a shipping discount';
    END IF;
    IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;

  INSERT INTO ufersin.promotions (
    id, title, image_url, product_ids, promotion_type, discount_type, discount_value,
    shipping_discount_type, shipping_discount_value, starts_at, expires_at
  ) VALUES (
    v_id, trim(p_title), p_image_url, p_product_ids, p_promotion_type,
    CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    p_shipping_discount_type, p_shipping_discount_value,
    NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), '')
  );

  IF p_promotion_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN ufersin._promotion_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_promotion(text, text, text, text[], text, text, double precision, text, double precision, text, text, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_campaign(text, text, text, text, text[], text, text, double precision, text, double precision, boolean, text, text, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_update_promotion(
  p_token text, p_id text, p_title text, p_image_url text, p_product_ids text[],
  p_promotion_type text,
  p_discount_type text, p_discount_value double precision,
  p_shipping_discount_type text, p_shipping_discount_value double precision,
  p_active boolean,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF p_promotion_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid promotion_type';
  END IF;
  IF p_promotion_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service promotion';
    END IF;
  ELSIF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a kit promotion needs a product discount and/or a shipping discount';
  END IF;

  UPDATE ufersin.promotions SET
    title = trim(p_title), image_url = p_image_url, product_ids = p_product_ids,
    promotion_type = p_promotion_type,
    discount_type = CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    discount_value = CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    shipping_discount_type = p_shipping_discount_type, shipping_discount_value = p_shipping_discount_value,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''), expires_at = NULLIF(trim(p_expires_at), '')
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion not found';
  END IF;

  DELETE FROM ufersin.promotion_product_discounts WHERE promotion_id = p_id;
  IF p_promotion_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN ufersin._promotion_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_promotion(text, text, text, text, text[], text, text, double precision, text, double precision, boolean, text, text, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_delete_campaign(text, text);

CREATE OR REPLACE FUNCTION ufersin.admin_delete_promotion(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  DELETE FROM ufersin.promotions WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_promotion(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 3. Público — carrossel/banner + checkout (ex-campanhas)
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin.list_active_campaigns();

CREATE OR REPLACE FUNCTION ufersin.list_active_promotions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT COALESCE(jsonb_agg(ufersin._promotion_json(id) ORDER BY created_at DESC), '[]'::jsonb)
  FROM ufersin.promotions
  WHERE active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION ufersin.list_active_promotions() TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.get_campaign(text);

CREATE OR REPLACE FUNCTION ufersin.get_promotion(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT ufersin._promotion_json(id)
  FROM ufersin.promotions
  WHERE id = p_id AND active <> 0
    AND (starts_at IS NULL OR starts_at::timestamptz <= now())
    AND (expires_at IS NULL OR expires_at::timestamptz > now());
$$;
GRANT EXECUTE ON FUNCTION ufersin.get_promotion(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 4. Cupons — só o campo allow_campaign_checkout muda de nome
--    (o resto de ufersin.coupons/coupon_grants/coupon_product_discounts
--    é intocado, não faz parte deste rename)
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin._coupon_json(text);

CREATE OR REPLACE FUNCTION ufersin._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_promotion_checkout', (c.allow_promotion_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'active', (c.active <> 0),
    'expires_at', c.expires_at, 'max_uses', c.max_uses, 'used_count', c.used_count, 'created_at', c.created_at,
    'grant_count', (SELECT COUNT(*) FROM ufersin.coupon_grants g WHERE g.coupon_id = c.id),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  ) FROM ufersin.coupons c WHERE c.id = p_id;
$$;

DROP FUNCTION IF EXISTS ufersin.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_create_coupon(
  p_token text, p_code text, p_kind text, p_discount_type text, p_discount_value double precision,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_kind NOT IN ('desconto', 'frete', 'aniversario', 'produto') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  IF p_kind = 'produto' THEN
    IF NOT v_has_products THEN
      RAISE EXCEPTION 'at least one product is required for kind=produto';
    END IF;
  ELSE
    IF p_discount_type IS NULL OR p_discount_value IS NULL THEN
      RAISE EXCEPTION 'discount_type and discount_value are required';
    END IF;
    IF p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  BEGIN
    INSERT INTO ufersin.coupons (id, code, kind, discount_type, discount_value, allow_promotion_checkout, expires_at, max_uses)
      VALUES (
        v_id, v_code, p_kind,
        CASE WHEN p_kind = 'produto' THEN NULL ELSE p_discount_type END,
        CASE WHEN p_kind = 'produto' THEN NULL ELSE p_discount_value END,
        CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (
          gen_random_uuid()::text, v_id, v_pd->>'product_id',
          v_pd->>'discount_type', (v_pd->>'discount_value')::double precision
        );
    END LOOP;
  END IF;

  RETURN ufersin._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_coupon(text, text, boolean, boolean, text, bigint, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_update_coupon(
  p_token text, p_id text, p_active boolean, p_allow_promotion_checkout boolean,
  p_expires_at text DEFAULT NULL, p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_kind text;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  SELECT kind INTO v_kind FROM ufersin.coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;

  UPDATE ufersin.coupons SET
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    discount_type = CASE WHEN v_kind = 'produto' THEN discount_type ELSE COALESCE(p_discount_type, discount_type) END,
    discount_value = CASE WHEN v_kind = 'produto' THEN discount_value ELSE COALESCE(p_discount_value, discount_value) END
  WHERE id = p_id;

  IF v_kind = 'produto' AND p_product_discounts IS NOT NULL THEN
    DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = p_id;
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN ufersin._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_coupon(text, text, boolean, boolean, text, bigint, text, double precision, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_create_targeted_coupon(text, text, text[], bigint, boolean, text, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_create_targeted_coupon(
  p_token text,
  p_code text,
  p_customer_whatsapps text[],
  p_uses_per_customer bigint DEFAULT 1,
  p_notify_customers boolean DEFAULT true,
  p_custom_message text DEFAULT NULL,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_whatsapp text;
  v_kind text;
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF p_customer_whatsapps IS NULL OR array_length(p_customer_whatsapps, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one customer is required';
  END IF;
  IF p_uses_per_customer IS NULL OR p_uses_per_customer <= 0 THEN
    RAISE EXCEPTION 'uses_per_customer must be positive';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a targeted coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;

  IF v_has_products THEN
    v_kind := 'produto';
  ELSIF p_discount_type IS NOT NULL THEN
    v_kind := 'desconto';
  ELSE
    v_kind := 'frete';
  END IF;

  IF p_discount_type IS NOT NULL THEN
    IF p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;
  IF p_shipping_discount_type IS NOT NULL THEN
    IF p_shipping_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid shipping_discount_type';
    END IF;
    IF p_shipping_discount_type = 'percent' AND (p_shipping_discount_value <= 0 OR p_shipping_discount_value > 100) THEN
      RAISE EXCEPTION 'percent shipping discount must be between 0 and 100';
    END IF;
    IF p_shipping_discount_type = 'fixed' AND p_shipping_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed shipping discount must be positive';
    END IF;
  END IF;

  BEGIN
    IF v_kind = 'frete' THEN
      INSERT INTO ufersin.coupons (
        id, code, kind, discount_type, discount_value, allow_promotion_checkout,
        notify_customers, combinable_with_public, expires_at, max_uses
      ) VALUES (
        v_id, v_code, 'frete', p_shipping_discount_type, p_shipping_discount_value,
        CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
        CASE WHEN p_notify_customers THEN 1 ELSE 0 END,
        CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
    ELSE
      INSERT INTO ufersin.coupons (
        id, code, kind, discount_type, discount_value,
        shipping_discount_type, shipping_discount_value, allow_promotion_checkout,
        notify_customers, combinable_with_public, expires_at, max_uses
      ) VALUES (
        v_id, v_code, v_kind, p_discount_type, p_discount_value,
        p_shipping_discount_type, p_shipping_discount_value,
        CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
        CASE WHEN p_notify_customers THEN 1 ELSE 0 END,
        CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
        NULLIF(trim(p_expires_at), ''), p_max_uses
      );
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (
          gen_random_uuid()::text, v_id, v_pd->>'product_id',
          v_pd->>'discount_type', (v_pd->>'discount_value')::double precision
        );
    END LOOP;
  END IF;

  FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
    INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses)
      VALUES (gen_random_uuid()::text, v_id, v_whatsapp, p_uses_per_customer);
  END LOOP;

  RETURN ufersin._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_targeted_coupon(text, text, text[], bigint, boolean, text, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_targeted_coupon(text, text, boolean, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_update_targeted_coupon(
  p_token text,
  p_id text,
  p_active boolean,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_kind text;
  v_pd jsonb;
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM ufersin.coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE ufersin.coupons SET
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = p_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = p_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE ufersin.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = p_id;

  RETURN ufersin._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_targeted_coupon(text, text, boolean, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.validate_coupon(text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.validate_coupon(
  p_code text,
  p_promotion_id text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_coupon ufersin.coupons%ROWTYPE;
  v_is_targeted boolean;
BEGIN
  SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF v_coupon.active = 0 THEN
    RAISE EXCEPTION 'coupon is not active';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
  END IF;
  IF v_coupon.kind = 'aniversario' THEN
    IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = ''
       OR extract(month FROM p_customer_birthdate::date) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
  IF v_is_targeted THEN
    IF p_customer_whatsapp IS NULL OR trim(p_customer_whatsapp) = '' THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM ufersin.coupon_grants
      WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
    ) THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value,
    'shipping_discount_type', v_coupon.shipping_discount_type, 'shipping_discount_value', v_coupon.shipping_discount_value,
    'combinable_with_public', (v_coupon.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = v_coupon.id
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.validate_coupon(text, text, text, text) TO anon, authenticated;

-- ufersin.list_customer_coupons(text) não referencia campaign_id nem
-- allow_campaign_checkout na sua versão atual (sunset_cupom_exclusivo_v2.sql)
-- — não precisa de nenhuma alteração, então não é recriada aqui.

-- ─────────────────────────────────────────────────────
-- 5. create_order — RPC de checkout (payment-critical). Mesmo nome
--    (usada tanto pelo catálogo quanto pelo checkout de banner), só
--    p_campaign_id/v_campaign/ufersin.campaigns/ufersin.campaign_product_
--    discounts/allow_campaign_checkout mudam de nome. Nenhuma regra de
--    negócio muda.
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text,
  p_address text,
  p_items jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_promotion_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_item               jsonb;
  v_product            ufersin.products%ROWTYPE;
  v_quantity           bigint;
  v_subtotal           double precision := 0;
  v_shipping           double precision := 0;
  v_discount_amount    double precision := 0;
  v_shipping_discount  double precision := 0;
  v_customer_id        text;
  v_order_id           text := gen_random_uuid()::text;
  v_item_id            text;
  v_settings           ufersin.shipping_settings%ROWTYPE;
  v_km                 double precision;
  v_birthdate          date;
  v_promotion          ufersin.promotions%ROWTYPE;
  v_coupon             ufersin.coupons%ROWTYPE;
  v_coupon_code        text;
  v_grant              ufersin.coupon_grants%ROWTYPE;
  v_is_targeted        boolean;
  v_pd                 ufersin.coupon_product_discounts%ROWTYPE;
  v_cpd                ufersin.promotion_product_discounts%ROWTYPE;
  v_item_total         double precision;
  v_total              double precision;
  v_submitted_ids      text[];
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_promotion_id IS NOT NULL THEN
    SELECT * INTO v_promotion FROM ufersin.promotions WHERE id = p_promotion_id;
    IF NOT FOUND OR v_promotion.active = 0
       OR (v_promotion.starts_at IS NOT NULL AND v_promotion.starts_at::timestamptz > now())
       OR (v_promotion.expires_at IS NOT NULL AND v_promotion.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'promotion is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_promotion.product_ids))
    ) THEN
      RAISE EXCEPTION 'this promotion checkout can only contain the promotion products';
    END IF;
    IF v_promotion.promotion_type = 'kit' THEN
      SELECT array_agg(DISTINCT i->>'product_id') INTO v_submitted_ids FROM jsonb_array_elements(p_items) i;
      IF v_submitted_ids IS NULL OR array_length(v_submitted_ids, 1) <> array_length(v_promotion.product_ids, 1)
         OR NOT (v_submitted_ids @> v_promotion.product_ids) THEN
        RAISE EXCEPTION 'this kit promotion can only be purchased as the full bundle';
      END IF;
    END IF;
  END IF;

  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM ufersin.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE ufersin.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;
    v_coupon_code := v_coupon.code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

    v_item_total := v_product.price * v_quantity;
    v_subtotal := v_subtotal + v_item_total;

    IF v_coupon.kind = 'produto' THEN
      SELECT * INTO v_pd FROM ufersin.coupon_product_discounts
        WHERE coupon_id = v_coupon.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_pd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_pd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_pd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;

    IF v_promotion.id IS NOT NULL AND v_promotion.promotion_type = 'selfie_service' THEN
      SELECT * INTO v_cpd FROM ufersin.promotion_product_discounts
        WHERE promotion_id = v_promotion.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_cpd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_cpd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_cpd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_promotion.id IS NOT NULL THEN
    IF v_promotion.promotion_type = 'kit' THEN
      IF v_promotion.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_promotion.discount_value / 100)::numeric, 2);
      ELSIF v_promotion.discount_type = 'fixed' THEN
        v_discount_amount := v_discount_amount + v_promotion.discount_value;
      END IF;
    END IF;
    -- selfie_service já somou o desconto por item no loop acima
    IF v_promotion.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_promotion.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_promotion.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_promotion.shipping_discount_value;
    END IF;
  END IF;

  IF v_coupon.id IS NOT NULL THEN
    IF v_coupon.kind = 'frete' THEN
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.kind = 'desconto' AND v_coupon.discount_type IS NOT NULL THEN
        IF v_coupon.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + v_coupon.discount_value;
        END IF;
      END IF;
      IF v_coupon.shipping_discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.shipping_discount_value / 100)::numeric, 2);
      ELSIF v_coupon.shipping_discount_type = 'fixed' THEN
        v_shipping_discount := v_shipping_discount + v_coupon.shipping_discount_value;
      END IF;
    END IF;
    UPDATE ufersin.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, promotion_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_promotion_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 6. get_order — mesmo nome, só o campo campaign_id vira promotion_id
--    no jsonb de saída (chamada pelo cliente/checkout/motoboy também,
--    por isso não pode ganhar nenhum campo novo aqui).
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin.get_order(text);

CREATE OR REPLACE FUNCTION ufersin.get_order(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ufersin, public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'customer_name', o.customer_name,
    'customer_whatsapp', o.customer_whatsapp,
    'delivery_type', o.delivery_type,
    'neighborhood', o.neighborhood,
    'address', o.address,
    'reference_point', o.reference_point,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'status', o.status,
    'shipping_price', o.shipping_price,
    'total', o.total,
    'discount_amount', o.discount_amount,
    'shipping_discount', o.shipping_discount,
    'coupon_code', o.coupon_code,
    'promotion_id', o.promotion_id,
    'motoboy_id', o.motoboy_id,
    'motoboy_name', m.name,
    'motoboy_whatsapp', m.whatsapp,
    'pix_payment_id', o.pix_payment_id,
    'pix_qr_base64', o.pix_qr_base64,
    'pix_copia_cola', o.pix_copia_cola,
    'customer_lat', o.customer_lat,
    'customer_lng', o.customer_lng,
    'motoboy_paid_at', o.motoboy_paid_at,
    'delivery_started_at', o.delivery_started_at,
    'delivered_at', o.delivered_at,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'product_name', oi.product_name,
        'unit_price', oi.unit_price,
        'quantity', oi.quantity
      ))
      FROM ufersin.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM ufersin.orders o
  LEFT JOIN ufersin.motoboys m ON m.id = o.motoboy_id
  WHERE o.id = p_order_id;
$$;
GRANT EXECUTE ON FUNCTION ufersin.get_order(text) TO anon, authenticated;

-- ufersin._get_order_admin, ufersin.admin_list_orders e
-- ufersin.admin_update_order_status (sunset_comissao_origem_pedido.sql)
-- não referenciam campaign_id diretamente — _get_order_admin só faz
-- ufersin.get_order(...) || jsonb_build_object(sold_by_*), então herda o
-- campo já renomeado (promotion_id) por tabela. Nenhuma das três precisa
-- ser recriada aqui.

-- ─────────────────────────────────────────────────────
-- 7. Financeiro — série temporal (campaign_orders/campaign_discount
--    viram promotion_orders/promotion_discount, mesmo nome de função)
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin.admin_financeiro_timeseries(text, bigint);

CREATE OR REPLACE FUNCTION ufersin.admin_financeiro_timeseries(p_token text, p_days bigint DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_days bigint := GREATEST(LEAST(COALESCE(p_days, 30), 180), 1);
  v_result jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date', d.day,
      'quantity_sold', COALESCE(q.qty, 0),
      'revenue', COALESCE(o.revenue, 0),
      'orders_count', COALESCE(o.orders_count, 0),
      'coupon_orders', COALESCE(o.coupon_orders, 0),
      'coupon_discount', COALESCE(o.coupon_discount, 0),
      'promotion_orders', COALESCE(o.promotion_orders, 0),
      'promotion_discount', COALESCE(o.promotion_discount, 0)
    ) ORDER BY d.day), '[]'::jsonb)
    INTO v_result
    FROM generate_series(current_date - (v_days - 1), current_date, interval '1 day') AS d(day)
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS orders_count,
        SUM(total) AS revenue,
        COUNT(*) FILTER (WHERE coupon_code IS NOT NULL) AS coupon_orders,
        SUM(discount_amount + shipping_discount) FILTER (WHERE coupon_code IS NOT NULL) AS coupon_discount,
        COUNT(*) FILTER (WHERE promotion_id IS NOT NULL) AS promotion_orders,
        SUM(discount_amount + shipping_discount) FILTER (WHERE promotion_id IS NOT NULL) AS promotion_discount
      FROM ufersin.orders
      WHERE payment_status = 'pago' AND created_at::date = d.day::date
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT SUM(oi.quantity) AS qty
      FROM ufersin.order_items oi JOIN ufersin.orders ord ON ord.id = oi.order_id
      WHERE ord.payment_status = 'pago' AND ord.created_at::date = d.day::date
    ) q ON true;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_financeiro_timeseries(text, bigint) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 8. CRM — ufersin.crm_segments.campaign_id vira promotion_id (só a
--    referência ao banner mudou de nome; segmentação em si é
--    intocada). admin_list_segments e admin_delete_segment não
--    referenciam a coluna, não precisam ser recriadas.
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ufersin._segment_json(text);

CREATE OR REPLACE FUNCTION ufersin._segment_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'description', description, 'filter_criteria', filter_criteria,
    'coupon_id', coupon_id, 'promotion_id', promotion_id, 'created_at', created_at
  ) FROM ufersin.crm_segments WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS ufersin.admin_create_segment(text, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION ufersin.admin_create_segment(
  p_token text, p_name text, p_description text, p_filter_criteria jsonb,
  p_coupon_id text DEFAULT NULL, p_promotion_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  INSERT INTO ufersin.crm_segments (id, name, description, filter_criteria, coupon_id, promotion_id)
    VALUES (v_id, trim(p_name), NULLIF(trim(p_description), ''), p_filter_criteria, p_coupon_id, p_promotion_id);
  RETURN ufersin._segment_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_segment(text, text, text, jsonb, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_segment(text, text, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION ufersin.admin_update_segment(
  p_token text, p_id text, p_name text, p_description text, p_filter_criteria jsonb,
  p_coupon_id text DEFAULT NULL, p_promotion_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  UPDATE ufersin.crm_segments SET
    name = trim(p_name), description = NULLIF(trim(p_description), ''),
    filter_criteria = p_filter_criteria, coupon_id = p_coupon_id, promotion_id = p_promotion_id
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;
  RETURN ufersin._segment_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_segment(text, text, text, text, jsonb, text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_campanhas_eventos.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- "Campanha" (novo conceito, não confundir com a antiga campanha
-- renomeada pra "promoção" — ver sunset_rename_campaign_to_promotion.sql):
-- notifica os clientes de um segmento do CRM via WhatsApp com um cupom
-- exclusivo. Um segmento pode ter zero, uma ou várias campanhas
-- (cupons), cada uma com seu próprio prazo/desconto/mensagem.
--
-- orientation='segmento': dispara UMA VEZ, na criação, pros clientes que
-- casam com o critério do segmento NAQUELE momento — não reage a
-- clientes que passem a casar com o critério depois.
-- orientation='evento': fica associada a um critério DIFERENTE do
-- critério original do segmento (trigger_criteria) — não dispara nada na
-- criação. Mais tarde (admin_fire_campanha_event, chamado pelo front
-- quando reavalia a lista), qualquer cliente que passa a casar com esse
-- critério novo ganha o cupom — idempotente, não duplica concessão.
-- =====================================================

CREATE TABLE IF NOT EXISTS ufersin.crm_segment_coupons (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  segment_id         TEXT NOT NULL REFERENCES ufersin.crm_segments(id) ON DELETE CASCADE,
  coupon_id          TEXT NOT NULL REFERENCES ufersin.coupons(id) ON DELETE CASCADE,
  orientation        TEXT NOT NULL CHECK (orientation IN ('segmento', 'evento')),
  trigger_criteria   JSONB,
  message_template   TEXT NOT NULL,
  uses_per_customer  BIGINT NOT NULL DEFAULT 1,
  last_fired_at      TEXT,
  created_at         TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS crm_segment_coupons_segment_idx ON ufersin.crm_segment_coupons (segment_id);
ALTER TABLE ufersin.crm_segment_coupons ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION ufersin._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'fired_at', last_fired_at, 'created_at', created_at
  ) FROM ufersin.crm_segment_coupons WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_list_campanha_coupons(p_token text, p_segment_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(ufersin._campanha_coupon_json(id) ORDER BY created_at DESC)
    FROM ufersin.crm_segment_coupons WHERE segment_id = p_segment_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_campanha_coupons(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_create_campanha_coupon(
  p_token text,
  p_segment_id text,
  p_orientation text,
  p_message_template text,
  p_code text,
  p_customer_whatsapps text[] DEFAULT '{}',
  p_trigger_criteria jsonb DEFAULT NULL,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_segment       ufersin.crm_segments%ROWTYPE;
  v_coupon_id     text := gen_random_uuid()::text;
  v_row_id        text := gen_random_uuid()::text;
  v_code          text := upper(trim(p_code));
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_kind          text;
  v_pd            jsonb;
  v_whatsapp      text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_orientation NOT IN ('segmento', 'evento') THEN
    RAISE EXCEPTION 'invalid orientation';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;

  SELECT * INTO v_segment FROM ufersin.crm_segments WHERE id = p_segment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;

  IF p_orientation = 'evento' THEN
    IF p_trigger_criteria IS NULL THEN
      RAISE EXCEPTION 'trigger_criteria is required for orientation=evento';
    END IF;
    IF p_trigger_criteria = v_segment.filter_criteria THEN
      RAISE EXCEPTION 'trigger_criteria must differ from the segment''s current filter in at least one field';
    END IF;
  END IF;

  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a campanha coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  BEGIN
    INSERT INTO ufersin.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      combinable_with_public, allow_promotion_checkout, expires_at, max_uses
    ) VALUES (
      v_coupon_id, v_code, v_kind,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_type WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_value WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      NULLIF(trim(p_expires_at), ''), p_max_uses
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  INSERT INTO ufersin.crm_segment_coupons (
    id, segment_id, coupon_id, orientation, trigger_criteria, message_template, uses_per_customer, last_fired_at
  ) VALUES (
    v_row_id, p_segment_id, v_coupon_id, p_orientation, p_trigger_criteria,
    trim(p_message_template), p_uses_per_customer,
    CASE WHEN p_orientation = 'segmento' THEN now()::text ELSE NULL END
  );

  -- 'segmento' dispara na hora pra quem veio na lista (calculada no front
  -- a partir do filter_criteria do segmento); 'evento' começa sem
  -- concessão nenhuma, só passa a existir quando o critério diferente
  -- (trigger_criteria) se tornar verdade pra algum cliente.
  IF p_orientation = 'segmento' THEN
    FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
      IF v_whatsapp IS NOT NULL AND trim(v_whatsapp) <> '' THEN
        INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          SELECT gen_random_uuid()::text, v_coupon_id, v_whatsapp, p_uses_per_customer, 0
          WHERE NOT EXISTS (
            SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon_id AND customer_whatsapp = v_whatsapp
          );
      END IF;
    END LOOP;
  END IF;

  RETURN ufersin._campanha_coupon_json(v_row_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campanha_coupon(text, text, text, text, text, text[], jsonb, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- Reavalia uma campanha orientation='evento' contra a lista atual de
-- whatsapps que casam com trigger_criteria (calculada no front) —
-- concede o cupom só pra quem ainda não tinha, idempotente.
CREATE OR REPLACE FUNCTION ufersin.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row      ufersin.crm_segment_coupons%ROWTYPE;
  v_whatsapp text;
  v_newly    text[] := '{}';
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas can be re-fired';
  END IF;

  FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
    IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_row.coupon_id AND customer_whatsapp = v_whatsapp) THEN
      INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_whatsapp, v_row.uses_per_customer, 0);
      v_newly := array_append(v_newly, v_whatsapp);
    END IF;
  END LOOP;

  IF array_length(v_newly, 1) > 0 THEN
    UPDATE ufersin.crm_segment_coupons SET last_fired_at = now()::text WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_newly));
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_fire_campanha_event(text, text, text[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_delete_campanha_coupon(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  -- Não apaga ufersin.coupons — o admin pode querer manter o cupom em uso
  -- mesmo desvinculado da campanha (só remove a linha de vínculo).
  DELETE FROM ufersin.crm_segment_coupons WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_campanha_coupon(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- crm_segments perde os vínculos diretos com cupom/promoção — o vínculo
-- agora é só via crm_segment_coupons (segmento -> campanha -> cupom).
-- ─────────────────────────────────────────────────────
ALTER TABLE ufersin.crm_segments DROP COLUMN IF EXISTS coupon_id;

CREATE OR REPLACE FUNCTION ufersin._segment_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'description', description, 'filter_criteria', filter_criteria, 'created_at', created_at
  ) FROM ufersin.crm_segments WHERE id = p_id;
$$;

DROP FUNCTION IF EXISTS ufersin.admin_create_segment(text, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION ufersin.admin_create_segment(p_token text, p_name text, p_description text, p_filter_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  INSERT INTO ufersin.crm_segments (id, name, description, filter_criteria)
    VALUES (v_id, trim(p_name), NULLIF(trim(p_description), ''), p_filter_criteria);
  RETURN ufersin._segment_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_segment(text, text, text, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_segment(text, text, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION ufersin.admin_update_segment(p_token text, p_id text, p_name text, p_description text, p_filter_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  UPDATE ufersin.crm_segments SET
    name = trim(p_name), description = NULLIF(trim(p_description), ''), filter_criteria = p_filter_criteria
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;
  RETURN ufersin._segment_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_segment(text, text, text, text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_list_segments(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(ufersin._segment_json(id) ORDER BY created_at DESC) FROM ufersin.crm_segments), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_segments(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_campanhas_targeting_fix.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Cupom de campanha orientation='evento' nasce sem nenhuma concessão
-- (coupon_grants) — só ganha concessão quando o critério diferente
-- (trigger_criteria) se tornar verdade pra algum cliente, mais tarde.
-- Sem essa correção, create_order/validate_coupon tratariam esse cupom
-- como PÚBLICO (já que "tem concessão" era o único jeito de saber que um
-- cupom é exclusivo) enquanto ele tiver zero concessões — deixando
-- qualquer cliente usar o código antes da hora. Agora, também conta como
-- exclusivo se ele estiver referenciado em crm_segment_coupons.
--
-- Execução: depois de sunset_rename_campaign_to_promotion.sql E de
-- sunset_crm_campanhas_eventos.sql (precisa da tabela crm_segment_coupons).
-- =====================================================

DROP FUNCTION IF EXISTS ufersin.validate_coupon(text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.validate_coupon(
  p_code text,
  p_promotion_id text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_coupon ufersin.coupons%ROWTYPE;
  v_is_targeted boolean;
BEGIN
  SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF v_coupon.active = 0 THEN
    RAISE EXCEPTION 'coupon is not active';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
  END IF;
  IF v_coupon.kind = 'aniversario' THEN
    IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = ''
       OR extract(month FROM p_customer_birthdate::date) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id)
      OR EXISTS(SELECT 1 FROM ufersin.crm_segment_coupons WHERE coupon_id = v_coupon.id)
    INTO v_is_targeted;
  IF v_is_targeted THEN
    IF p_customer_whatsapp IS NULL OR trim(p_customer_whatsapp) = '' THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM ufersin.coupon_grants
      WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
    ) THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value,
    'shipping_discount_type', v_coupon.shipping_discount_type, 'shipping_discount_value', v_coupon.shipping_discount_value,
    'combinable_with_public', (v_coupon.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = v_coupon.id
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.validate_coupon(text, text, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text,
  p_address text,
  p_items jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_promotion_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_item               jsonb;
  v_product            ufersin.products%ROWTYPE;
  v_quantity           bigint;
  v_subtotal           double precision := 0;
  v_shipping           double precision := 0;
  v_discount_amount    double precision := 0;
  v_shipping_discount  double precision := 0;
  v_customer_id        text;
  v_order_id           text := gen_random_uuid()::text;
  v_item_id            text;
  v_settings           ufersin.shipping_settings%ROWTYPE;
  v_km                 double precision;
  v_birthdate          date;
  v_promotion          ufersin.promotions%ROWTYPE;
  v_coupon             ufersin.coupons%ROWTYPE;
  v_coupon_code        text;
  v_grant              ufersin.coupon_grants%ROWTYPE;
  v_is_targeted        boolean;
  v_pd                 ufersin.coupon_product_discounts%ROWTYPE;
  v_cpd                ufersin.promotion_product_discounts%ROWTYPE;
  v_item_total         double precision;
  v_total              double precision;
  v_submitted_ids      text[];
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_promotion_id IS NOT NULL THEN
    SELECT * INTO v_promotion FROM ufersin.promotions WHERE id = p_promotion_id;
    IF NOT FOUND OR v_promotion.active = 0
       OR (v_promotion.starts_at IS NOT NULL AND v_promotion.starts_at::timestamptz > now())
       OR (v_promotion.expires_at IS NOT NULL AND v_promotion.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'promotion is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_promotion.product_ids))
    ) THEN
      RAISE EXCEPTION 'this promotion checkout can only contain the promotion products';
    END IF;
    IF v_promotion.promotion_type = 'kit' THEN
      SELECT array_agg(DISTINCT i->>'product_id') INTO v_submitted_ids FROM jsonb_array_elements(p_items) i;
      IF v_submitted_ids IS NULL OR array_length(v_submitted_ids, 1) <> array_length(v_promotion.product_ids, 1)
         OR NOT (v_submitted_ids @> v_promotion.product_ids) THEN
        RAISE EXCEPTION 'this kit promotion can only be purchased as the full bundle';
      END IF;
    END IF;
  END IF;

  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id)
        OR EXISTS(SELECT 1 FROM ufersin.crm_segment_coupons WHERE coupon_id = v_coupon.id)
      INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM ufersin.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE ufersin.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;
    v_coupon_code := v_coupon.code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

    v_item_total := v_product.price * v_quantity;
    v_subtotal := v_subtotal + v_item_total;

    IF v_coupon.kind = 'produto' THEN
      SELECT * INTO v_pd FROM ufersin.coupon_product_discounts
        WHERE coupon_id = v_coupon.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_pd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_pd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_pd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;

    IF v_promotion.id IS NOT NULL AND v_promotion.promotion_type = 'selfie_service' THEN
      SELECT * INTO v_cpd FROM ufersin.promotion_product_discounts
        WHERE promotion_id = v_promotion.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_cpd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_cpd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_cpd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_promotion.id IS NOT NULL THEN
    IF v_promotion.promotion_type = 'kit' THEN
      IF v_promotion.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_promotion.discount_value / 100)::numeric, 2);
      ELSIF v_promotion.discount_type = 'fixed' THEN
        v_discount_amount := v_discount_amount + v_promotion.discount_value;
      END IF;
    END IF;
    IF v_promotion.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_promotion.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_promotion.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_promotion.shipping_discount_value;
    END IF;
  END IF;

  IF v_coupon.id IS NOT NULL THEN
    IF v_coupon.kind = 'frete' THEN
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.kind = 'desconto' AND v_coupon.discount_type IS NOT NULL THEN
        IF v_coupon.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + v_coupon.discount_value;
        END IF;
      END IF;
      IF v_coupon.shipping_discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.shipping_discount_value / 100)::numeric, 2);
      ELSIF v_coupon.shipping_discount_type = 'fixed' THEN
        v_shipping_discount := v_shipping_discount + v_coupon.shipping_discount_value;
      END IF;
    END IF;
    UPDATE ufersin.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, promotion_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_promotion_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_campanhas_active_toggle.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Campanha (crm_segment_coupons) ganha um toggle "Ativa/Pausada", igual ao
-- que cupom já tem — o wireframe do admin mostra esse "On" em todo card de
-- campanha. Pausar uma campanha 'evento' impede que ela seja reavaliada
-- (admin_fire_campanha_event e o auto-check do front pulam linhas
-- inativas); pausar uma 'segmento' só é cosmético já que ela dispara uma
-- vez só na criação.
--
-- Execução: depois de sunset_crm_campanhas_eventos.sql (a tabela
-- crm_segment_coupons precisa existir).
-- =====================================================

ALTER TABLE ufersin.crm_segment_coupons ADD COLUMN IF NOT EXISTS active BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION ufersin._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at
  ) FROM ufersin.crm_segment_coupons WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_toggle_campanha_coupon(p_token text, p_id text, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  UPDATE ufersin.crm_segment_coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_toggle_campanha_coupon(text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row      ufersin.crm_segment_coupons%ROWTYPE;
  v_whatsapp text;
  v_newly    text[] := '{}';
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas can be re-fired';
  END IF;
  IF v_row.active = 0 THEN
    RAISE EXCEPTION 'this campanha is paused';
  END IF;

  FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
    IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_row.coupon_id AND customer_whatsapp = v_whatsapp) THEN
      INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_whatsapp, v_row.uses_per_customer, 0);
      v_newly := array_append(v_newly, v_whatsapp);
    END IF;
  END LOOP;

  IF array_length(v_newly, 1) > 0 THEN
    UPDATE ufersin.crm_segment_coupons SET last_fired_at = now()::text WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_newly));
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_fire_campanha_event(text, text, text[]) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_campanhas_editar_toggle_unificado.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- 1) admin_update_campanha_coupon: permite editar mensagem/descontos/prazo
--    de uma campanha já criada (inline, direto no card) sem mexer em
--    orientation/trigger_criteria/código — esses são "identidade" da
--    campanha e continuam imutáveis depois de criada, igual o cupom
--    avulso já trata o código como fixo em admin_update_targeted_coupon.
--
-- 2) admin_toggle_campanha_coupon agora é o ÚNICO on/off: liga/desliga a
--    campanha inteira, e junto com ela o cupom exclusivo por trás dela
--    (ufersin.coupons.active) — não existe mais um on/off separado só do
--    cupom de uma campanha. Cupom AVULSO continua com seu próprio on/off
--    (admin_toggle_coupon, intocado por este arquivo).
--
-- Execução: depois de sunset_crm_campanhas_active_toggle.sql.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.admin_update_campanha_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row           ufersin.crm_segment_coupons%ROWTYPE;
  v_kind          text;
  v_pd            jsonb;
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE ufersin.coupons SET
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = v_row.coupon_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE ufersin.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  UPDATE ufersin.crm_segment_coupons SET
    message_template = trim(p_message_template),
    uses_per_customer = p_uses_per_customer
  WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_toggle_campanha_coupon(p_token text, p_id text, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row ufersin.crm_segment_coupons%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  UPDATE ufersin.crm_segment_coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END WHERE id = p_id;
  UPDATE ufersin.coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END WHERE id = v_row.coupon_id;
  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_toggle_campanha_coupon(text, text, boolean) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_campanhas_evento_stale.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Quando o admin edita o filter_criteria de um segmento, qualquer
-- campanha 'evento' vinculada a ele fica desatualizada — o trigger_criteria
-- dela foi calibrado contra o critério ANTIGO do segmento, então pode não
-- fazer mais sentido (ex: um campo novo entrou no filtro e não tem valor-
-- alvo definido pra ele ainda). Em vez de deixar disparar com um critério
-- desatualizado, a campanha é pausada (active=0) automaticamente — o
-- admin revisa e reativa manualmente pelo card, que fica com aviso.
--
-- admin_update_campanha_coupon ganha p_trigger_criteria: permite editar o
-- critério-alvo depois de criada (antes só criação, nunca edição).
--
-- Este arquivo também RE-APLICA (idempotente, seguro rodar de novo) a
-- coluna active + admin_toggle_campanha_coupon do arquivo anterior — se o
-- on/off ainda não funciona depois de rodar os arquivos anteriores, o
-- suspeito nº1 é o schema cache do PostgREST não ter recarregado a
-- função nova (é assíncrono depois de um CREATE OR REPLACE via SQL
-- editor); o NOTIFY no fim deste arquivo força o reload na hora.
--
-- Execução: depois de sunset_crm_campanhas_editar_toggle_unificado.sql
-- (mas seguro mesmo que os arquivos anteriores não tenham rodado certo).
-- =====================================================

ALTER TABLE ufersin.crm_segment_coupons ADD COLUMN IF NOT EXISTS active BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION ufersin._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at
  ) FROM ufersin.crm_segment_coupons WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_toggle_campanha_coupon(p_token text, p_id text, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row ufersin.crm_segment_coupons%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  UPDATE ufersin.crm_segment_coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END WHERE id = p_id;
  UPDATE ufersin.coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END WHERE id = v_row.coupon_id;
  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_toggle_campanha_coupon(text, text, boolean) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_segment(text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_update_segment(p_token text, p_id text, p_name text, p_description text, p_filter_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_old_criteria jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;

  SELECT filter_criteria INTO v_old_criteria FROM ufersin.crm_segments WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;

  UPDATE ufersin.crm_segments SET
    name = trim(p_name), description = NULLIF(trim(p_description), ''), filter_criteria = p_filter_criteria
  WHERE id = p_id;

  IF v_old_criteria IS DISTINCT FROM p_filter_criteria THEN
    UPDATE ufersin.crm_segment_coupons SET active = 0 WHERE segment_id = p_id AND orientation = 'evento';
  END IF;

  RETURN ufersin._segment_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_segment(text, text, text, text, jsonb) TO anon, authenticated;

-- Assinatura mudou (novo parâmetro p_trigger_criteria no fim) — precisa
-- derrubar a versão antiga primeiro, senão CREATE OR REPLACE cria um
-- overload novo em vez de substituir, e as duas versões coexistindo
-- confundem a resolução de chamada nomeada do PostgREST.
DROP FUNCTION IF EXISTS ufersin.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_update_campanha_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_trigger_criteria jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row           ufersin.crm_segment_coupons%ROWTYPE;
  v_kind          text;
  v_pd            jsonb;
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE ufersin.coupons SET
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = v_row.coupon_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE ufersin.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  UPDATE ufersin.crm_segment_coupons SET
    message_template = trim(p_message_template),
    uses_per_customer = p_uses_per_customer,
    trigger_criteria = CASE WHEN orientation = 'evento' AND p_trigger_criteria IS NOT NULL THEN p_trigger_criteria ELSE trigger_criteria END
  WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb, jsonb) TO anon, authenticated;

-- Força o PostgREST a recarregar o schema na hora em vez de esperar o
-- próximo ciclo automático — sem isso, RPCs recém-criadas/trocadas podem
-- devolver "function not found" por um tempo depois de rodar esta migration.
NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_coupon_grants_created_at.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- "Resultados da segmentação" (histórico de disparos de uma campanha)
-- precisa mostrar a data de cada disparo — coupon_grants já tem
-- created_at, só faltava expor no retorno.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.admin_list_coupon_grants(p_token text, p_coupon_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id, 'customer_whatsapp', g.customer_whatsapp, 'customer_name', c.name,
      'granted_uses', g.granted_uses, 'used_count', g.used_count, 'created_at', g.created_at
    ) ORDER BY g.created_at DESC)
    FROM ufersin.coupon_grants g
    LEFT JOIN ufersin.customers c ON c.whatsapp = g.customer_whatsapp
    WHERE g.coupon_id = p_coupon_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_list_coupon_grants(text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_campanhas_multi_cupom.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Uma campanha pode ter MAIS DE UM cupom exclusivo — o cupom "principal"
-- continua sendo crm_segment_coupons.coupon_id (não muda nada do que já
-- existe), e cupons extras entram numa tabela nova ligada à campanha.
-- Todos os cupons de uma campanha (principal + extras):
-- - compartilham orientation/trigger_criteria/message_template da campanha;
-- - têm SEU PRÓPRIO código/desconto/prazo/usos (cada um é um cupom de
--   verdade, só que todos entregues juntos quando a campanha dispara);
-- - ligam/desligam juntos (on/off é da campanha inteira, não por cupom);
-- - se a campanha já disparou (segmento imediato, ou evento já
--   concedido), um cupom extra criado depois é concedido na hora pra
--   quem já tinha ganhado o principal — não fica esperando o próximo
--   evento.
-- =====================================================

CREATE TABLE IF NOT EXISTS ufersin.crm_campanha_extra_coupons (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campanha_id TEXT NOT NULL REFERENCES ufersin.crm_segment_coupons(id) ON DELETE CASCADE,
  coupon_id   TEXT NOT NULL REFERENCES ufersin.coupons(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS crm_campanha_extra_coupons_campanha_idx ON ufersin.crm_campanha_extra_coupons (campanha_id);
ALTER TABLE ufersin.crm_campanha_extra_coupons ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION ufersin._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ec.id, 'coupon', ufersin._coupon_json(ec.coupon_id)) ORDER BY ec.created_at)
      FROM ufersin.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM ufersin.crm_segment_coupons WHERE id = p_id;
$$;

-- Cria mais um cupom pra uma campanha já existente. Se a campanha já
-- concedeu o cupom principal pra alguém (segmento disparou na criação,
-- ou evento já disparou antes), concede esse cupom novo pra essa MESMA
-- lista na hora — senão ele ficaria esperando o próximo disparo à toa.
CREATE OR REPLACE FUNCTION ufersin.admin_create_campanha_extra_coupon(
  p_token text,
  p_campanha_id text,
  p_code text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_campanha      ufersin.crm_segment_coupons%ROWTYPE;
  v_coupon_id     text := gen_random_uuid()::text;
  v_row_id        text := gen_random_uuid()::text;
  v_code          text := upper(trim(p_code));
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_kind          text;
  v_pd            jsonb;
  v_grant         ufersin.coupon_grants%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_campanha FROM ufersin.crm_segment_coupons WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a campanha coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  BEGIN
    INSERT INTO ufersin.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      combinable_with_public, allow_promotion_checkout, expires_at, max_uses
    ) VALUES (
      v_coupon_id, v_code, v_kind,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_type WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_value WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      NULLIF(trim(p_expires_at), ''), p_max_uses
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  IF v_campanha.active = 0 THEN
    UPDATE ufersin.coupons SET active = 0 WHERE id = v_coupon_id;
  END IF;

  INSERT INTO ufersin.crm_campanha_extra_coupons (id, campanha_id, coupon_id) VALUES (v_row_id, p_campanha_id, v_coupon_id);

  -- A campanha já disparou antes (tem concessão do cupom principal)? Esse
  -- cupom novo entra pra mesma turma na hora, não espera o próximo evento.
  FOR v_grant IN SELECT * FROM ufersin.coupon_grants WHERE coupon_id = v_campanha.coupon_id LOOP
    INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
      VALUES (gen_random_uuid()::text, v_coupon_id, v_grant.customer_whatsapp, p_uses_per_customer, 0);
  END LOOP;

  RETURN ufersin._coupon_json(v_coupon_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- Só desvincula da campanha — não apaga ufersin.coupons, mesma lógica de
-- admin_delete_campanha_coupon.
CREATE OR REPLACE FUNCTION ufersin.admin_delete_campanha_extra_coupon(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  DELETE FROM ufersin.crm_campanha_extra_coupons WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_campanha_extra_coupon(text, text) TO anon, authenticated;

-- On/off da campanha agora liga/desliga TODOS os cupons dela (principal +
-- extras), não só o principal.
CREATE OR REPLACE FUNCTION ufersin.admin_toggle_campanha_coupon(p_token text, p_id text, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row ufersin.crm_segment_coupons%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  UPDATE ufersin.crm_segment_coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END WHERE id = p_id;
  UPDATE ufersin.coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END WHERE id = v_row.coupon_id;
  UPDATE ufersin.coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END
    WHERE id IN (SELECT coupon_id FROM ufersin.crm_campanha_extra_coupons WHERE campanha_id = p_id);
  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_toggle_campanha_coupon(text, text, boolean) TO anon, authenticated;

-- Reavaliar o evento agora concede TODOS os cupons da campanha (principal
-- + extras) pra quem bateu o critério, não só o principal.
CREATE OR REPLACE FUNCTION ufersin.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row       ufersin.crm_segment_coupons%ROWTYPE;
  v_coupon_id text;
  v_whatsapp  text;
  v_newly     text[] := '{}';
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas can be re-fired';
  END IF;
  IF v_row.active = 0 THEN
    RAISE EXCEPTION 'this campanha is paused';
  END IF;

  FOR v_coupon_id IN
    SELECT v_row.coupon_id
    UNION ALL
    SELECT coupon_id FROM ufersin.crm_campanha_extra_coupons WHERE campanha_id = p_id
  LOOP
    FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
      IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon_id AND customer_whatsapp = v_whatsapp) THEN
        INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          VALUES (gen_random_uuid()::text, v_coupon_id, v_whatsapp, v_row.uses_per_customer, 0);
        IF v_coupon_id = v_row.coupon_id THEN
          v_newly := array_append(v_newly, v_whatsapp);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  IF array_length(v_newly, 1) > 0 THEN
    UPDATE ufersin.crm_segment_coupons SET last_fired_at = now()::text WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_newly));
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_fire_campanha_event(text, text, text[]) TO anon, authenticated;

-- validate_coupon/create_order: cupom extra de campanha 'evento' que
-- ainda não disparou (zero concessão) também precisa contar como
-- exclusivo, mesma lacuna que já foi corrigida pro cupom principal.
DROP FUNCTION IF EXISTS ufersin.validate_coupon(text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.validate_coupon(
  p_code text,
  p_promotion_id text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_coupon ufersin.coupons%ROWTYPE;
  v_is_targeted boolean;
BEGIN
  SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF v_coupon.active = 0 THEN
    RAISE EXCEPTION 'coupon is not active';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
  END IF;
  IF v_coupon.kind = 'aniversario' THEN
    IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = ''
       OR extract(month FROM p_customer_birthdate::date) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id)
      OR EXISTS(SELECT 1 FROM ufersin.crm_segment_coupons WHERE coupon_id = v_coupon.id)
      OR EXISTS(SELECT 1 FROM ufersin.crm_campanha_extra_coupons WHERE coupon_id = v_coupon.id)
    INTO v_is_targeted;
  IF v_is_targeted THEN
    IF p_customer_whatsapp IS NULL OR trim(p_customer_whatsapp) = '' THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM ufersin.coupon_grants
      WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
    ) THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value,
    'shipping_discount_type', v_coupon.shipping_discount_type, 'shipping_discount_value', v_coupon.shipping_discount_value,
    'combinable_with_public', (v_coupon.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = v_coupon.id
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.validate_coupon(text, text, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text,
  p_address text,
  p_items jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_promotion_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_item               jsonb;
  v_product            ufersin.products%ROWTYPE;
  v_quantity           bigint;
  v_subtotal           double precision := 0;
  v_shipping           double precision := 0;
  v_discount_amount    double precision := 0;
  v_shipping_discount  double precision := 0;
  v_customer_id        text;
  v_order_id           text := gen_random_uuid()::text;
  v_item_id            text;
  v_settings           ufersin.shipping_settings%ROWTYPE;
  v_km                 double precision;
  v_birthdate          date;
  v_promotion          ufersin.promotions%ROWTYPE;
  v_coupon             ufersin.coupons%ROWTYPE;
  v_coupon_code        text;
  v_grant              ufersin.coupon_grants%ROWTYPE;
  v_is_targeted        boolean;
  v_pd                 ufersin.coupon_product_discounts%ROWTYPE;
  v_cpd                ufersin.promotion_product_discounts%ROWTYPE;
  v_item_total         double precision;
  v_total              double precision;
  v_submitted_ids      text[];
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_promotion_id IS NOT NULL THEN
    SELECT * INTO v_promotion FROM ufersin.promotions WHERE id = p_promotion_id;
    IF NOT FOUND OR v_promotion.active = 0
       OR (v_promotion.starts_at IS NOT NULL AND v_promotion.starts_at::timestamptz > now())
       OR (v_promotion.expires_at IS NOT NULL AND v_promotion.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'promotion is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_promotion.product_ids))
    ) THEN
      RAISE EXCEPTION 'this promotion checkout can only contain the promotion products';
    END IF;
    IF v_promotion.promotion_type = 'kit' THEN
      SELECT array_agg(DISTINCT i->>'product_id') INTO v_submitted_ids FROM jsonb_array_elements(p_items) i;
      IF v_submitted_ids IS NULL OR array_length(v_submitted_ids, 1) <> array_length(v_promotion.product_ids, 1)
         OR NOT (v_submitted_ids @> v_promotion.product_ids) THEN
        RAISE EXCEPTION 'this kit promotion can only be purchased as the full bundle';
      END IF;
    END IF;
  END IF;

  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id)
        OR EXISTS(SELECT 1 FROM ufersin.crm_segment_coupons WHERE coupon_id = v_coupon.id)
        OR EXISTS(SELECT 1 FROM ufersin.crm_campanha_extra_coupons WHERE coupon_id = v_coupon.id)
      INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM ufersin.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE ufersin.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;
    v_coupon_code := v_coupon.code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

    v_item_total := v_product.price * v_quantity;
    v_subtotal := v_subtotal + v_item_total;

    IF v_coupon.kind = 'produto' THEN
      SELECT * INTO v_pd FROM ufersin.coupon_product_discounts
        WHERE coupon_id = v_coupon.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_pd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_pd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_pd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;

    IF v_promotion.id IS NOT NULL AND v_promotion.promotion_type = 'selfie_service' THEN
      SELECT * INTO v_cpd FROM ufersin.promotion_product_discounts
        WHERE promotion_id = v_promotion.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_cpd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_cpd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_cpd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_promotion.id IS NOT NULL THEN
    IF v_promotion.promotion_type = 'kit' THEN
      IF v_promotion.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_promotion.discount_value / 100)::numeric, 2);
      ELSIF v_promotion.discount_type = 'fixed' THEN
        v_discount_amount := v_discount_amount + v_promotion.discount_value;
      END IF;
    END IF;
    IF v_promotion.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_promotion.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_promotion.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_promotion.shipping_discount_value;
    END IF;
  END IF;

  IF v_coupon.id IS NOT NULL THEN
    IF v_coupon.kind = 'frete' THEN
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.kind = 'desconto' AND v_coupon.discount_type IS NOT NULL THEN
        IF v_coupon.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + v_coupon.discount_value;
        END IF;
      END IF;
      IF v_coupon.shipping_discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.shipping_discount_value / 100)::numeric, 2);
      ELSIF v_coupon.shipping_discount_type = 'fixed' THEN
        v_shipping_discount := v_shipping_discount + v_coupon.shipping_discount_value;
      END IF;
    END IF;
    UPDATE ufersin.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, promotion_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_promotion_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_campanhas_evento_snapshot.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- 1) Cada cupom extra de uma campanha ganha SUA PRÓPRIA mensagem de
--    WhatsApp (message_template), em vez de forçosamente reusar a da
--    campanha — cada cupom pode ter um texto de disparo diferente.
--
-- 2) crm_segment_coupons ganha last_synced_segment_criteria: um
--    "retrato" do filter_criteria do segmento no momento em que o
--    trigger_criteria da campanha 'evento' foi calibrado pela última vez
--    (criação ou edição). Isso permite detectar com precisão QUAL campo
--    exato mudou desde então — antes só dava pra saber "tem campo novo
--    que a campanha não cobre", agora também dá pra saber "esse campo já
--    existia mas o valor dele mudou" (que também precisa de atenção).
--    Campo removido do segmento continua sendo ignorado de propósito.
--
-- Execução: depois de sunset_crm_campanhas_multi_cupom.sql.
-- =====================================================

ALTER TABLE ufersin.crm_campanha_extra_coupons ADD COLUMN IF NOT EXISTS message_template TEXT;
ALTER TABLE ufersin.crm_segment_coupons ADD COLUMN IF NOT EXISTS last_synced_segment_criteria JSONB;

-- Campanhas já existentes: sem retrato anterior, assume o critério ATUAL
-- do segmento como ponto de partida (não trata todo mundo como
-- desatualizado de repente só por causa desta migration).
UPDATE ufersin.crm_segment_coupons cc
  SET last_synced_segment_criteria = (SELECT s.filter_criteria FROM ufersin.crm_segments s WHERE s.id = cc.segment_id)
  WHERE last_synced_segment_criteria IS NULL;

CREATE OR REPLACE FUNCTION ufersin._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'last_synced_segment_criteria', last_synced_segment_criteria,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'coupon', ufersin._coupon_json(ec.coupon_id), 'message_template', ec.message_template
      ) ORDER BY ec.created_at)
      FROM ufersin.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM ufersin.crm_segment_coupons WHERE id = p_id;
$$;

-- admin_create_campanha_coupon: mesma assinatura de antes, só passa a
-- gravar o retrato inicial do critério do segmento.
CREATE OR REPLACE FUNCTION ufersin.admin_create_campanha_coupon(
  p_token text,
  p_segment_id text,
  p_orientation text,
  p_message_template text,
  p_code text,
  p_customer_whatsapps text[] DEFAULT '{}',
  p_trigger_criteria jsonb DEFAULT NULL,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_segment       ufersin.crm_segments%ROWTYPE;
  v_coupon_id     text := gen_random_uuid()::text;
  v_row_id        text := gen_random_uuid()::text;
  v_code          text := upper(trim(p_code));
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_kind          text;
  v_pd            jsonb;
  v_whatsapp      text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_orientation NOT IN ('segmento', 'evento') THEN
    RAISE EXCEPTION 'invalid orientation';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;

  SELECT * INTO v_segment FROM ufersin.crm_segments WHERE id = p_segment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;

  IF p_orientation = 'evento' THEN
    IF p_trigger_criteria IS NULL THEN
      RAISE EXCEPTION 'trigger_criteria is required for orientation=evento';
    END IF;
    IF p_trigger_criteria = v_segment.filter_criteria THEN
      RAISE EXCEPTION 'trigger_criteria must differ from the segment''s current filter in at least one field';
    END IF;
  END IF;

  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a campanha coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  BEGIN
    INSERT INTO ufersin.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      combinable_with_public, allow_promotion_checkout, expires_at, max_uses
    ) VALUES (
      v_coupon_id, v_code, v_kind,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_type WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_value WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      NULLIF(trim(p_expires_at), ''), p_max_uses
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  INSERT INTO ufersin.crm_segment_coupons (
    id, segment_id, coupon_id, orientation, trigger_criteria, message_template, uses_per_customer, last_fired_at,
    last_synced_segment_criteria
  ) VALUES (
    v_row_id, p_segment_id, v_coupon_id, p_orientation, p_trigger_criteria,
    trim(p_message_template), p_uses_per_customer,
    CASE WHEN p_orientation = 'segmento' THEN now()::text ELSE NULL END,
    v_segment.filter_criteria
  );

  IF p_orientation = 'segmento' THEN
    FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
      IF v_whatsapp IS NOT NULL AND trim(v_whatsapp) <> '' THEN
        INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          SELECT gen_random_uuid()::text, v_coupon_id, v_whatsapp, p_uses_per_customer, 0
          WHERE NOT EXISTS (
            SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon_id AND customer_whatsapp = v_whatsapp
          );
      END IF;
    END LOOP;
  END IF;

  RETURN ufersin._campanha_coupon_json(v_row_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campanha_coupon(text, text, text, text, text, text[], jsonb, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- admin_update_campanha_coupon: mesma assinatura, mas agora sempre que
-- p_trigger_criteria vem preenchido (só acontece pra 'evento'), também
-- re-sincroniza o retrato do critério do segmento — o admin acabou de
-- revisar/ajustar os campos-alvo, então esse é o novo ponto de partida.
CREATE OR REPLACE FUNCTION ufersin.admin_update_campanha_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_trigger_criteria jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row           ufersin.crm_segment_coupons%ROWTYPE;
  v_segment       ufersin.crm_segments%ROWTYPE;
  v_kind          text;
  v_pd            jsonb;
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE ufersin.coupons SET
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = v_row.coupon_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE ufersin.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  IF v_row.orientation = 'evento' AND p_trigger_criteria IS NOT NULL THEN
    SELECT * INTO v_segment FROM ufersin.crm_segments WHERE id = v_row.segment_id;
  END IF;

  UPDATE ufersin.crm_segment_coupons SET
    message_template = trim(p_message_template),
    uses_per_customer = p_uses_per_customer,
    trigger_criteria = CASE WHEN orientation = 'evento' AND p_trigger_criteria IS NOT NULL THEN p_trigger_criteria ELSE trigger_criteria END,
    last_synced_segment_criteria = CASE WHEN orientation = 'evento' AND p_trigger_criteria IS NOT NULL THEN v_segment.filter_criteria ELSE last_synced_segment_criteria END
  WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb, jsonb) TO anon, authenticated;

-- admin_create_campanha_extra_coupon ganha p_message_template — assinatura
-- mudou (mais um parâmetro), precisa derrubar a versão antiga primeiro.
DROP FUNCTION IF EXISTS ufersin.admin_create_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_create_campanha_extra_coupon(
  p_token text,
  p_campanha_id text,
  p_code text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_campanha      ufersin.crm_segment_coupons%ROWTYPE;
  v_coupon_id     text := gen_random_uuid()::text;
  v_row_id        text := gen_random_uuid()::text;
  v_code          text := upper(trim(p_code));
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_kind          text;
  v_pd            jsonb;
  v_grant         ufersin.coupon_grants%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_campanha FROM ufersin.crm_segment_coupons WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a campanha coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  BEGIN
    INSERT INTO ufersin.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      combinable_with_public, allow_promotion_checkout, expires_at, max_uses
    ) VALUES (
      v_coupon_id, v_code, v_kind,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_type WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_value WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      NULLIF(trim(p_expires_at), ''), p_max_uses
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  IF v_campanha.active = 0 THEN
    UPDATE ufersin.coupons SET active = 0 WHERE id = v_coupon_id;
  END IF;

  INSERT INTO ufersin.crm_campanha_extra_coupons (id, campanha_id, coupon_id, message_template)
    VALUES (v_row_id, p_campanha_id, v_coupon_id, trim(p_message_template));

  FOR v_grant IN SELECT * FROM ufersin.coupon_grants WHERE coupon_id = v_campanha.coupon_id LOOP
    INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
      VALUES (gen_random_uuid()::text, v_coupon_id, v_grant.customer_whatsapp, p_uses_per_customer, 0);
  END LOOP;

  RETURN ufersin._coupon_json(v_coupon_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_campanhas_novo_fluxo.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Campanha vira uma cadeia de 3 passos independentes, cada um com seu
-- próprio subcard/popup no front:
--   1) cadastro da campanha (nome, descrição, duração) — cria a linha
--      SEM gatilho e SEM cupom nenhum;
--   2) gatilho do evento (só pra orientation='evento') — define/edita o
--      trigger_criteria a qualquer momento depois, decoupled do
--      segmento;
--   3) cupom(s) exclusivo(s) — o primeiro cupom criado vira o "principal"
--      da campanha (preenche coupon_id, que até então é NULL); os
--      seguintes entram como extras, igual já funcionava.
--
-- Isso exige coupon_id deixar de ser NOT NULL em crm_segment_coupons —
-- toda a validação de "cupom alvo/exclusivo" (validate_coupon,
-- create_order) já faz EXISTS(...WHERE coupon_id = v_coupon.id), que
-- nunca casa com NULL, então nenhuma dessas funções precisa mudar.
--
-- Execução: depois de sunset_crm_campanhas_evento_snapshot.sql.
-- =====================================================

ALTER TABLE ufersin.crm_segment_coupons ALTER COLUMN coupon_id DROP NOT NULL;
ALTER TABLE ufersin.crm_segment_coupons ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE ufersin.crm_segment_coupons ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE ufersin.crm_segment_coupons ADD COLUMN IF NOT EXISTS starts_at TEXT;
ALTER TABLE ufersin.crm_segment_coupons ADD COLUMN IF NOT EXISTS ends_at TEXT;

-- Campanhas já existentes (criadas pelo fluxo antigo, tudo de uma vez)
-- ganham um nome retroativo só pra não ficar em branco na listagem.
UPDATE ufersin.crm_segment_coupons SET name = 'Campanha ' || to_char(created_at::timestamptz, 'DD/MM/YYYY')
  WHERE name = '';

CREATE OR REPLACE FUNCTION ufersin._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'name', name, 'description', description, 'starts_at', starts_at, 'ends_at', ends_at,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'last_synced_segment_criteria', last_synced_segment_criteria,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'coupon', ufersin._coupon_json(ec.coupon_id), 'message_template', ec.message_template
      ) ORDER BY ec.created_at)
      FROM ufersin.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM ufersin.crm_segment_coupons WHERE id = p_id;
$$;

-- Cria só o "cadastro" da campanha — sem gatilho, sem cupom. Pra
-- orientation='evento' o gatilho fica NULL até o admin configurar no
-- subcard próprio (admin_set_campanha_gatilho); pra 'segmento' nunca
-- existe gatilho — ela dispara sozinha assim que o primeiro cupom for
-- criado (ver admin_create_campanha_extra_coupon).
CREATE OR REPLACE FUNCTION ufersin.admin_create_campanha(
  p_token text,
  p_segment_id text,
  p_orientation text,
  p_name text,
  p_description text DEFAULT NULL,
  p_starts_at text DEFAULT NULL,
  p_ends_at text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF p_orientation NOT IN ('segmento', 'evento') THEN
    RAISE EXCEPTION 'invalid orientation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ufersin.crm_segments WHERE id = p_segment_id) THEN
    RAISE EXCEPTION 'segment not found';
  END IF;

  INSERT INTO ufersin.crm_segment_coupons (
    id, segment_id, coupon_id, orientation, name, description, starts_at, ends_at,
    message_template, uses_per_customer
  ) VALUES (
    v_row_id, p_segment_id, NULL, p_orientation, trim(p_name), NULLIF(trim(p_description), ''),
    NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_ends_at), ''), '', 1
  );

  RETURN ufersin._campanha_coupon_json(v_row_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campanha(text, text, text, text, text, text, text) TO anon, authenticated;

-- Define/edita o gatilho (trigger_criteria) de uma campanha 'evento' —
-- não mexe em nome/descrição/duração nem em nenhum cupom. Fica de fora
-- de admin_update_campanha_coupon de propósito: essa função exige
-- message_template válido, que não existe enquanto não há cupom nenhum.
CREATE OR REPLACE FUNCTION ufersin.admin_set_campanha_gatilho(p_token text, p_id text, p_trigger_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row     ufersin.crm_segment_coupons%ROWTYPE;
  v_segment ufersin.crm_segments%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas have a gatilho';
  END IF;
  IF p_trigger_criteria IS NULL THEN
    RAISE EXCEPTION 'trigger_criteria is required';
  END IF;

  SELECT * INTO v_segment FROM ufersin.crm_segments WHERE id = v_row.segment_id;
  IF p_trigger_criteria = v_segment.filter_criteria THEN
    RAISE EXCEPTION 'trigger_criteria must differ from the segment''s current filter in at least one field';
  END IF;

  UPDATE ufersin.crm_segment_coupons SET
    trigger_criteria = p_trigger_criteria,
    last_synced_segment_criteria = v_segment.filter_criteria
  WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_set_campanha_gatilho(text, text, jsonb) TO anon, authenticated;

-- admin_create_campanha_extra_coupon: agora também cobre o caso "esta
-- campanha ainda não tem cupom nenhum" — o cupom criado vira o
-- PRINCIPAL (preenche coupon_id na própria linha) em vez de entrar na
-- tabela de extras. Se for 'segmento' e ainda não tinha disparado,
-- dispara agora (concede pra quem já bate o critério do segmento) —
-- exatamente o que a criação tudo-de-uma-vez fazia antes, só que adiado
-- pra este momento. Se for 'evento', só arma mesmo, sem conceder nada
-- (precisa de "Verificar" ou do auto-check bater o gatilho depois).
DROP FUNCTION IF EXISTS ufersin.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_create_campanha_extra_coupon(
  p_token text,
  p_campanha_id text,
  p_code text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_customer_whatsapps text[] DEFAULT '{}'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_campanha      ufersin.crm_segment_coupons%ROWTYPE;
  v_coupon_id     text := gen_random_uuid()::text;
  v_row_id        text := gen_random_uuid()::text;
  v_code          text := upper(trim(p_code));
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_kind          text;
  v_pd            jsonb;
  v_grant         ufersin.coupon_grants%ROWTYPE;
  v_is_primary    boolean;
  v_in_window     boolean;
  v_whatsapp      text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_campanha FROM ufersin.crm_segment_coupons WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  v_is_primary := v_campanha.coupon_id IS NULL;
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a campanha coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  BEGIN
    INSERT INTO ufersin.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      combinable_with_public, allow_promotion_checkout, expires_at, max_uses
    ) VALUES (
      v_coupon_id, v_code, v_kind,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_type WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_value WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      NULLIF(trim(p_expires_at), ''), p_max_uses
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  IF v_campanha.active = 0 THEN
    UPDATE ufersin.coupons SET active = 0 WHERE id = v_coupon_id;
  END IF;

  v_in_window := (v_campanha.starts_at IS NULL OR v_campanha.starts_at::timestamptz <= now())
    AND (v_campanha.ends_at IS NULL OR v_campanha.ends_at::timestamptz >= now());

  IF v_is_primary THEN
    UPDATE ufersin.crm_segment_coupons SET
      coupon_id = v_coupon_id,
      message_template = trim(p_message_template),
      uses_per_customer = p_uses_per_customer,
      last_fired_at = CASE WHEN orientation = 'segmento' AND v_in_window THEN now()::text ELSE last_fired_at END
    WHERE id = p_campanha_id;

    IF v_campanha.orientation = 'segmento' AND v_in_window THEN
      FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
        IF v_whatsapp IS NOT NULL AND trim(v_whatsapp) <> '' THEN
          INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
            SELECT gen_random_uuid()::text, v_coupon_id, v_whatsapp, p_uses_per_customer, 0
            WHERE NOT EXISTS (
              SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon_id AND customer_whatsapp = v_whatsapp
            );
        END IF;
      END LOOP;
    END IF;
  ELSE
    INSERT INTO ufersin.crm_campanha_extra_coupons (id, campanha_id, coupon_id, message_template)
      VALUES (v_row_id, p_campanha_id, v_coupon_id, trim(p_message_template));

    -- A campanha já disparou antes (tem concessão do cupom principal)?
    -- Esse cupom novo entra pra mesma turma na hora.
    FOR v_grant IN SELECT * FROM ufersin.coupon_grants WHERE coupon_id = v_campanha.coupon_id LOOP
      INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
        VALUES (gen_random_uuid()::text, v_coupon_id, v_grant.customer_whatsapp, p_uses_per_customer, 0);
    END LOOP;
  END IF;

  RETURN ufersin._coupon_json(v_coupon_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb, text[]) TO anon, authenticated;

-- admin_fire_campanha_event: agora ignora coupon_id NULL (campanha com
-- gatilho mas ainda sem nenhum cupom) em vez de tentar conceder um
-- cupom inexistente, e respeita a janela de duração da campanha.
CREATE OR REPLACE FUNCTION ufersin.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row       ufersin.crm_segment_coupons%ROWTYPE;
  v_coupon_id text;
  v_whatsapp  text;
  v_newly     text[] := '{}';
  v_in_window boolean;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas can be re-fired';
  END IF;
  IF v_row.active = 0 THEN
    RAISE EXCEPTION 'this campanha is paused';
  END IF;

  v_in_window := (v_row.starts_at IS NULL OR v_row.starts_at::timestamptz <= now())
    AND (v_row.ends_at IS NULL OR v_row.ends_at::timestamptz >= now());
  IF NOT v_in_window THEN
    RETURN jsonb_build_object('newly_granted', '[]'::jsonb);
  END IF;

  FOR v_coupon_id IN
    SELECT id FROM (
      SELECT v_row.coupon_id AS id
      UNION ALL
      SELECT coupon_id FROM ufersin.crm_campanha_extra_coupons WHERE campanha_id = p_id
    ) x WHERE id IS NOT NULL
  LOOP
    FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
      IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon_id AND customer_whatsapp = v_whatsapp) THEN
        INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          VALUES (gen_random_uuid()::text, v_coupon_id, v_whatsapp, v_row.uses_per_customer, 0);
        IF v_coupon_id = v_row.coupon_id THEN
          v_newly := array_append(v_newly, v_whatsapp);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  IF array_length(v_newly, 1) > 0 THEN
    UPDATE ufersin.crm_segment_coupons SET last_fired_at = now()::text WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_newly));
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_fire_campanha_event(text, text, text[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_campanhas_cadastro_e_cupom_extra_edit.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Dois popups de edição que faltavam na cadeia campanha->gatilho->cupom:
--
-- 1) admin_update_campanha_cadastro — edita nome/descrição/duração da
--    campanha (o "cadastro"), sem mexer em gatilho nem em cupom nenhum.
--    Antes o botão "Editar" do card de cadastro abria por engano o
--    formulário de cupom — esta função é o que faltava pra abrir o
--    formulário certo.
--
-- 2) admin_update_campanha_extra_coupon — edita mensagem/desconto/prazo
--    de um cupom EXTRA já existente (o principal já tinha
--    admin_update_campanha_coupon; os extras só tinham criar/apagar).
--
-- Execução: depois de sunset_crm_campanhas_novo_fluxo.sql.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.admin_update_campanha_cadastro(
  p_token text,
  p_id text,
  p_name text,
  p_description text DEFAULT NULL,
  p_starts_at text DEFAULT NULL,
  p_ends_at text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM ufersin.crm_segment_coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;

  UPDATE ufersin.crm_segment_coupons SET
    name = trim(p_name),
    description = NULLIF(trim(p_description), ''),
    starts_at = NULLIF(trim(p_starts_at), ''),
    ends_at = NULLIF(trim(p_ends_at), '')
  WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campanha_cadastro(text, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_campanha_extra_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row           ufersin.crm_campanha_extra_coupons%ROWTYPE;
  v_kind          text;
  v_pd            jsonb;
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_campanha_extra_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extra coupon not found';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE ufersin.coupons SET
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = v_row.coupon_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE ufersin.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  UPDATE ufersin.crm_campanha_extra_coupons SET message_template = trim(p_message_template) WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(v_row.campanha_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_cupom_avulso_multi_tipo.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Cupom avulso deixa de ter um único "tipo" exclusivo — agora são
-- eixos independentes que combinam livremente no mesmo cupom:
--   - desconto no subtotal (nenhum/flat/por produto) — igual campanha,
--     só que aqui "nenhum" é permitido (cupom pode ser só de frete);
--   - "também dar desconto no frete" (shipping_discount_type/value) —
--     mesmas colunas que campanha já usa, só nunca eram expostas aqui;
--   - "aniversário do cliente": passa a ser um cupom ALVO de verdade —
--     concedido automaticamente N dias antes do aniversário de cada
--     cliente (não mais "digite o código durante o mês"), com mensagem
--     de WhatsApp própria;
--   - "aniversário da loja": mesma ideia, mas concede pra TODOS os
--     clientes, disparado N dias antes de uma data fixa (MM-DD).
--   - início/fim de validade (starts_at somado ao expires_at que já
--     existia) valem pra QUALQUER cupom avulso, não só os de
--     aniversário.
--
-- kind ('desconto'|'frete'|'aniversario'|'produto') continua existindo
-- só por compatibilidade com cupons já criados pelo fluxo antigo — cupom
-- NOVO sempre nasce com kind='desconto' ou 'produto' (frete e aniversário
-- viram os campos abaixo, combináveis com qualquer um dos dois).
--
-- Execução: pode rodar a qualquer momento (idempotente).
-- =====================================================

ALTER TABLE ufersin.coupons ADD COLUMN IF NOT EXISTS starts_at TEXT;
ALTER TABLE ufersin.coupons ADD COLUMN IF NOT EXISTS message_template TEXT;
ALTER TABLE ufersin.coupons ADD COLUMN IF NOT EXISTS bday_customer_days_before BIGINT;
ALTER TABLE ufersin.coupons ADD COLUMN IF NOT EXISTS bday_store_date TEXT;
ALTER TABLE ufersin.coupons ADD COLUMN IF NOT EXISTS bday_store_days_before BIGINT;

CREATE OR REPLACE FUNCTION ufersin._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_promotion_checkout', (c.allow_promotion_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'active', (c.active <> 0),
    'starts_at', c.starts_at, 'expires_at', c.expires_at, 'max_uses', c.max_uses, 'used_count', c.used_count, 'created_at', c.created_at,
    'message_template', c.message_template,
    'bday_customer_days_before', c.bday_customer_days_before,
    'bday_store_date', c.bday_store_date, 'bday_store_days_before', c.bday_store_days_before,
    'grant_count', (SELECT COUNT(*) FROM ufersin.coupon_grants g WHERE g.coupon_id = c.id),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  ) FROM ufersin.coupons c WHERE c.id = p_id;
$$;

DROP FUNCTION IF EXISTS ufersin.admin_create_coupon(text, text, text, text, double precision, boolean, text, bigint, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_create_coupon(
  p_token text,
  p_code text,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_combinable_with_public boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_message_template text DEFAULT NULL,
  p_bday_customer_days_before bigint DEFAULT NULL,
  p_bday_store_date text DEFAULT NULL,
  p_bday_store_days_before bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_has_bday boolean := p_bday_customer_days_before IS NOT NULL OR p_bday_store_date IS NOT NULL;
  v_kind text := CASE WHEN v_has_products THEN 'produto' ELSE 'desconto' END;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid discount_type';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  IF v_has_bday AND (trim(COALESCE(p_message_template, '')) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%') THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_bday_customer_days_before IS NOT NULL AND p_bday_customer_days_before < 0 THEN
    RAISE EXCEPTION 'bday_customer_days_before must be zero or positive';
  END IF;
  IF p_bday_store_date IS NOT NULL AND p_bday_store_days_before IS NULL THEN
    RAISE EXCEPTION 'bday_store_days_before is required when bday_store_date is set';
  END IF;

  BEGIN
    INSERT INTO ufersin.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      allow_promotion_checkout, combinable_with_public, starts_at, expires_at, max_uses,
      message_template, bday_customer_days_before, bday_store_date, bday_store_days_before
    ) VALUES (
      v_id, v_code, v_kind,
      CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      p_shipping_discount_type, p_shipping_discount_value,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), ''), p_max_uses,
      NULLIF(trim(p_message_template), ''), p_bday_customer_days_before,
      NULLIF(trim(p_bday_store_date), ''), p_bday_store_days_before
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (
          gen_random_uuid()::text, v_id, v_pd->>'product_id',
          v_pd->>'discount_type', (v_pd->>'discount_value')::double precision
        );
    END LOOP;
  END IF;

  RETURN ufersin._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_coupon(text, text, text, double precision, text, double precision, boolean, boolean, text, text, bigint, jsonb, text, bigint, text, bigint) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.admin_update_coupon(text, text, boolean, boolean, text, bigint, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_update_coupon(
  p_token text,
  p_id text,
  p_active boolean,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_combinable_with_public boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_message_template text DEFAULT NULL,
  p_bday_customer_days_before bigint DEFAULT NULL,
  p_bday_store_date text DEFAULT NULL,
  p_bday_store_days_before bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_has_bday boolean := p_bday_customer_days_before IS NOT NULL OR p_bday_store_date IS NOT NULL;
  v_kind text := CASE WHEN v_has_products THEN 'produto' ELSE 'desconto' END;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM ufersin.coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  IF v_has_bday AND (trim(COALESCE(p_message_template, '')) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%') THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_bday_store_date IS NOT NULL AND p_bday_store_days_before IS NULL THEN
    RAISE EXCEPTION 'bday_store_days_before is required when bday_store_date is set';
  END IF;

  UPDATE ufersin.coupons SET
    kind = v_kind,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
    shipping_discount_type = p_shipping_discount_type,
    shipping_discount_value = p_shipping_discount_value,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''),
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    message_template = NULLIF(trim(p_message_template), ''),
    bday_customer_days_before = p_bday_customer_days_before,
    bday_store_date = NULLIF(trim(p_bday_store_date), ''),
    bday_store_days_before = p_bday_store_days_before
  WHERE id = p_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = p_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN ufersin._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_coupon(text, text, boolean, text, double precision, text, double precision, boolean, boolean, text, text, bigint, jsonb, text, bigint, text, bigint) TO anon, authenticated;

-- validate_coupon/create_order: cupom com starts_at ainda não começou
-- não pode ser usado; cupom de aniversário (cliente ou loja) é sempre
-- "alvo" (só quem foi concedido pode usar), mesma regra que campanha.
DROP FUNCTION IF EXISTS ufersin.validate_coupon(text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.validate_coupon(
  p_code text,
  p_promotion_id text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_customer_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_coupon ufersin.coupons%ROWTYPE;
  v_is_targeted boolean;
BEGIN
  SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF v_coupon.active = 0 THEN
    RAISE EXCEPTION 'coupon is not active';
  END IF;
  IF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at::timestamptz > now() THEN
    RAISE EXCEPTION 'coupon is not active yet';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RAISE EXCEPTION 'coupon usage limit reached';
  END IF;
  IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
    RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
  END IF;
  IF v_coupon.kind = 'aniversario' THEN
    IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = ''
       OR extract(month FROM p_customer_birthdate::date) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id)
      OR EXISTS(SELECT 1 FROM ufersin.crm_segment_coupons WHERE coupon_id = v_coupon.id)
      OR EXISTS(SELECT 1 FROM ufersin.crm_campanha_extra_coupons WHERE coupon_id = v_coupon.id)
      OR v_coupon.bday_customer_days_before IS NOT NULL OR v_coupon.bday_store_date IS NOT NULL
    INTO v_is_targeted;
  IF v_is_targeted THEN
    IF p_customer_whatsapp IS NULL OR trim(p_customer_whatsapp) = '' THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM ufersin.coupon_grants
      WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
    ) THEN
      RAISE EXCEPTION 'this coupon is not available for your account';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'code', v_coupon.code, 'kind', v_coupon.kind,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value,
    'shipping_discount_type', v_coupon.shipping_discount_type, 'shipping_discount_value', v_coupon.shipping_discount_value,
    'combinable_with_public', (v_coupon.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = v_coupon.id
    ), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.validate_coupon(text, text, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text);

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text,
  p_address text,
  p_items jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_promotion_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_item               jsonb;
  v_product            ufersin.products%ROWTYPE;
  v_quantity           bigint;
  v_subtotal           double precision := 0;
  v_shipping           double precision := 0;
  v_discount_amount    double precision := 0;
  v_shipping_discount  double precision := 0;
  v_customer_id        text;
  v_order_id           text := gen_random_uuid()::text;
  v_item_id            text;
  v_settings           ufersin.shipping_settings%ROWTYPE;
  v_km                 double precision;
  v_birthdate          date;
  v_promotion          ufersin.promotions%ROWTYPE;
  v_coupon             ufersin.coupons%ROWTYPE;
  v_coupon_code        text;
  v_grant              ufersin.coupon_grants%ROWTYPE;
  v_is_targeted        boolean;
  v_pd                 ufersin.coupon_product_discounts%ROWTYPE;
  v_cpd                ufersin.promotion_product_discounts%ROWTYPE;
  v_item_total         double precision;
  v_total              double precision;
  v_submitted_ids      text[];
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_promotion_id IS NOT NULL THEN
    SELECT * INTO v_promotion FROM ufersin.promotions WHERE id = p_promotion_id;
    IF NOT FOUND OR v_promotion.active = 0
       OR (v_promotion.starts_at IS NOT NULL AND v_promotion.starts_at::timestamptz > now())
       OR (v_promotion.expires_at IS NOT NULL AND v_promotion.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'promotion is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_promotion.product_ids))
    ) THEN
      RAISE EXCEPTION 'this promotion checkout can only contain the promotion products';
    END IF;
    IF v_promotion.promotion_type = 'kit' THEN
      SELECT array_agg(DISTINCT i->>'product_id') INTO v_submitted_ids FROM jsonb_array_elements(p_items) i;
      IF v_submitted_ids IS NULL OR array_length(v_submitted_ids, 1) <> array_length(v_promotion.product_ids, 1)
         OR NOT (v_submitted_ids @> v_promotion.product_ids) THEN
        RAISE EXCEPTION 'this kit promotion can only be purchased as the full bundle';
      END IF;
    END IF;
  END IF;

  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at::timestamptz > now() THEN
      RAISE EXCEPTION 'coupon is not active yet';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id)
        OR EXISTS(SELECT 1 FROM ufersin.crm_segment_coupons WHERE coupon_id = v_coupon.id)
        OR EXISTS(SELECT 1 FROM ufersin.crm_campanha_extra_coupons WHERE coupon_id = v_coupon.id)
        OR v_coupon.bday_customer_days_before IS NOT NULL OR v_coupon.bday_store_date IS NOT NULL
      INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM ufersin.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE ufersin.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;
    v_coupon_code := v_coupon.code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

    v_item_total := v_product.price * v_quantity;
    v_subtotal := v_subtotal + v_item_total;

    IF v_coupon.kind = 'produto' THEN
      SELECT * INTO v_pd FROM ufersin.coupon_product_discounts
        WHERE coupon_id = v_coupon.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_pd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_pd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_pd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;

    IF v_promotion.id IS NOT NULL AND v_promotion.promotion_type = 'selfie_service' THEN
      SELECT * INTO v_cpd FROM ufersin.promotion_product_discounts
        WHERE promotion_id = v_promotion.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_cpd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_cpd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_cpd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_promotion.id IS NOT NULL THEN
    IF v_promotion.promotion_type = 'kit' THEN
      IF v_promotion.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_promotion.discount_value / 100)::numeric, 2);
      ELSIF v_promotion.discount_type = 'fixed' THEN
        v_discount_amount := v_discount_amount + v_promotion.discount_value;
      END IF;
    END IF;
    IF v_promotion.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_promotion.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_promotion.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_promotion.shipping_discount_value;
    END IF;
  END IF;

  IF v_coupon.id IS NOT NULL THEN
    IF v_coupon.kind = 'frete' THEN
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.kind = 'desconto' AND v_coupon.discount_type IS NOT NULL THEN
        IF v_coupon.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + v_coupon.discount_value;
        END IF;
      END IF;
      IF v_coupon.shipping_discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.shipping_discount_value / 100)::numeric, 2);
      ELSIF v_coupon.shipping_discount_type = 'fixed' THEN
        v_shipping_discount := v_shipping_discount + v_coupon.shipping_discount_value;
      END IF;
    END IF;
    UPDATE ufersin.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, promotion_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_promotion_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

-- Concede (idempotente) os cupons de aniversário (cliente e loja) cujo
-- dia de disparo é HOJE — "dia de disparo" = data-alvo menos
-- dias_antes. Sem cron no projeto, isso roda do front (AdminCrm) toda
-- vez que o admin abre o CRM, igual ao auto-check de campanha evento.
CREATE OR REPLACE FUNCTION ufersin.admin_check_birthday_coupons(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_coupon    ufersin.coupons%ROWTYPE;
  v_customer  ufersin.customers%ROWTYPE;
  v_target    date;
  v_out       jsonb := '[]'::jsonb;
  v_newly     text[];
BEGIN
  PERFORM ufersin._require_admin(p_token);

  FOR v_coupon IN SELECT * FROM ufersin.coupons WHERE active = 1 AND bday_customer_days_before IS NOT NULL LOOP
    v_newly := '{}';
    FOR v_customer IN SELECT * FROM ufersin.customers WHERE birthdate IS NOT NULL LOOP
      v_target := current_date + v_coupon.bday_customer_days_before;
      IF extract(month FROM v_customer.birthdate) = extract(month FROM v_target)
         AND extract(day FROM v_customer.birthdate) = extract(day FROM v_target) THEN
        IF NOT EXISTS (SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id AND customer_whatsapp = v_customer.whatsapp) THEN
          INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
            VALUES (gen_random_uuid()::text, v_coupon.id, v_customer.whatsapp, 1, 0);
          v_newly := array_append(v_newly, v_customer.whatsapp);
        END IF;
      END IF;
    END LOOP;
    IF array_length(v_newly, 1) > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'coupon_id', v_coupon.id, 'message_template', v_coupon.message_template, 'newly_granted', to_jsonb(v_newly)
      ));
    END IF;
  END LOOP;

  FOR v_coupon IN SELECT * FROM ufersin.coupons WHERE active = 1 AND bday_store_date IS NOT NULL LOOP
    v_target := current_date + v_coupon.bday_store_days_before;
    IF to_char(v_target, 'MM-DD') = v_coupon.bday_store_date THEN
      v_newly := '{}';
      FOR v_customer IN SELECT * FROM ufersin.customers LOOP
        IF NOT EXISTS (SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id AND customer_whatsapp = v_customer.whatsapp) THEN
          INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
            VALUES (gen_random_uuid()::text, v_coupon.id, v_customer.whatsapp, 1, 0);
          v_newly := array_append(v_newly, v_customer.whatsapp);
        END IF;
      END LOOP;
      IF array_length(v_newly, 1) > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'coupon_id', v_coupon.id, 'message_template', v_coupon.message_template, 'newly_granted', to_jsonb(v_newly)
        ));
      END IF;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_check_birthday_coupons(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_crm_campanhas_encerrar_evento_e_agenda.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- 1) Gatilho pode ser limpo (p_trigger_criteria = NULL volta a campanha
--    pro estado "sem critério ainda") — antes só dava pra setar, nunca
--    apagar.
-- 2) Cupom principal pode ser removido da campanha (fica "aguardando
--    cupom" de novo, igual antes do primeiro cupom ser criado) — mesma
--    lógica de admin_delete_campanha_extra_coupon, só que pro slot
--    principal.
-- 3) Cupom exclusivo (principal e extras) ganha agenda de início
--    (starts_at, no cupom em si — ufersin.coupons já tem essa coluna) —
--    o disparo automático (evento e bootstrap de 'segmento') passa a
--    respeitar essa janela por cupom, não só a janela da campanha.
-- 4) "Encerrar por evento": campanha inteira (end_criteria em
--    crm_segment_coupons) ou só um cupom extra (end_criteria em
--    crm_campanha_extra_coupons) — quando o critério bate (mesmo
--    mecanismo do gatilho, calculado no front), desativa
--    automaticamente. Cupom principal usa o end_criteria da própria
--    campanha (não tem um separado).
--
-- Execução: depois de sunset_cupom_avulso_multi_tipo.sql.
-- =====================================================

ALTER TABLE ufersin.crm_segment_coupons ADD COLUMN IF NOT EXISTS end_criteria JSONB;
ALTER TABLE ufersin.crm_campanha_extra_coupons ADD COLUMN IF NOT EXISTS end_criteria JSONB;

CREATE OR REPLACE FUNCTION ufersin._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'name', name, 'description', description, 'starts_at', starts_at, 'ends_at', ends_at,
    'trigger_criteria', trigger_criteria, 'end_criteria', end_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'last_synced_segment_criteria', last_synced_segment_criteria,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'coupon', ufersin._coupon_json(ec.coupon_id), 'message_template', ec.message_template, 'end_criteria', ec.end_criteria
      ) ORDER BY ec.created_at)
      FROM ufersin.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM ufersin.crm_segment_coupons WHERE id = p_id;
$$;

-- p_trigger_criteria = NULL agora é uma limpeza válida (volta pro
-- estado "sem critério"), não um erro — só a validação "precisa
-- diferir do segmento" continua exigindo NOT NULL.
CREATE OR REPLACE FUNCTION ufersin.admin_set_campanha_gatilho(p_token text, p_id text, p_trigger_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row     ufersin.crm_segment_coupons%ROWTYPE;
  v_segment ufersin.crm_segments%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas have a gatilho';
  END IF;

  IF p_trigger_criteria IS NULL THEN
    UPDATE ufersin.crm_segment_coupons SET trigger_criteria = NULL, last_synced_segment_criteria = NULL WHERE id = p_id;
    RETURN ufersin._campanha_coupon_json(p_id);
  END IF;

  SELECT * INTO v_segment FROM ufersin.crm_segments WHERE id = v_row.segment_id;
  IF p_trigger_criteria = v_segment.filter_criteria THEN
    RAISE EXCEPTION 'trigger_criteria must differ from the segment''s current filter in at least one field';
  END IF;

  UPDATE ufersin.crm_segment_coupons SET
    trigger_criteria = p_trigger_criteria,
    last_synced_segment_criteria = v_segment.filter_criteria
  WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;

-- Define/edita o critério de encerramento automático da campanha
-- inteira (principal + extras) — NULL limpa.
CREATE OR REPLACE FUNCTION ufersin.admin_set_campanha_end_criteria(p_token text, p_id text, p_end_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM ufersin.crm_segment_coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  UPDATE ufersin.crm_segment_coupons SET end_criteria = p_end_criteria WHERE id = p_id;
  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_set_campanha_end_criteria(text, text, jsonb) TO anon, authenticated;

-- Mesma coisa, só que pra UM cupom extra específico (não a campanha
-- inteira) — NULL limpa.
CREATE OR REPLACE FUNCTION ufersin.admin_set_extra_coupon_end_criteria(p_token text, p_id text, p_end_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_campanha_id text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT campanha_id INTO v_campanha_id FROM ufersin.crm_campanha_extra_coupons WHERE id = p_id;
  IF v_campanha_id IS NULL THEN
    RAISE EXCEPTION 'extra coupon not found';
  END IF;
  UPDATE ufersin.crm_campanha_extra_coupons SET end_criteria = p_end_criteria WHERE id = p_id;
  RETURN ufersin._campanha_coupon_json(v_campanha_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_set_extra_coupon_end_criteria(text, text, jsonb) TO anon, authenticated;

-- Desativa só o cupom extra (não a campanha inteira) — usado quando o
-- end_criteria dele bate, calculado no front.
CREATE OR REPLACE FUNCTION ufersin.admin_deactivate_campanha_extra_coupon(p_token text, p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row ufersin.crm_campanha_extra_coupons%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_campanha_extra_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extra coupon not found';
  END IF;
  UPDATE ufersin.coupons SET active = 0 WHERE id = v_row.coupon_id;
  RETURN ufersin._campanha_coupon_json(v_row.campanha_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_deactivate_campanha_extra_coupon(text, text) TO anon, authenticated;

-- Desvincula o cupom PRINCIPAL da campanha (volta a "aguardando
-- cupom") — não apaga ufersin.coupons, mesma lógica de sempre.
CREATE OR REPLACE FUNCTION ufersin.admin_delete_campanha_primary_coupon(p_token text, p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM ufersin.crm_segment_coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  UPDATE ufersin.crm_segment_coupons SET coupon_id = NULL, message_template = '' WHERE id = p_id;
  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_delete_campanha_primary_coupon(text, text) TO anon, authenticated;

-- admin_update_campanha_coupon (cupom principal): ganha p_starts_at.
DROP FUNCTION IF EXISTS ufersin.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_update_campanha_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row           ufersin.crm_segment_coupons%ROWTYPE;
  v_kind          text;
  v_pd            jsonb;
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE ufersin.coupons SET
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''),
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = v_row.coupon_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE ufersin.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  UPDATE ufersin.crm_segment_coupons SET
    message_template = trim(p_message_template),
    uses_per_customer = p_uses_per_customer
  WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- admin_create_campanha_extra_coupon: ganha p_starts_at (persistido no
-- cupom, principal ou extra) — o bootstrap de 'segmento' só dispara se
-- a janela (campanha E cupom) já começou.
DROP FUNCTION IF EXISTS ufersin.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb, text[]);

CREATE OR REPLACE FUNCTION ufersin.admin_create_campanha_extra_coupon(
  p_token text,
  p_campanha_id text,
  p_code text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_customer_whatsapps text[] DEFAULT '{}'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_campanha      ufersin.crm_segment_coupons%ROWTYPE;
  v_coupon_id     text := gen_random_uuid()::text;
  v_row_id        text := gen_random_uuid()::text;
  v_code          text := upper(trim(p_code));
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_kind          text;
  v_pd            jsonb;
  v_grant         ufersin.coupon_grants%ROWTYPE;
  v_is_primary    boolean;
  v_in_window     boolean;
  v_whatsapp      text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_campanha FROM ufersin.crm_segment_coupons WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  v_is_primary := v_campanha.coupon_id IS NULL;
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a campanha coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  BEGIN
    INSERT INTO ufersin.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      combinable_with_public, allow_promotion_checkout, starts_at, expires_at, max_uses
    ) VALUES (
      v_coupon_id, v_code, v_kind,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_type WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_value WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), ''), p_max_uses
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  IF v_campanha.active = 0 THEN
    UPDATE ufersin.coupons SET active = 0 WHERE id = v_coupon_id;
  END IF;

  v_in_window := (v_campanha.starts_at IS NULL OR v_campanha.starts_at::timestamptz <= now())
    AND (v_campanha.ends_at IS NULL OR v_campanha.ends_at::timestamptz >= now())
    AND (p_starts_at IS NULL OR trim(p_starts_at) = '' OR p_starts_at::timestamptz <= now());

  IF v_is_primary THEN
    UPDATE ufersin.crm_segment_coupons SET
      coupon_id = v_coupon_id,
      message_template = trim(p_message_template),
      uses_per_customer = p_uses_per_customer,
      last_fired_at = CASE WHEN orientation = 'segmento' AND v_in_window THEN now()::text ELSE last_fired_at END
    WHERE id = p_campanha_id;

    IF v_campanha.orientation = 'segmento' AND v_in_window THEN
      FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
        IF v_whatsapp IS NOT NULL AND trim(v_whatsapp) <> '' THEN
          INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
            SELECT gen_random_uuid()::text, v_coupon_id, v_whatsapp, p_uses_per_customer, 0
            WHERE NOT EXISTS (
              SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon_id AND customer_whatsapp = v_whatsapp
            );
        END IF;
      END LOOP;
    END IF;
  ELSE
    INSERT INTO ufersin.crm_campanha_extra_coupons (id, campanha_id, coupon_id, message_template)
      VALUES (v_row_id, p_campanha_id, v_coupon_id, trim(p_message_template));

    -- A campanha já disparou antes (tem concessão do cupom principal)?
    -- Esse cupom novo entra pra mesma turma na hora — desde que a
    -- janela dele já tenha começado.
    IF v_in_window THEN
      FOR v_grant IN SELECT * FROM ufersin.coupon_grants WHERE coupon_id = v_campanha.coupon_id LOOP
        INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          VALUES (gen_random_uuid()::text, v_coupon_id, v_grant.customer_whatsapp, p_uses_per_customer, 0);
      END LOOP;
    END IF;
  END IF;

  RETURN ufersin._coupon_json(v_coupon_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb, text[]) TO anon, authenticated;

-- admin_update_campanha_extra_coupon: ganha p_starts_at.
DROP FUNCTION IF EXISTS ufersin.admin_update_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, bigint, text, double precision, text, double precision, jsonb);

CREATE OR REPLACE FUNCTION ufersin.admin_update_campanha_extra_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row           ufersin.crm_campanha_extra_coupons%ROWTYPE;
  v_kind          text;
  v_pd            jsonb;
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_campanha_extra_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extra coupon not found';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE ufersin.coupons SET
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''),
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses
  WHERE id = v_row.coupon_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE ufersin.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  UPDATE ufersin.crm_campanha_extra_coupons SET message_template = trim(p_message_template) WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(v_row.campanha_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb) TO anon, authenticated;

-- admin_fire_campanha_event: cada cupom da campanha (principal e
-- extras) só recebe concessão se a JANELA DELE (starts_at/expires_at
-- próprios, não só os da campanha) já estiver valendo agora.
CREATE OR REPLACE FUNCTION ufersin.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row       ufersin.crm_segment_coupons%ROWTYPE;
  v_coupon    ufersin.coupons%ROWTYPE;
  v_whatsapp  text;
  v_newly     text[] := '{}';
  v_in_window boolean;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas can be re-fired';
  END IF;
  IF v_row.active = 0 THEN
    RAISE EXCEPTION 'this campanha is paused';
  END IF;

  v_in_window := (v_row.starts_at IS NULL OR v_row.starts_at::timestamptz <= now())
    AND (v_row.ends_at IS NULL OR v_row.ends_at::timestamptz >= now());
  IF NOT v_in_window THEN
    RETURN jsonb_build_object('newly_granted', '[]'::jsonb);
  END IF;

  FOR v_coupon IN
    SELECT c.* FROM ufersin.coupons c WHERE c.id = v_row.coupon_id
    UNION ALL
    SELECT c.* FROM ufersin.coupons c JOIN ufersin.crm_campanha_extra_coupons ec ON ec.coupon_id = c.id WHERE ec.campanha_id = p_id
  LOOP
    IF v_coupon.active = 0
       OR (v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at::timestamptz > now())
       OR (v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now()) THEN
      CONTINUE;
    END IF;
    FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
      IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id AND customer_whatsapp = v_whatsapp) THEN
        INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          VALUES (gen_random_uuid()::text, v_coupon.id, v_whatsapp, v_row.uses_per_customer, 0);
        IF v_coupon.id = v_row.coupon_id THEN
          v_newly := array_append(v_newly, v_whatsapp);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  IF array_length(v_newly, 1) > 0 THEN
    UPDATE ufersin.crm_segment_coupons SET last_fired_at = now()::text WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_newly));
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_fire_campanha_event(text, text, text[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_cupom_e_gatilho_descricao.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Campo de descrição livre (texto interno, só pro admin, não vai pro
-- cliente): um pro gatilho do evento (crm_segment_coupons), e um pra
-- qualquer cupom (ufersin.coupons — cobre avulso, principal e extra, já
-- que todos moram na mesma tabela).
--
-- Execução: depois de sunset_crm_campanhas_encerrar_evento_e_agenda.sql.
-- =====================================================

ALTER TABLE ufersin.coupons ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE ufersin.crm_segment_coupons ADD COLUMN IF NOT EXISTS trigger_description TEXT;

CREATE OR REPLACE FUNCTION ufersin._coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'code', c.code, 'kind', c.kind, 'description', c.description,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_promotion_checkout', (c.allow_promotion_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'active', (c.active <> 0),
    'starts_at', c.starts_at, 'expires_at', c.expires_at, 'max_uses', c.max_uses, 'used_count', c.used_count, 'created_at', c.created_at,
    'message_template', c.message_template,
    'bday_customer_days_before', c.bday_customer_days_before,
    'bday_store_date', c.bday_store_date, 'bday_store_days_before', c.bday_store_days_before,
    'grant_count', (SELECT COUNT(*) FROM ufersin.coupon_grants g WHERE g.coupon_id = c.id),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  ) FROM ufersin.coupons c WHERE c.id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'name', name, 'description', description, 'starts_at', starts_at, 'ends_at', ends_at,
    'trigger_criteria', trigger_criteria, 'trigger_description', trigger_description,
    'end_criteria', end_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'last_synced_segment_criteria', last_synced_segment_criteria,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'coupon', ufersin._coupon_json(ec.coupon_id), 'message_template', ec.message_template, 'end_criteria', ec.end_criteria
      ) ORDER BY ec.created_at)
      FROM ufersin.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM ufersin.crm_segment_coupons WHERE id = p_id;
$$;

-- admin_set_campanha_gatilho ganha p_trigger_description (descrição
-- livre do gatilho, independente do critério em si).
CREATE OR REPLACE FUNCTION ufersin.admin_set_campanha_gatilho(
  p_token text, p_id text, p_trigger_criteria jsonb, p_trigger_description text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row     ufersin.crm_segment_coupons%ROWTYPE;
  v_segment ufersin.crm_segments%ROWTYPE;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas have a gatilho';
  END IF;

  IF p_trigger_criteria IS NULL THEN
    UPDATE ufersin.crm_segment_coupons SET
      trigger_criteria = NULL, last_synced_segment_criteria = NULL, trigger_description = NULLIF(trim(p_trigger_description), '')
    WHERE id = p_id;
    RETURN ufersin._campanha_coupon_json(p_id);
  END IF;

  SELECT * INTO v_segment FROM ufersin.crm_segments WHERE id = v_row.segment_id;
  IF p_trigger_criteria = v_segment.filter_criteria THEN
    RAISE EXCEPTION 'trigger_criteria must differ from the segment''s current filter in at least one field';
  END IF;

  UPDATE ufersin.crm_segment_coupons SET
    trigger_criteria = p_trigger_criteria,
    last_synced_segment_criteria = v_segment.filter_criteria,
    trigger_description = NULLIF(trim(p_trigger_description), '')
  WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_set_campanha_gatilho(text, text, jsonb, text) TO anon, authenticated;

-- admin_create_coupon (avulso) ganha p_description.
CREATE OR REPLACE FUNCTION ufersin.admin_create_coupon(
  p_token text,
  p_code text,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_combinable_with_public boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_message_template text DEFAULT NULL,
  p_bday_customer_days_before bigint DEFAULT NULL,
  p_bday_store_date text DEFAULT NULL,
  p_bday_store_days_before bigint DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_code text := upper(trim(p_code));
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_has_bday boolean := p_bday_customer_days_before IS NOT NULL OR p_bday_store_date IS NOT NULL;
  v_kind text := CASE WHEN v_has_products THEN 'produto' ELSE 'desconto' END;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid discount_type';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  IF v_has_bday AND (trim(COALESCE(p_message_template, '')) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%') THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_bday_customer_days_before IS NOT NULL AND p_bday_customer_days_before < 0 THEN
    RAISE EXCEPTION 'bday_customer_days_before must be zero or positive';
  END IF;
  IF p_bday_store_date IS NOT NULL AND p_bday_store_days_before IS NULL THEN
    RAISE EXCEPTION 'bday_store_days_before is required when bday_store_date is set';
  END IF;

  BEGIN
    INSERT INTO ufersin.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      allow_promotion_checkout, combinable_with_public, starts_at, expires_at, max_uses,
      message_template, bday_customer_days_before, bday_store_date, bday_store_days_before, description
    ) VALUES (
      v_id, v_code, v_kind,
      CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      p_shipping_discount_type, p_shipping_discount_value,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), ''), p_max_uses,
      NULLIF(trim(p_message_template), ''), p_bday_customer_days_before,
      NULLIF(trim(p_bday_store_date), ''), p_bday_store_days_before, NULLIF(trim(p_description), '')
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (
          gen_random_uuid()::text, v_id, v_pd->>'product_id',
          v_pd->>'discount_type', (v_pd->>'discount_value')::double precision
        );
    END LOOP;
  END IF;

  RETURN ufersin._coupon_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_coupon(text, text, text, double precision, text, double precision, boolean, boolean, text, text, bigint, jsonb, text, bigint, text, bigint, text) TO anon, authenticated;

-- admin_update_coupon (avulso) ganha p_description.
CREATE OR REPLACE FUNCTION ufersin.admin_update_coupon(
  p_token text,
  p_id text,
  p_active boolean,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_combinable_with_public boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_message_template text DEFAULT NULL,
  p_bday_customer_days_before bigint DEFAULT NULL,
  p_bday_store_date text DEFAULT NULL,
  p_bday_store_days_before bigint DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_has_products boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_has_bday boolean := p_bday_customer_days_before IS NOT NULL OR p_bday_store_date IS NOT NULL;
  v_kind text := CASE WHEN v_has_products THEN 'produto' ELSE 'desconto' END;
  v_pd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM ufersin.coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'coupon not found';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  IF v_has_bday AND (trim(COALESCE(p_message_template, '')) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%') THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_bday_store_date IS NOT NULL AND p_bday_store_days_before IS NULL THEN
    RAISE EXCEPTION 'bday_store_days_before is required when bday_store_date is set';
  END IF;

  UPDATE ufersin.coupons SET
    kind = v_kind,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
    shipping_discount_type = p_shipping_discount_type,
    shipping_discount_value = p_shipping_discount_value,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''),
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    message_template = NULLIF(trim(p_message_template), ''),
    bday_customer_days_before = p_bday_customer_days_before,
    bday_store_date = NULLIF(trim(p_bday_store_date), ''),
    bday_store_days_before = p_bday_store_days_before,
    description = NULLIF(trim(p_description), '')
  WHERE id = p_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = p_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  RETURN ufersin._coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_coupon(text, text, boolean, text, double precision, text, double precision, boolean, boolean, text, text, bigint, jsonb, text, bigint, text, bigint, text) TO anon, authenticated;

-- admin_update_campanha_coupon (cupom principal) ganha p_description.
CREATE OR REPLACE FUNCTION ufersin.admin_update_campanha_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row           ufersin.crm_segment_coupons%ROWTYPE;
  v_kind          text;
  v_pd            jsonb;
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE ufersin.coupons SET
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''),
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    description = NULLIF(trim(p_description), '')
  WHERE id = v_row.coupon_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE ufersin.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  UPDATE ufersin.crm_segment_coupons SET
    message_template = trim(p_message_template),
    uses_per_customer = p_uses_per_customer
  WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campanha_coupon(text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb, text) TO anon, authenticated;

-- admin_create_campanha_extra_coupon ganha p_description.
CREATE OR REPLACE FUNCTION ufersin.admin_create_campanha_extra_coupon(
  p_token text,
  p_campanha_id text,
  p_code text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_customer_whatsapps text[] DEFAULT '{}',
  p_description text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_campanha      ufersin.crm_segment_coupons%ROWTYPE;
  v_coupon_id     text := gen_random_uuid()::text;
  v_row_id        text := gen_random_uuid()::text;
  v_code          text := upper(trim(p_code));
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
  v_kind          text;
  v_pd            jsonb;
  v_grant         ufersin.coupon_grants%ROWTYPE;
  v_is_primary    boolean;
  v_in_window     boolean;
  v_whatsapp      text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_campanha FROM ufersin.crm_segment_coupons WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  v_is_primary := v_campanha.coupon_id IS NULL;
  IF v_code = '' THEN
    RAISE EXCEPTION 'code is required';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF v_has_products AND p_discount_type IS NOT NULL THEN
    RAISE EXCEPTION 'use either a flat product discount or per-product discounts, not both';
  END IF;
  IF NOT v_has_products AND p_discount_type IS NULL AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a campanha coupon needs at least one discount (produto, desconto and/or frete)';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  BEGIN
    INSERT INTO ufersin.coupons (
      id, code, kind, discount_type, discount_value, shipping_discount_type, shipping_discount_value,
      combinable_with_public, allow_promotion_checkout, starts_at, expires_at, max_uses, description
    ) VALUES (
      v_coupon_id, v_code, v_kind,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_type WHEN v_kind = 'produto' THEN NULL ELSE p_discount_type END,
      CASE WHEN v_kind = 'frete' THEN p_shipping_discount_value WHEN v_kind = 'produto' THEN NULL ELSE p_discount_value END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
      CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
      CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
      CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
      NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), ''), p_max_uses, NULLIF(trim(p_description), '')
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a coupon with this code already exists';
  END;

  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  IF v_campanha.active = 0 THEN
    UPDATE ufersin.coupons SET active = 0 WHERE id = v_coupon_id;
  END IF;

  v_in_window := (v_campanha.starts_at IS NULL OR v_campanha.starts_at::timestamptz <= now())
    AND (v_campanha.ends_at IS NULL OR v_campanha.ends_at::timestamptz >= now())
    AND (p_starts_at IS NULL OR trim(p_starts_at) = '' OR p_starts_at::timestamptz <= now());

  IF v_is_primary THEN
    UPDATE ufersin.crm_segment_coupons SET
      coupon_id = v_coupon_id,
      message_template = trim(p_message_template),
      uses_per_customer = p_uses_per_customer,
      last_fired_at = CASE WHEN orientation = 'segmento' AND v_in_window THEN now()::text ELSE last_fired_at END
    WHERE id = p_campanha_id;

    IF v_campanha.orientation = 'segmento' AND v_in_window THEN
      FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
        IF v_whatsapp IS NOT NULL AND trim(v_whatsapp) <> '' THEN
          INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
            SELECT gen_random_uuid()::text, v_coupon_id, v_whatsapp, p_uses_per_customer, 0
            WHERE NOT EXISTS (
              SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon_id AND customer_whatsapp = v_whatsapp
            );
        END IF;
      END LOOP;
    END IF;
  ELSE
    INSERT INTO ufersin.crm_campanha_extra_coupons (id, campanha_id, coupon_id, message_template)
      VALUES (v_row_id, p_campanha_id, v_coupon_id, trim(p_message_template));

    IF v_in_window THEN
      FOR v_grant IN SELECT * FROM ufersin.coupon_grants WHERE coupon_id = v_campanha.coupon_id LOOP
        INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
          VALUES (gen_random_uuid()::text, v_coupon_id, v_grant.customer_whatsapp, p_uses_per_customer, 0);
      END LOOP;
    END IF;
  END IF;

  RETURN ufersin._coupon_json(v_coupon_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_campanha_extra_coupon(text, text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb, text[], text) TO anon, authenticated;

-- admin_update_campanha_extra_coupon ganha p_description.
CREATE OR REPLACE FUNCTION ufersin.admin_update_campanha_extra_coupon(
  p_token text,
  p_id text,
  p_message_template text,
  p_uses_per_customer bigint DEFAULT 1,
  p_combinable_with_public boolean DEFAULT false,
  p_allow_promotion_checkout boolean DEFAULT false,
  p_starts_at text DEFAULT NULL,
  p_expires_at text DEFAULT NULL,
  p_max_uses bigint DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL,
  p_shipping_discount_value double precision DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row           ufersin.crm_campanha_extra_coupons%ROWTYPE;
  v_kind          text;
  v_pd            jsonb;
  v_has_products  boolean := p_product_discounts IS NOT NULL AND jsonb_array_length(p_product_discounts) > 0;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_campanha_extra_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'extra coupon not found';
  END IF;
  IF trim(p_message_template) = '' OR p_message_template NOT LIKE '%/nome%' OR p_message_template NOT LIKE '%/cupom%' THEN
    RAISE EXCEPTION 'message_template must mention /nome and /cupom';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION 'max_uses must be positive';
  END IF;
  v_kind := CASE WHEN v_has_products THEN 'produto' WHEN p_discount_type IS NOT NULL THEN 'desconto' ELSE 'frete' END;

  UPDATE ufersin.coupons SET
    kind = v_kind,
    discount_type = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_type ELSE p_discount_type END,
    discount_value = CASE WHEN v_kind = 'produto' THEN NULL WHEN v_kind = 'frete' THEN p_shipping_discount_value ELSE p_discount_value END,
    shipping_discount_type = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_type END,
    shipping_discount_value = CASE WHEN v_kind = 'frete' THEN NULL ELSE p_shipping_discount_value END,
    combinable_with_public = CASE WHEN p_combinable_with_public THEN 1 ELSE 0 END,
    allow_promotion_checkout = CASE WHEN p_allow_promotion_checkout THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''),
    expires_at = NULLIF(trim(p_expires_at), ''),
    max_uses = p_max_uses,
    description = NULLIF(trim(p_description), '')
  WHERE id = v_row.coupon_id;

  DELETE FROM ufersin.coupon_product_discounts WHERE coupon_id = v_row.coupon_id;
  IF v_has_products THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.coupon_product_discounts (id, coupon_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;
  END IF;

  UPDATE ufersin.coupon_grants SET granted_uses = p_uses_per_customer WHERE coupon_id = v_row.coupon_id;

  UPDATE ufersin.crm_campanha_extra_coupons SET message_template = trim(p_message_template) WHERE id = p_id;

  RETURN ufersin._campanha_coupon_json(v_row.campanha_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_campanha_extra_coupon(text, text, text, bigint, boolean, boolean, text, text, bigint, text, double precision, text, double precision, jsonb, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_horario_loja.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Horário de funcionamento da loja + fechamento manual (com justificativa
-- obrigatória quando o admin fecha durante um horário que deveria estar
-- aberto). A landing page usa isso pra decidir se mostra o site "aberto"
-- (normal) ou "fechado" (grayscale + mensagem de justificativa).
--
-- Cada dia pode ter MÚLTIPLOS intervalos (ex: 10:00-14:00 e 18:00-22:00,
-- pra almoço/pausa) — guardado como array jsonb de {opens_at, closes_at}
-- em vez de um único par de colunas.
-- =====================================================

CREATE TABLE IF NOT EXISTS ufersin.store_hours (
  day_of_week smallint PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6), -- 0=domingo .. 6=sábado
  is_open boolean NOT NULL DEFAULT true,
  intervals jsonb NOT NULL DEFAULT '[]'::jsonb -- [{"opens_at":"10:00","closes_at":"14:00"}, ...]
);

-- Idempotente pra quem já rodou a versão anterior (opens_at/closes_at
-- únicos) desta migration antes desta reescrita.
ALTER TABLE ufersin.store_hours ADD COLUMN IF NOT EXISTS intervals jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'ufersin' AND table_name = 'store_hours' AND column_name = 'opens_at') THEN
    UPDATE ufersin.store_hours SET intervals = jsonb_build_array(jsonb_build_object('opens_at', opens_at, 'closes_at', closes_at))
      WHERE opens_at IS NOT NULL AND closes_at IS NOT NULL AND intervals = '[]'::jsonb;
    ALTER TABLE ufersin.store_hours DROP COLUMN opens_at;
    ALTER TABLE ufersin.store_hours DROP COLUMN closes_at;
  END IF;
END $$;

INSERT INTO ufersin.store_hours (day_of_week, is_open, intervals)
  SELECT d, true, jsonb_build_array(jsonb_build_object('opens_at', '09:00', 'closes_at', '18:00'))
  FROM generate_series(0, 6) AS d
  ON CONFLICT (day_of_week) DO NOTHING;

CREATE TABLE IF NOT EXISTS ufersin.store_status (
  id int PRIMARY KEY DEFAULT 1,
  manually_closed boolean NOT NULL DEFAULT false,
  manual_closed_reason text,
  CHECK (id = 1)
);

INSERT INTO ufersin.store_status (id, manually_closed) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

ALTER TABLE ufersin.store_hours ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON ufersin.store_hours TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_store_hours" ON ufersin.store_hours;
CREATE POLICY "sunset_anon_select_store_hours" ON ufersin.store_hours
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE ufersin.store_status ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON ufersin.store_status TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_store_status" ON ufersin.store_status;
CREATE POLICY "sunset_anon_select_store_status" ON ufersin.store_status
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION ufersin.admin_set_store_hours(p_token text, p_hours jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_h jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  FOR v_h IN SELECT * FROM jsonb_array_elements(p_hours) LOOP
    UPDATE ufersin.store_hours SET
      is_open = COALESCE((v_h->>'is_open')::boolean, false),
      intervals = COALESCE(v_h->'intervals', '[]'::jsonb)
    WHERE day_of_week = (v_h->>'day_of_week')::smallint;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_set_store_hours(text, jsonb) TO anon, authenticated;

-- Fechamento manual: se o admin está fechando a loja justamente num
-- horário em que ela deveria estar aberta (segundo o horário semanal —
-- qualquer um dos intervalos do dia cobrindo o horário atual), exige
-- justificativa — senão pode fechar/abrir livremente.
CREATE OR REPLACE FUNCTION ufersin.admin_set_store_manual_status(p_token text, p_manually_closed boolean, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_now            timestamp := now() at time zone 'America/Recife';
  v_dow            smallint := extract(dow from v_now)::smallint;
  v_hour_row       ufersin.store_hours%ROWTYPE;
  v_now_time       time := v_now::time;
  v_interval       jsonb;
  v_should_be_open boolean := false;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_manually_closed THEN
    SELECT * INTO v_hour_row FROM ufersin.store_hours WHERE day_of_week = v_dow;
    IF FOUND AND v_hour_row.is_open THEN
      FOR v_interval IN SELECT * FROM jsonb_array_elements(v_hour_row.intervals) LOOP
        IF v_now_time >= (v_interval->>'opens_at')::time AND v_now_time < (v_interval->>'closes_at')::time THEN
          v_should_be_open := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;
    IF v_should_be_open AND trim(COALESCE(p_reason, '')) = '' THEN
      RAISE EXCEPTION 'a justification is required to close the store during scheduled open hours';
    END IF;
  END IF;

  UPDATE ufersin.store_status SET
    manually_closed = p_manually_closed,
    manual_closed_reason = CASE WHEN p_manually_closed THEN NULLIF(trim(p_reason), '') ELSE NULL END
  WHERE id = 1;

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_set_store_manual_status(text, boolean, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_gatilho_encerramento_descricao.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Campo de descrição livre (texto interno, só pro admin) pro gatilho de
-- encerramento da campanha — mesma ideia do trigger_description que o
-- gatilho de disparo já tem.
--
-- Execução: depois de sunset_cupom_e_gatilho_descricao.sql.
-- =====================================================

ALTER TABLE ufersin.crm_segment_coupons ADD COLUMN IF NOT EXISTS end_description TEXT;

CREATE OR REPLACE FUNCTION ufersin._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'name', name, 'description', description, 'starts_at', starts_at, 'ends_at', ends_at,
    'trigger_criteria', trigger_criteria, 'trigger_description', trigger_description,
    'end_criteria', end_criteria, 'end_description', end_description, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'last_synced_segment_criteria', last_synced_segment_criteria,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'coupon', ufersin._coupon_json(ec.coupon_id), 'message_template', ec.message_template, 'end_criteria', ec.end_criteria
      ) ORDER BY ec.created_at)
      FROM ufersin.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM ufersin.crm_segment_coupons WHERE id = p_id;
$$;

-- admin_set_campanha_end_criteria ganha p_end_description (aditivo, sem
-- precisar de DROP já que o parâmetro novo é opcional e vai no final).
CREATE OR REPLACE FUNCTION ufersin.admin_set_campanha_end_criteria(p_token text, p_id text, p_end_criteria jsonb, p_end_description text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM ufersin.crm_segment_coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  UPDATE ufersin.crm_segment_coupons SET
    end_criteria = p_end_criteria,
    end_description = NULLIF(trim(p_end_description), '')
  WHERE id = p_id;
  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_set_campanha_end_criteria(text, text, jsonb, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_admin_ping.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- RPC mínima só pra validar um token de admin (usada pela Vercel Edge
-- Function de upload de imagem, que precisa confirmar "é admin de verdade"
-- antes de gravar no Storage com a service_role key, sem duplicar a lógica
-- de sessão em outro lugar).
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.admin_ping(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_ping(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_pix_supabase.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Migra o Pix (AbacatePay) do backend Rust/Railway pra rodar via Vercel
-- Edge Functions + Supabase direto (Railway fica só com Evolution API +
-- Rust, nada de pagamento). Duas RPCs públicas idempotentes (chamadas
-- pelas Edge Functions, que detêm a chave da AbacatePay) + um cron de
-- backstop (confirma o pagamento mesmo se o cliente fechar a aba antes de
-- o polling do navegador pegar) + um trigger que dispara a notificação de
-- WhatsApp NA HORA que o pagamento confirma, via pg_net (fila
-- instantânea, sem esperar ciclo nenhum, sem Redis, sem Railway extra).
--
-- Execução: depois de sunset_admin_ping.sql. Habilita pg_cron e pg_net
-- (extensões padrão do Supabase, disponíveis em todos os planos).
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────
-- 1. RPCs públicas de escrita — mesma superfície de dados que o Rust já
--    escrevia via sqlx, só que chamadas pelas Edge Functions em vez do
--    backend. Idempotentes: seguro chamar mais de uma vez (ex: cron +
--    polling do navegador tentando o mesmo pedido ao mesmo tempo).
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.set_pix_charge(
  p_order_id text, p_payment_id text, p_qr_base64 text, p_copia_cola text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public AS $$
BEGIN
  UPDATE ufersin.orders SET
    pix_payment_id = p_payment_id,
    pix_qr_base64 = p_qr_base64,
    pix_copia_cola = p_copia_cola,
    updated_at = now()::text
  WHERE id = p_order_id AND pix_payment_id IS NULL;
  RETURN ufersin.get_order(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.set_pix_charge(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.confirm_pix_payment(p_order_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public AS $$
BEGIN
  UPDATE ufersin.orders SET payment_status = 'pago', updated_at = now()::text
    WHERE id = p_order_id AND payment_method = 'pix' AND payment_status <> 'pago';
  RETURN ufersin.get_order(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.confirm_pix_payment(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 2. Trigger: no exato momento que payment_status vira 'pago' (por
--    qualquer caminho — polling do cliente OU o cron de backstop
--    abaixo), dispara uma chamada assíncrona (pg_net não bloqueia, só
--    enfileira) pra Edge Function que aciona o WhatsApp via Rust/Railway.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._notify_pix_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, net AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://ufersin-tabas.vercel.app/api/notify-payment',
    body := jsonb_build_object('order_id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sunset_pix_paid_notify ON ufersin.orders;
CREATE TRIGGER sunset_pix_paid_notify
  AFTER UPDATE ON ufersin.orders
  FOR EACH ROW
  WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NEW.payment_status = 'pago' AND NEW.payment_method = 'pix')
  EXECUTE FUNCTION ufersin._notify_pix_paid();

-- ─────────────────────────────────────────────────────
-- 3. pg_cron backstop: confere Pix pendente a cada 1 min, independente
--    do cliente ter fechado a aba — chama a MESMA Edge Function que o
--    polling do navegador chama. Só olha pedidos dos últimos 2 dias pra
--    não ficar varrendo histórico velho pra sempre.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin._cron_check_pending_pix()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, net AS $$
DECLARE
  v_order ufersin.orders%ROWTYPE;
BEGIN
  FOR v_order IN
    SELECT * FROM ufersin.orders
    WHERE payment_method = 'pix' AND payment_status <> 'pago' AND pix_payment_id IS NOT NULL
      AND created_at::timestamptz > now() - interval '2 days'
  LOOP
    PERFORM net.http_post(
      url := 'https://ufersin-tabas.vercel.app/api/pix-check',
      body := jsonb_build_object('order_id', v_order.id),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sunset_pix_backstop') THEN
    PERFORM cron.unschedule('sunset_pix_backstop');
  END IF;
END $$;

SELECT cron.schedule('sunset_pix_backstop', '* * * * *', $$SELECT ufersin._cron_check_pending_pix();$$);

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_promocao_catalogo_publico.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Itens de promoção "selfie service" (banner) passam a aparecer na
-- categoria pública "Promoção" do /catalogo também — independente de o
-- cliente ter clicado no banner ou não. Antes só cupom avulso kind='produto'
-- caía nessa categoria; agora list_promotional_products() une as duas
-- fontes (cupom avulso + promoção selfie_service ativa).
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.list_promotional_products()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'product_id', pd.product_id, 'coupon_code', c.code,
      'discount_type', pd.discount_type, 'discount_value', pd.discount_value
    ) AS row
    FROM ufersin.coupon_product_discounts pd
    JOIN ufersin.coupons c ON c.id = pd.coupon_id
    WHERE c.active <> 0
      AND (c.expires_at IS NULL OR c.expires_at::timestamptz > now())
      AND (c.max_uses IS NULL OR c.used_count < c.max_uses)
      AND NOT EXISTS (SELECT 1 FROM ufersin.coupon_grants g WHERE g.coupon_id = c.id)

    UNION ALL

    SELECT jsonb_build_object(
      'product_id', pd.product_id, 'coupon_code', '',
      'discount_type', pd.discount_type, 'discount_value', pd.discount_value
    ) AS row
    FROM ufersin.promotion_product_discounts pd
    JOIN ufersin.promotions p ON p.id = pd.promotion_id
    WHERE p.promotion_type = 'selfie_service'
      AND p.active <> 0
      AND (p.starts_at IS NULL OR p.starts_at::timestamptz <= now())
      AND (p.expires_at IS NULL OR p.expires_at::timestamptz > now())
  ) t;
$$;
GRANT EXECUTE ON FUNCTION ufersin.list_promotional_products() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_promocao_categoria_dinamica.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- "Categoria inteira" numa promoção selfie_service deixa de ser um
-- snapshot fixo dos produtos daquela categoria NO MOMENTO em que foi
-- adicionada — vira uma regra de verdade (promotion_category_discounts).
-- Um produto criado (ou recategorizado) DEPOIS que a promoção já existe
-- entra em promoção automaticamente, via trigger em ufersin.products —
-- sem precisar reabrir/salvar a promoção de novo. promotions.product_ids
-- passa a ser sempre recalculado a partir de promotion_product_discounts
-- (nunca editado à mão), então checkout (create_order, que valida contra
-- product_ids) e catálogo público continuam funcionando sem precisar
-- mexer naquela função.
--
-- Execução: depois de sunset_promocao_catalogo_publico.sql.
-- =====================================================

CREATE TABLE IF NOT EXISTS ufersin.promotion_category_discounts (
  id text PRIMARY KEY,
  promotion_id text NOT NULL REFERENCES ufersin.promotions(id) ON DELETE CASCADE,
  category_id text NOT NULL,
  discount_type text NOT NULL,
  discount_value double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS promotion_category_discounts_promotion_idx ON ufersin.promotion_category_discounts (promotion_id);
CREATE INDEX IF NOT EXISTS promotion_category_discounts_category_idx ON ufersin.promotion_category_discounts (category_id);
ALTER TABLE ufersin.promotion_category_discounts ENABLE ROW LEVEL SECURITY;

-- _promotion_json ganha category_discounts, pra tela de editar promoção
-- reconstruir quais produtos vieram de "categoria inteira" (e com qual
-- desconto), em vez de re-tagueação manual no client.
CREATE OR REPLACE FUNCTION ufersin._promotion_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'title', c.title, 'image_url', c.image_url, 'product_ids', to_jsonb(c.product_ids),
    'promotion_type', c.promotion_type,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'active', (c.active <> 0), 'starts_at', c.starts_at, 'expires_at', c.expires_at, 'created_at', c.created_at,
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.promotion_product_discounts pd WHERE pd.promotion_id = c.id
    ), '[]'::jsonb),
    'category_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category_id', cd.category_id, 'discount_type', cd.discount_type, 'discount_value', cd.discount_value
      )) FROM ufersin.promotion_category_discounts cd WHERE cd.promotion_id = c.id
    ), '[]'::jsonb)
  ) FROM ufersin.promotions c WHERE c.id = p_id;
$$;

-- Garante que todo produto ATUAL de uma categoria com desconto-de-categoria
-- numa promoção selfie_service tenha uma linha em promotion_product_discounts
-- (sem sobrescrever um desconto individual já definido pra esse produto) e
-- recalcula product_ids a partir disso. Chamada tanto ao salvar a promoção
-- quanto pelo trigger abaixo, toda vez que um produto entra/muda pra essa
-- categoria — funciona independente de o produto ter sido cadastrado antes
-- ou depois da promoção.
CREATE OR REPLACE FUNCTION ufersin._sync_promotion_category_products(p_category_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public AS $$
DECLARE
  v_rule    ufersin.promotion_category_discounts%ROWTYPE;
  v_product ufersin.products%ROWTYPE;
BEGIN
  FOR v_rule IN
    SELECT pcd.* FROM ufersin.promotion_category_discounts pcd
    JOIN ufersin.promotions p ON p.id = pcd.promotion_id
    WHERE pcd.category_id = p_category_id AND p.promotion_type = 'selfie_service'
  LOOP
    FOR v_product IN SELECT * FROM ufersin.products WHERE category_id = p_category_id AND active <> 0 LOOP
      INSERT INTO ufersin.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        SELECT gen_random_uuid()::text, v_rule.promotion_id, v_product.id, v_rule.discount_type, v_rule.discount_value
        WHERE NOT EXISTS (
          SELECT 1 FROM ufersin.promotion_product_discounts
          WHERE promotion_id = v_rule.promotion_id AND product_id = v_product.id
        );
    END LOOP;

    UPDATE ufersin.promotions SET product_ids = (
      SELECT COALESCE(array_agg(DISTINCT product_id), ARRAY[]::text[])
      FROM ufersin.promotion_product_discounts WHERE promotion_id = v_rule.promotion_id
    ) WHERE id = v_rule.promotion_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION ufersin._products_category_promo_sync_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public AS $$
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    PERFORM ufersin._sync_promotion_category_products(NEW.category_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sunset_product_category_promo_sync ON ufersin.products;
CREATE TRIGGER sunset_product_category_promo_sync
  AFTER INSERT OR UPDATE OF category_id ON ufersin.products
  FOR EACH ROW
  EXECUTE FUNCTION ufersin._products_category_promo_sync_trigger();

-- admin_create_promotion / admin_update_promotion ganham p_category_discounts.
CREATE OR REPLACE FUNCTION ufersin.admin_create_promotion(
  p_token text, p_title text, p_image_url text, p_product_ids text[],
  p_promotion_type text DEFAULT 'kit',
  p_discount_type text DEFAULT NULL, p_discount_value double precision DEFAULT NULL,
  p_shipping_discount_type text DEFAULT NULL, p_shipping_discount_value double precision DEFAULT NULL,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_category_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_pd jsonb;
  v_cd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required to create a promotion';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF p_promotion_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid promotion_type';
  END IF;
  IF p_promotion_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service promotion';
    END IF;
  ELSE
    IF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
      RAISE EXCEPTION 'a kit promotion needs a product discount and/or a shipping discount';
    END IF;
    IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;

  INSERT INTO ufersin.promotions (
    id, title, image_url, product_ids, promotion_type, discount_type, discount_value,
    shipping_discount_type, shipping_discount_value, starts_at, expires_at
  ) VALUES (
    v_id, trim(p_title), p_image_url, p_product_ids, p_promotion_type,
    CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    p_shipping_discount_type, p_shipping_discount_value,
    NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), '')
  );

  IF p_promotion_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;

    IF p_category_discounts IS NOT NULL THEN
      FOR v_cd IN SELECT * FROM jsonb_array_elements(p_category_discounts) LOOP
        INSERT INTO ufersin.promotion_category_discounts (id, promotion_id, category_id, discount_type, discount_value)
          VALUES (gen_random_uuid()::text, v_id, v_cd->>'category_id', v_cd->>'discount_type', (v_cd->>'discount_value')::double precision);
        PERFORM ufersin._sync_promotion_category_products(v_cd->>'category_id');
      END LOOP;
    END IF;

    UPDATE ufersin.promotions SET product_ids = (
      SELECT COALESCE(array_agg(DISTINCT product_id), ARRAY[]::text[])
      FROM ufersin.promotion_product_discounts WHERE promotion_id = v_id
    ) WHERE id = v_id;
  END IF;

  RETURN ufersin._promotion_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_promotion(text, text, text, text[], text, text, double precision, text, double precision, text, text, jsonb, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_promotion(
  p_token text, p_id text, p_title text, p_image_url text, p_product_ids text[],
  p_promotion_type text,
  p_discount_type text, p_discount_value double precision,
  p_shipping_discount_type text, p_shipping_discount_value double precision,
  p_active boolean,
  p_starts_at text DEFAULT NULL, p_expires_at text DEFAULT NULL,
  p_product_discounts jsonb DEFAULT NULL,
  p_category_discounts jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_pd jsonb;
  v_cd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF p_promotion_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid promotion_type';
  END IF;
  IF p_promotion_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service promotion';
    END IF;
  ELSIF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a kit promotion needs a product discount and/or a shipping discount';
  END IF;

  UPDATE ufersin.promotions SET
    title = trim(p_title), image_url = p_image_url, product_ids = p_product_ids,
    promotion_type = p_promotion_type,
    discount_type = CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    discount_value = CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    shipping_discount_type = p_shipping_discount_type, shipping_discount_value = p_shipping_discount_value,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''), expires_at = NULLIF(trim(p_expires_at), '')
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion not found';
  END IF;

  DELETE FROM ufersin.promotion_product_discounts WHERE promotion_id = p_id;
  DELETE FROM ufersin.promotion_category_discounts WHERE promotion_id = p_id;

  IF p_promotion_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;

    IF p_category_discounts IS NOT NULL THEN
      FOR v_cd IN SELECT * FROM jsonb_array_elements(p_category_discounts) LOOP
        INSERT INTO ufersin.promotion_category_discounts (id, promotion_id, category_id, discount_type, discount_value)
          VALUES (gen_random_uuid()::text, p_id, v_cd->>'category_id', v_cd->>'discount_type', (v_cd->>'discount_value')::double precision);
        PERFORM ufersin._sync_promotion_category_products(v_cd->>'category_id');
      END LOOP;
    END IF;

    UPDATE ufersin.promotions SET product_ids = (
      SELECT COALESCE(array_agg(DISTINCT product_id), ARRAY[]::text[])
      FROM ufersin.promotion_product_discounts WHERE promotion_id = p_id
    ) WHERE id = p_id;
  END IF;

  RETURN ufersin._promotion_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_promotion(text, text, text, text, text[], text, text, double precision, text, double precision, boolean, text, text, jsonb, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_funcionario_senha_visivel.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Gestão de funcionários exclusiva do admin:
-- 1) Admin consegue VISUALIZAR a senha atual de um motoboy/vendedor (não só
--    resetar) — o hash bcrypt (password_hash, usado pra login de verdade)
--    é irreversível de propósito, então guardamos também password_plain
--    (texto puro) só pra esse fim. Só uma RPC admin-gated expõe isso, sob
--    demanda (por funcionário, não embutido na listagem).
-- 2) Funcionário nunca troca a própria senha sozinho — só o admin, no
--    dashboard /admin/motoboys (funcionários). Isso já era verdade (motoboy
--    e vendedor nunca tiveram uma tela de "trocar senha" própria), esse
--    arquivo só formaliza o dado que faltava pro admin poder LER a senha.
--
-- Execução: depois de sunset_motoboy_payout.sql e sunset_comissao_origem_pedido.sql.
-- =====================================================

ALTER TABLE ufersin.motoboys ADD COLUMN IF NOT EXISTS password_plain text;
ALTER TABLE ufersin.vendedores ADD COLUMN IF NOT EXISTS password_plain text;

-- ─────────────────────────────────────────────────────
-- Motoboy: create/update passam a gravar password_plain junto com o hash.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_create_motoboy(
  p_token text, p_name text, p_phone text, p_email text, p_password text,
  p_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_password IS NULL OR trim(p_password) = '' THEN
    RAISE EXCEPTION 'password is required to create a motoboy';
  END IF;
  BEGIN
    INSERT INTO ufersin.motoboys (id, name, phone, email, password_hash, password_plain, whatsapp, active)
      VALUES (v_id, p_name, p_phone, p_email, crypt(p_password, gen_salt('bf')), p_password, p_whatsapp, 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN ufersin._motoboy_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_motoboy(text, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_motoboy(
  p_token text, p_id text, p_name text, p_phone text, p_email text,
  p_password text DEFAULT NULL, p_active boolean DEFAULT true,
  p_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE ufersin.motoboys SET
      name = p_name, phone = p_phone, email = p_email,
      password_hash = crypt(p_password, gen_salt('bf')), password_plain = p_password,
      active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp)
    WHERE id = p_id;
  ELSE
    UPDATE ufersin.motoboys SET
      name = p_name, phone = p_phone, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp)
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
  RETURN ufersin._motoboy_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_motoboy(text, text, text, text, text, text, boolean, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_get_motoboy_password(p_token text, p_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_password text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT password_plain INTO v_password FROM ufersin.motoboys WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
  RETURN v_password;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_get_motoboy_password(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Vendedor: mesma coisa.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ufersin.admin_create_vendedor(
  p_token text, p_name text, p_email text, p_password text,
  p_commission_active boolean DEFAULT false, p_commission_percent double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
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
    INSERT INTO ufersin.vendedores (id, name, email, password_hash, password_plain, commission_active, commission_percent)
      VALUES (
        v_id, p_name, p_email, crypt(p_password, gen_salt('bf')), p_password,
        CASE WHEN p_commission_active THEN 1 ELSE 0 END,
        CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
      );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN ufersin._vendedor_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_create_vendedor(text, text, text, text, boolean, double precision) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_vendedor(
  p_token text, p_id text, p_name text, p_email text, p_active boolean DEFAULT true, p_password text DEFAULT NULL,
  p_commission_active boolean DEFAULT false, p_commission_percent double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_commission_active AND (p_commission_percent IS NULL OR p_commission_percent <= 0 OR p_commission_percent > 100) THEN
    RAISE EXCEPTION 'commission_percent must be between 0 and 100';
  END IF;
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE ufersin.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      password_hash = crypt(p_password, gen_salt('bf')), password_plain = p_password,
      commission_active = CASE WHEN p_commission_active THEN 1 ELSE 0 END,
      commission_percent = CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
    WHERE id = p_id;
  ELSE
    UPDATE ufersin.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      commission_active = CASE WHEN p_commission_active THEN 1 ELSE 0 END,
      commission_percent = CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendedor not found';
  END IF;
  RETURN ufersin._vendedor_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_vendedor(text, text, text, text, boolean, text, boolean, double precision) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_get_vendedor_password(p_token text, p_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_password text;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT password_plain INTO v_password FROM ufersin.vendedores WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendedor not found';
  END IF;
  RETURN v_password;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_get_vendedor_password(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_catalogo_ordenacao.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Suporte a ordenação "mais vendido" no /catalogo — os outros critérios
-- (preço, alfabético) já dá pra calcular 100% client-side com os campos
-- que o catálogo já busca; só quantidade vendida precisa de uma consulta
-- nova (soma de order_items de pedidos pagos), então em vez de mexer na
-- query de produtos existente (usada em vários lugares), isso é uma RPC
-- separada e pequena, só {product_id, sold_count}, buscada à parte e
-- cruzada no client — zero risco pro resto do catálogo/checkout.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.product_sales_counts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', product_id, 'sold_count', sold_count)), '[]'::jsonb)
  FROM (
    SELECT oi.product_id, SUM(oi.quantity) AS sold_count
    FROM ufersin.order_items oi
    JOIN ufersin.orders o ON o.id = oi.order_id
    WHERE o.payment_status = 'pago'
    GROUP BY oi.product_id
  ) t;
$$;
GRANT EXECUTE ON FUNCTION ufersin.product_sales_counts() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_promocao_desconto_global_catalogo.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Produto/categoria em promoção selfie_service passa a valer GLOBALMENTE:
-- o desconto por produto (promotion_product_discounts) era aplicado no
-- checkout SÓ quando a compra vinha do banner (create_order recebia
-- p_promotion_id e só aí olhava a tabela) — comprando o MESMO produto pelo
-- /catalogo normal (sem clicar no banner), o preço aparecia riscado/com
-- desconto na vitrine (list_promotional_products já incluía ele), mas o
-- checkout cobrava o valor cheio, porque a tentativa de auto-aplicar via
-- cupom (Checkout.tsx) sempre falhava pra esses itens — list_promotional_products
-- devolve coupon_code = '' pra linhas vindas de promoção (não tem cupom de
-- verdade por trás), e validar um cupom com código vazio nunca bate com
-- nada. Ou seja: o desconto sumia silenciosamente no total, sem erro
-- nenhum aparecer pro cliente.
--
-- A correção agora faz o desconto por produto de promoção selfie_service
-- ser resolvido por PRODUTO, não por p_promotion_id — roda pra TODO item
-- do carrinho, veio de onde vier. O /banner/checkout continua idêntico:
-- prioriza (ORDER BY) a promoção específica do banner quando ela cobre o
-- produto, só cai pra "qualquer promoção ativa que inclua esse produto"
-- quando não veio de um banner (ou o produto não está nela).
--
-- Execução: depois de sunset_promocao_categoria_dinamica.sql.
-- =====================================================

CREATE OR REPLACE FUNCTION ufersin.create_order(
  p_customer_name text,
  p_customer_whatsapp text,
  p_delivery_type text,
  p_payment_method text,
  p_neighborhood text,
  p_address text,
  p_items jsonb,
  p_customer_lat double precision DEFAULT NULL,
  p_customer_lng double precision DEFAULT NULL,
  p_reference_point text DEFAULT NULL,
  p_customer_birthdate text DEFAULT NULL,
  p_coupon_code text DEFAULT NULL,
  p_promotion_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_item               jsonb;
  v_product            ufersin.products%ROWTYPE;
  v_quantity           bigint;
  v_subtotal           double precision := 0;
  v_shipping           double precision := 0;
  v_discount_amount    double precision := 0;
  v_shipping_discount  double precision := 0;
  v_customer_id        text;
  v_order_id           text := gen_random_uuid()::text;
  v_item_id            text;
  v_settings           ufersin.shipping_settings%ROWTYPE;
  v_km                 double precision;
  v_birthdate          date;
  v_promotion          ufersin.promotions%ROWTYPE;
  v_coupon             ufersin.coupons%ROWTYPE;
  v_coupon_code        text;
  v_grant               ufersin.coupon_grants%ROWTYPE;
  v_is_targeted        boolean;
  v_pd                 ufersin.coupon_product_discounts%ROWTYPE;
  v_cpd                ufersin.promotion_product_discounts%ROWTYPE;
  v_item_total         double precision;
  v_total              double precision;
  v_submitted_ids      text[];
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
  IF p_delivery_type = 'entrega' AND (p_customer_lat IS NULL OR p_customer_lng IS NULL) THEN
    RAISE EXCEPTION 'customer location (lat/lng) is required for entrega';
  END IF;

  IF p_customer_birthdate IS NULL OR trim(p_customer_birthdate) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  BEGIN
    v_birthdate := p_customer_birthdate::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid birthdate';
  END;
  IF v_birthdate > current_date THEN
    RAISE EXCEPTION 'invalid birthdate';
  END IF;
  IF extract(year FROM age(current_date, v_birthdate)) < 18 THEN
    RAISE EXCEPTION 'you must be 18 or older to purchase tobacco products';
  END IF;

  IF p_promotion_id IS NOT NULL THEN
    SELECT * INTO v_promotion FROM ufersin.promotions WHERE id = p_promotion_id;
    IF NOT FOUND OR v_promotion.active = 0
       OR (v_promotion.starts_at IS NOT NULL AND v_promotion.starts_at::timestamptz > now())
       OR (v_promotion.expires_at IS NOT NULL AND v_promotion.expires_at::timestamptz <= now()) THEN
      RAISE EXCEPTION 'promotion is not available';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE NOT ((i->>'product_id') = ANY(v_promotion.product_ids))
    ) THEN
      RAISE EXCEPTION 'this promotion checkout can only contain the promotion products';
    END IF;
    IF v_promotion.promotion_type = 'kit' THEN
      SELECT array_agg(DISTINCT i->>'product_id') INTO v_submitted_ids FROM jsonb_array_elements(p_items) i;
      IF v_submitted_ids IS NULL OR array_length(v_submitted_ids, 1) <> array_length(v_promotion.product_ids, 1)
         OR NOT (v_submitted_ids @> v_promotion.product_ids) THEN
        RAISE EXCEPTION 'this kit promotion can only be purchased as the full bundle';
      END IF;
    END IF;
  END IF;

  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    SELECT * INTO v_coupon FROM ufersin.coupons WHERE upper(code) = upper(trim(p_coupon_code));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'coupon not found';
    END IF;
    IF v_coupon.active = 0 THEN
      RAISE EXCEPTION 'coupon is not active';
    END IF;
    IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at::timestamptz <= now() THEN
      RAISE EXCEPTION 'coupon has expired';
    END IF;
    IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
      RAISE EXCEPTION 'coupon usage limit reached';
    END IF;
    IF p_promotion_id IS NOT NULL AND v_coupon.allow_promotion_checkout = 0 THEN
      RAISE EXCEPTION 'this coupon cannot be combined with a promotion checkout';
    END IF;
    IF v_coupon.kind = 'aniversario' AND extract(month FROM v_birthdate) <> extract(month FROM current_date) THEN
      RAISE EXCEPTION 'this coupon is only valid during your birthday month';
    END IF;

    SELECT EXISTS(SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = v_coupon.id) INTO v_is_targeted;
    IF v_is_targeted THEN
      SELECT * INTO v_grant FROM ufersin.coupon_grants
        WHERE coupon_id = v_coupon.id AND customer_whatsapp = p_customer_whatsapp AND used_count < granted_uses
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'this coupon is not available for your account';
      END IF;
      UPDATE ufersin.coupon_grants SET used_count = used_count + 1 WHERE id = v_grant.id;
    END IF;
    v_coupon_code := v_coupon.code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::bigint;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'item quantity must be positive';
    END IF;

    SELECT * INTO v_product FROM ufersin.products
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

    v_item_total := v_product.price * v_quantity;
    v_subtotal := v_subtotal + v_item_total;

    IF v_coupon.kind = 'produto' THEN
      SELECT * INTO v_pd FROM ufersin.coupon_product_discounts
        WHERE coupon_id = v_coupon.id AND product_id = v_product.id;
      IF FOUND THEN
        IF v_pd.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_item_total * v_pd.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + LEAST(v_pd.discount_value * v_quantity, v_item_total);
        END IF;
      END IF;
    END IF;

    -- Desconto de produto em promoção selfie_service é GLOBAL: roda pra
    -- TODO item, não só quando o checkout veio de um p_promotion_id (banner).
    -- Prioriza a promoção do próprio banner quando ela existe e cobre esse
    -- produto (ORDER BY (p.id = v_promotion.id) DESC) — se v_promotion.id
    -- for NULL (checkout normal, sem banner) essa comparação vira NULL pra
    -- toda linha e não influencia a ordem, então cai pra "qualquer promoção
    -- selfie_service ativa que inclua o produto".
    SELECT pd.* INTO v_cpd FROM ufersin.promotion_product_discounts pd
      JOIN ufersin.promotions p ON p.id = pd.promotion_id
      WHERE pd.product_id = v_product.id
        AND p.promotion_type = 'selfie_service'
        AND p.active <> 0
        AND (p.starts_at IS NULL OR p.starts_at::timestamptz <= now())
        AND (p.expires_at IS NULL OR p.expires_at::timestamptz > now())
      ORDER BY (p.id = v_promotion.id) DESC
      LIMIT 1;
    IF FOUND THEN
      IF v_cpd.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_item_total * v_cpd.discount_value / 100)::numeric, 2);
      ELSE
        v_discount_amount := v_discount_amount + LEAST(v_cpd.discount_value * v_quantity, v_item_total);
      END IF;
    END IF;
  END LOOP;

  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM ufersin.shipping_settings WHERE id = 1;
    v_km := ufersin._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
  END IF;

  IF v_promotion.id IS NOT NULL THEN
    IF v_promotion.promotion_type = 'kit' THEN
      IF v_promotion.discount_type = 'percent' THEN
        v_discount_amount := v_discount_amount + round((v_subtotal * v_promotion.discount_value / 100)::numeric, 2);
      ELSIF v_promotion.discount_type = 'fixed' THEN
        v_discount_amount := v_discount_amount + v_promotion.discount_value;
      END IF;
    END IF;
    -- selfie_service já somou o desconto por item no loop acima
    IF v_promotion.shipping_discount_type = 'percent' THEN
      v_shipping_discount := v_shipping_discount + round((v_shipping * v_promotion.shipping_discount_value / 100)::numeric, 2);
    ELSIF v_promotion.shipping_discount_type = 'fixed' THEN
      v_shipping_discount := v_shipping_discount + v_promotion.shipping_discount_value;
    END IF;
  END IF;

  IF v_coupon.id IS NOT NULL THEN
    IF v_coupon.kind = 'frete' THEN
      IF v_coupon.discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.discount_value / 100)::numeric, 2);
      ELSE
        v_shipping_discount := v_shipping_discount + v_coupon.discount_value;
      END IF;
    ELSE
      IF v_coupon.kind = 'desconto' AND v_coupon.discount_type IS NOT NULL THEN
        IF v_coupon.discount_type = 'percent' THEN
          v_discount_amount := v_discount_amount + round((v_subtotal * v_coupon.discount_value / 100)::numeric, 2);
        ELSE
          v_discount_amount := v_discount_amount + v_coupon.discount_value;
        END IF;
      END IF;
      IF v_coupon.shipping_discount_type = 'percent' THEN
        v_shipping_discount := v_shipping_discount + round((v_shipping * v_coupon.shipping_discount_value / 100)::numeric, 2);
      ELSIF v_coupon.shipping_discount_type = 'fixed' THEN
        v_shipping_discount := v_shipping_discount + v_coupon.shipping_discount_value;
      END IF;
    END IF;
    UPDATE ufersin.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_discount_amount := LEAST(GREATEST(v_discount_amount, 0), v_subtotal);
  v_shipping_discount := LEAST(GREATEST(v_shipping_discount, 0), v_shipping);
  v_total := (v_subtotal - v_discount_amount) + (v_shipping - v_shipping_discount);

  SELECT id INTO v_customer_id FROM ufersin.customers WHERE whatsapp = p_customer_whatsapp;
  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, birthdate) VALUES (v_customer_id, p_customer_name, p_customer_whatsapp, p_customer_birthdate);
  ELSE
    UPDATE ufersin.customers SET name = p_customer_name, birthdate = p_customer_birthdate WHERE id = v_customer_id;
  END IF;

  INSERT INTO ufersin.orders (
    id, customer_id, customer_name, customer_whatsapp, delivery_type,
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng,
    discount_amount, shipping_discount, coupon_code, promotion_id
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng,
    v_discount_amount, v_shipping_discount, v_coupon_code, p_promotion_id
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM ufersin.products WHERE id = (v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::bigint;
    v_item_id := gen_random_uuid()::text;

    INSERT INTO ufersin.order_items (id, order_id, product_id, product_name, unit_price, quantity)
      VALUES (v_item_id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity);

    UPDATE ufersin.products SET quantity = quantity - v_quantity WHERE id = v_product.id;
  END LOOP;

  RETURN ufersin.get_order(v_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.create_order(text, text, text, text, text, text, jsonb, double precision, double precision, text, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────
-- sunset_bg_settings.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Fundo do site (SunsetBackdrop) ajustável pelo admin em /admin/conta:
-- escolhe entre o SVG padrão (coqueiro), a cena synthwave, ou uma imagem
-- própria enviada por upload — e ajusta tamanho/posição/enquadramento
-- do que estiver ativo. Vale pra TODO mundo que visita o site (fica
-- salvo no banco, não é um ajuste local do navegador do admin).
-- =====================================================

ALTER TABLE ufersin.site_settings
  ADD COLUMN IF NOT EXISTS bg_mode text NOT NULL DEFAULT 'svg1',
  ADD COLUMN IF NOT EXISTS bg_image_url text,
  ADD COLUMN IF NOT EXISTS bg_scale numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bg_x numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bg_y numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bg_fit text NOT NULL DEFAULT 'meet';

ALTER TABLE ufersin.site_settings
  ADD CONSTRAINT sunset_site_settings_bg_mode_check CHECK (bg_mode IN ('svg1', 'synthwave', 'stars', 'custom'));

ALTER TABLE ufersin.site_settings
  ADD CONSTRAINT sunset_site_settings_bg_fit_check CHECK (bg_fit IN ('meet', 'slice'));

CREATE OR REPLACE FUNCTION ufersin.admin_update_bg_settings(
  p_token text,
  p_bg_mode text,
  p_bg_image_url text,
  p_bg_scale numeric,
  p_bg_x numeric,
  p_bg_y numeric,
  p_bg_fit text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_bg_mode NOT IN ('svg1', 'synthwave', 'stars', 'custom') THEN
    RAISE EXCEPTION 'invalid bg_mode';
  END IF;
  IF p_bg_fit NOT IN ('meet', 'slice') THEN
    RAISE EXCEPTION 'invalid bg_fit';
  END IF;
  UPDATE ufersin.site_settings SET
    bg_mode = p_bg_mode,
    bg_image_url = p_bg_image_url,
    bg_scale = p_bg_scale,
    bg_x = p_bg_x,
    bg_y = p_bg_y,
    bg_fit = p_bg_fit
  WHERE id = 1;
  RETURN jsonb_build_object(
    'bg_mode', p_bg_mode, 'bg_image_url', p_bg_image_url, 'bg_scale', p_bg_scale,
    'bg_x', p_bg_x, 'bg_y', p_bg_y, 'bg_fit', p_bg_fit
  );
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_bg_settings(text, text, text, numeric, numeric, numeric, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_smoke_and_badges_settings.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Fumaça do botão do carrinho (velocidade/quantidade/largura do
-- container/altura de subida) e badges da landing (lista editável de
-- texto + layout lado-a-lado ou empilhado + espaçamento), ambos
-- ajustáveis pelo admin em /admin/conta. Badges guardadas como jsonb
-- (lista pequena, sem necessidade de tabela relacional própria).
-- =====================================================

ALTER TABLE ufersin.site_settings
  ADD COLUMN IF NOT EXISTS smoke_speed numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS smoke_count int NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS smoke_width numeric NOT NULL DEFAULT 64,
  ADD COLUMN IF NOT EXISTS smoke_height numeric NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS badges jsonb NOT NULL DEFAULT '[
    {"id": "1", "text": "SUNSET • Desde 2023", "bold": true},
    {"id": "2", "text": "🔥 Experiência, vibe e essência", "bold": false},
    {"id": "3", "text": "👇 A vibe começa aqui", "bold": false}
  ]'::jsonb,
  ADD COLUMN IF NOT EXISTS badges_layout text NOT NULL DEFAULT 'row',
  ADD COLUMN IF NOT EXISTS badges_gap numeric NOT NULL DEFAULT 8;

ALTER TABLE ufersin.site_settings
  ADD CONSTRAINT sunset_site_settings_badges_layout_check CHECK (badges_layout IN ('row', 'column'));

CREATE OR REPLACE FUNCTION ufersin.admin_update_smoke_settings(
  p_token text,
  p_speed numeric,
  p_count int,
  p_width numeric,
  p_height numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_count < 1 OR p_count > 40 THEN
    RAISE EXCEPTION 'invalid smoke count';
  END IF;
  UPDATE ufersin.site_settings SET
    smoke_speed = p_speed,
    smoke_count = p_count,
    smoke_width = p_width,
    smoke_height = p_height
  WHERE id = 1;
  RETURN jsonb_build_object('smoke_speed', p_speed, 'smoke_count', p_count, 'smoke_width', p_width, 'smoke_height', p_height);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_smoke_settings(text, numeric, int, numeric, numeric) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_update_badges(
  p_token text,
  p_badges jsonb,
  p_layout text,
  p_gap numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_layout NOT IN ('row', 'column') THEN
    RAISE EXCEPTION 'invalid badges_layout';
  END IF;
  UPDATE ufersin.site_settings SET
    badges = p_badges,
    badges_layout = p_layout,
    badges_gap = p_gap
  WHERE id = 1;
  RETURN jsonb_build_object('badges', p_badges, 'badges_layout', p_layout, 'badges_gap', p_gap);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_badges(text, jsonb, text, numeric) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_badges_offset_y.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Deslocamento vertical (px, pode ser negativo) do container de badges
-- da landing — o admin sobe ou desce o bloco pra fechar o espaço vazio
-- entre o banner e ele, sem mexer em código.
-- =====================================================

ALTER TABLE ufersin.site_settings
  ADD COLUMN IF NOT EXISTS badges_offset_y numeric NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS ufersin.admin_update_badges(text, jsonb, text, numeric);

CREATE OR REPLACE FUNCTION ufersin.admin_update_badges(
  p_token text,
  p_badges jsonb,
  p_layout text,
  p_gap numeric,
  p_offset_y numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_layout NOT IN ('row', 'column') THEN
    RAISE EXCEPTION 'invalid badges_layout';
  END IF;
  UPDATE ufersin.site_settings SET
    badges = p_badges,
    badges_layout = p_layout,
    badges_gap = p_gap,
    badges_offset_y = p_offset_y
  WHERE id = 1;
  RETURN jsonb_build_object('badges', p_badges, 'badges_layout', p_layout, 'badges_gap', p_gap, 'badges_offset_y', p_offset_y);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_badges(text, jsonb, text, numeric, numeric) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_cupom_exclusivo_agendamento.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Agendamento de disparo por cupom exclusivo (principal ou extra) de uma
-- campanha 'evento': em vez de notificar o cliente por WhatsApp na hora
-- em que ele passa a bater o critério do gatilho, o admin pode definir
-- "manda em X dias, às H horas (horário de Brasília)". Sem isso
-- (schedule_delay_days NULL), comportamento é o de sempre — notifica na
-- hora que concede.
--
-- Como não existe job em background no projeto (só reavalia quando
-- alguém abre o CRM — ver comentário em AdminCrm.tsx), o agendamento
-- também só é checado nesse mesmo momento: cada vez que o CRM carrega,
-- roda admin_dispatch_scheduled_coupon_notifications, que resolve todo
-- concessão pendente (grant) cujo prazo+horário já bateu.
-- =====================================================

ALTER TABLE ufersin.crm_segment_coupons
  ADD COLUMN IF NOT EXISTS schedule_delay_days int,
  ADD COLUMN IF NOT EXISTS schedule_hour int;
ALTER TABLE ufersin.crm_segment_coupons
  ADD CONSTRAINT sunset_crm_segment_coupons_schedule_hour_check CHECK (schedule_hour IS NULL OR (schedule_hour >= 0 AND schedule_hour <= 23));

ALTER TABLE ufersin.crm_campanha_extra_coupons
  ADD COLUMN IF NOT EXISTS schedule_delay_days int,
  ADD COLUMN IF NOT EXISTS schedule_hour int;
ALTER TABLE ufersin.crm_campanha_extra_coupons
  ADD CONSTRAINT sunset_crm_campanha_extra_coupons_schedule_hour_check CHECK (schedule_hour IS NULL OR (schedule_hour >= 0 AND schedule_hour <= 23));

-- NULL = ainda não notificado (pendente, seja imediato ou agendado).
ALTER TABLE ufersin.coupon_grants
  ADD COLUMN IF NOT EXISTS notified_at text;

CREATE OR REPLACE FUNCTION ufersin._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ufersin, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'name', name, 'description', description, 'starts_at', starts_at, 'ends_at', ends_at,
    'trigger_criteria', trigger_criteria, 'trigger_description', trigger_description,
    'end_criteria', end_criteria, 'end_description', end_description, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'last_synced_segment_criteria', last_synced_segment_criteria,
    'schedule_delay_days', schedule_delay_days, 'schedule_hour', schedule_hour,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'coupon', ufersin._coupon_json(ec.coupon_id), 'message_template', ec.message_template, 'end_criteria', ec.end_criteria,
        'schedule_delay_days', ec.schedule_delay_days, 'schedule_hour', ec.schedule_hour
      ) ORDER BY ec.created_at)
      FROM ufersin.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM ufersin.crm_segment_coupons WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION ufersin.admin_set_campanha_coupon_schedule(p_token text, p_id text, p_delay_days int, p_hour int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_delay_days IS NOT NULL AND p_hour IS NULL THEN
    RAISE EXCEPTION 'hour is required when scheduling';
  END IF;
  IF p_hour IS NOT NULL AND (p_hour < 0 OR p_hour > 23) THEN
    RAISE EXCEPTION 'invalid hour';
  END IF;
  UPDATE ufersin.crm_segment_coupons SET schedule_delay_days = p_delay_days, schedule_hour = p_hour WHERE id = p_id;
  RETURN ufersin._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_set_campanha_coupon_schedule(text, text, int, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION ufersin.admin_set_extra_coupon_schedule(p_token text, p_id text, p_delay_days int, p_hour int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_delay_days IS NOT NULL AND p_hour IS NULL THEN
    RAISE EXCEPTION 'hour is required when scheduling';
  END IF;
  IF p_hour IS NOT NULL AND (p_hour < 0 OR p_hour > 23) THEN
    RAISE EXCEPTION 'invalid hour';
  END IF;
  UPDATE ufersin.crm_campanha_extra_coupons SET schedule_delay_days = p_delay_days, schedule_hour = p_hour WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_set_extra_coupon_schedule(text, text, int, int) TO anon, authenticated;

-- Grava o grant já com notified_at preenchido (não agendado -> pronto
-- pra notificar na hora, front chama notifyCouponGrant logo depois) OU
-- em aberto (agendado -> fica pendente até
-- admin_dispatch_scheduled_coupon_notifications resolver). Também passa
-- a retornar 'to_notify' (principal + extras sem agendamento, juntos —
-- antes só o principal era notificado, extras eram concedidos sem
-- avisar o cliente).
CREATE OR REPLACE FUNCTION ufersin.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_row       ufersin.crm_segment_coupons%ROWTYPE;
  v_whatsapp  text;
  v_newly     text[] := '{}';
  v_in_window boolean;
  v_to_notify jsonb := '[]'::jsonb;
  v_notify_ws text[];
  rec         record;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  SELECT * INTO v_row FROM ufersin.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas can be re-fired';
  END IF;
  IF v_row.active = 0 THEN
    RAISE EXCEPTION 'this campanha is paused';
  END IF;

  v_in_window := (v_row.starts_at IS NULL OR v_row.starts_at::timestamptz <= now())
    AND (v_row.ends_at IS NULL OR v_row.ends_at::timestamptz >= now());
  IF NOT v_in_window THEN
    RETURN jsonb_build_object('newly_granted', '[]'::jsonb, 'to_notify', '[]'::jsonb);
  END IF;

  FOR rec IN
    SELECT c.id AS coupon_id, c.active, c.starts_at, c.expires_at,
           v_row.schedule_delay_days AS delay, v_row.schedule_hour AS hour, v_row.message_template AS message_template,
           true AS is_primary
    FROM ufersin.coupons c WHERE c.id = v_row.coupon_id
    UNION ALL
    SELECT c.id, c.active, c.starts_at, c.expires_at,
           ec.schedule_delay_days, ec.schedule_hour, ec.message_template,
           false
    FROM ufersin.coupons c JOIN ufersin.crm_campanha_extra_coupons ec ON ec.coupon_id = c.id WHERE ec.campanha_id = p_id
  LOOP
    IF rec.active = 0
       OR (rec.starts_at IS NOT NULL AND rec.starts_at::timestamptz > now())
       OR (rec.expires_at IS NOT NULL AND rec.expires_at::timestamptz <= now()) THEN
      CONTINUE;
    END IF;
    v_notify_ws := '{}';
    FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
      IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM ufersin.coupon_grants WHERE coupon_id = rec.coupon_id AND customer_whatsapp = v_whatsapp) THEN
        INSERT INTO ufersin.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count, notified_at)
          VALUES (
            gen_random_uuid()::text, rec.coupon_id, v_whatsapp, v_row.uses_per_customer, 0,
            CASE WHEN rec.delay IS NULL THEN now()::text ELSE NULL END
          );
        IF rec.is_primary THEN
          v_newly := array_append(v_newly, v_whatsapp);
        END IF;
        IF rec.delay IS NULL THEN
          v_notify_ws := array_append(v_notify_ws, v_whatsapp);
        END IF;
      END IF;
    END LOOP;
    IF array_length(v_notify_ws, 1) > 0 THEN
      v_to_notify := v_to_notify || jsonb_build_object('coupon_id', rec.coupon_id, 'message_template', rec.message_template, 'whatsapps', to_jsonb(v_notify_ws));
    END IF;
  END LOOP;

  IF array_length(v_newly, 1) > 0 THEN
    UPDATE ufersin.crm_segment_coupons SET last_fired_at = now()::text WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_newly), 'to_notify', v_to_notify);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_fire_campanha_event(text, text, text[]) TO anon, authenticated;

-- Roda a cada load do CRM (junto do resto do auto-check): resolve todo
-- grant pendente (notified_at NULL) de cupom AGENDADO cujo prazo (dias
-- desde a concessão) já passou e cuja hora de Brasília bate com a
-- configurada — marca como notificado e devolve pro front disparar o
-- WhatsApp de cada um.
CREATE OR REPLACE FUNCTION ufersin.admin_dispatch_scheduled_coupon_notifications(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);

  WITH due AS (
    SELECT
      g.id AS grant_id,
      g.coupon_id,
      g.customer_whatsapp,
      COALESCE(sc.message_template, ec.message_template) AS message_template
    FROM ufersin.coupon_grants g
    LEFT JOIN ufersin.crm_segment_coupons sc ON sc.coupon_id = g.coupon_id AND sc.schedule_delay_days IS NOT NULL
    LEFT JOIN ufersin.crm_campanha_extra_coupons ec ON ec.coupon_id = g.coupon_id AND ec.schedule_delay_days IS NOT NULL
    WHERE g.notified_at IS NULL
      AND (sc.coupon_id IS NOT NULL OR ec.coupon_id IS NOT NULL)
      AND (g.created_at::timestamptz + make_interval(days => COALESCE(sc.schedule_delay_days, ec.schedule_delay_days))) <= now()
      AND EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int = COALESCE(sc.schedule_hour, ec.schedule_hour)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('coupon_id', coupon_id, 'customer_whatsapp', customer_whatsapp, 'message_template', message_template)), '[]'::jsonb)
    INTO v_result
  FROM due;

  UPDATE ufersin.coupon_grants g SET notified_at = now()::text
  WHERE g.notified_at IS NULL
    AND EXISTS (
      SELECT 1 FROM ufersin.crm_segment_coupons sc
      WHERE sc.coupon_id = g.coupon_id AND sc.schedule_delay_days IS NOT NULL
        AND (g.created_at::timestamptz + make_interval(days => sc.schedule_delay_days)) <= now()
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int = sc.schedule_hour
    )
    OR EXISTS (
      SELECT 1 FROM ufersin.crm_campanha_extra_coupons ec
      WHERE ec.coupon_id = g.coupon_id AND ec.schedule_delay_days IS NOT NULL
        AND (g.created_at::timestamptz + make_interval(days => ec.schedule_delay_days)) <= now()
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int = ec.schedule_hour
    );

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_dispatch_scheduled_coupon_notifications(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_promotion_subtitle.sql
-- ───────────────────────────────────────────────────────────────────
-- Subtítulo do banner na landing (segunda linha do rodapé do .ufersin-jcard,
-- hardcoded como "Promoções" até aqui) — agora configurável por promoção.
-- Vazio/NULL continua caindo pro "Promoções" padrão no frontend.
ALTER TABLE ufersin.promotions ADD COLUMN IF NOT EXISTS subtitle text;

CREATE OR REPLACE FUNCTION ufersin._promotion_json(p_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ufersin', 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', c.id, 'title', c.title, 'subtitle', c.subtitle, 'image_url', c.image_url, 'product_ids', to_jsonb(c.product_ids),
    'promotion_type', c.promotion_type,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'active', (c.active <> 0), 'starts_at', c.starts_at, 'expires_at', c.expires_at, 'created_at', c.created_at,
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.promotion_product_discounts pd WHERE pd.promotion_id = c.id
    ), '[]'::jsonb),
    'category_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category_id', cd.category_id, 'discount_type', cd.discount_type, 'discount_value', cd.discount_value
      )) FROM ufersin.promotion_category_discounts cd WHERE cd.promotion_id = c.id
    ), '[]'::jsonb)
  ) FROM ufersin.promotions c WHERE c.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION ufersin.admin_create_promotion(
  p_token text, p_title text, p_image_url text, p_product_ids text[],
  p_promotion_type text DEFAULT 'kit'::text,
  p_discount_type text DEFAULT NULL::text,
  p_discount_value double precision DEFAULT NULL::double precision,
  p_shipping_discount_type text DEFAULT NULL::text,
  p_shipping_discount_value double precision DEFAULT NULL::double precision,
  p_starts_at text DEFAULT NULL::text,
  p_expires_at text DEFAULT NULL::text,
  p_product_discounts jsonb DEFAULT NULL::jsonb,
  p_category_discounts jsonb DEFAULT NULL::jsonb,
  p_subtitle text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_pd jsonb;
  v_cd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required to create a promotion';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF p_promotion_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid promotion_type';
  END IF;
  IF p_promotion_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service promotion';
    END IF;
  ELSE
    IF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
      RAISE EXCEPTION 'a kit promotion needs a product discount and/or a shipping discount';
    END IF;
    IF p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'invalid discount_type';
    END IF;
    IF p_discount_type = 'percent' AND (p_discount_value <= 0 OR p_discount_value > 100) THEN
      RAISE EXCEPTION 'percent discount must be between 0 and 100';
    END IF;
    IF p_discount_type = 'fixed' AND p_discount_value <= 0 THEN
      RAISE EXCEPTION 'fixed discount must be positive';
    END IF;
  END IF;

  INSERT INTO ufersin.promotions (
    id, title, subtitle, image_url, product_ids, promotion_type, discount_type, discount_value,
    shipping_discount_type, shipping_discount_value, starts_at, expires_at
  ) VALUES (
    v_id, trim(p_title), NULLIF(trim(p_subtitle), ''), p_image_url, p_product_ids, p_promotion_type,
    CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    p_shipping_discount_type, p_shipping_discount_value,
    NULLIF(trim(p_starts_at), ''), NULLIF(trim(p_expires_at), '')
  );

  IF p_promotion_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, v_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;

    IF p_category_discounts IS NOT NULL THEN
      FOR v_cd IN SELECT * FROM jsonb_array_elements(p_category_discounts) LOOP
        INSERT INTO ufersin.promotion_category_discounts (id, promotion_id, category_id, discount_type, discount_value)
          VALUES (gen_random_uuid()::text, v_id, v_cd->>'category_id', v_cd->>'discount_type', (v_cd->>'discount_value')::double precision);
        PERFORM ufersin._sync_promotion_category_products(v_cd->>'category_id');
      END LOOP;
    END IF;

    UPDATE ufersin.promotions SET product_ids = (
      SELECT COALESCE(array_agg(DISTINCT product_id), ARRAY[]::text[])
      FROM ufersin.promotion_product_discounts WHERE promotion_id = v_id
    ) WHERE id = v_id;
  END IF;

  RETURN ufersin._promotion_json(v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION ufersin.admin_update_promotion(
  p_token text, p_id text, p_title text, p_image_url text, p_product_ids text[],
  p_promotion_type text, p_discount_type text, p_discount_value double precision,
  p_shipping_discount_type text, p_shipping_discount_value double precision, p_active boolean,
  p_starts_at text DEFAULT NULL::text,
  p_expires_at text DEFAULT NULL::text,
  p_product_discounts jsonb DEFAULT NULL::jsonb,
  p_category_discounts jsonb DEFAULT NULL::jsonb,
  p_subtitle text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_pd jsonb;
  v_cd jsonb;
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one product is required';
  END IF;
  IF p_promotion_type NOT IN ('selfie_service', 'kit') THEN
    RAISE EXCEPTION 'invalid promotion_type';
  END IF;
  IF p_promotion_type = 'selfie_service' THEN
    IF p_product_discounts IS NULL OR jsonb_array_length(p_product_discounts) = 0 THEN
      RAISE EXCEPTION 'at least one product discount is required for a selfie-service promotion';
    END IF;
  ELSIF (p_discount_type IS NULL OR p_discount_value IS NULL) AND p_shipping_discount_type IS NULL THEN
    RAISE EXCEPTION 'a kit promotion needs a product discount and/or a shipping discount';
  END IF;

  UPDATE ufersin.promotions SET
    title = trim(p_title), subtitle = NULLIF(trim(p_subtitle), ''), image_url = p_image_url, product_ids = p_product_ids,
    promotion_type = p_promotion_type,
    discount_type = CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_type END,
    discount_value = CASE WHEN p_promotion_type = 'selfie_service' THEN NULL ELSE p_discount_value END,
    shipping_discount_type = p_shipping_discount_type, shipping_discount_value = p_shipping_discount_value,
    active = CASE WHEN p_active THEN 1 ELSE 0 END,
    starts_at = NULLIF(trim(p_starts_at), ''), expires_at = NULLIF(trim(p_expires_at), '')
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion not found';
  END IF;

  DELETE FROM ufersin.promotion_product_discounts WHERE promotion_id = p_id;
  DELETE FROM ufersin.promotion_category_discounts WHERE promotion_id = p_id;

  IF p_promotion_type = 'selfie_service' THEN
    FOR v_pd IN SELECT * FROM jsonb_array_elements(p_product_discounts) LOOP
      INSERT INTO ufersin.promotion_product_discounts (id, promotion_id, product_id, discount_type, discount_value)
        VALUES (gen_random_uuid()::text, p_id, v_pd->>'product_id', v_pd->>'discount_type', (v_pd->>'discount_value')::double precision);
    END LOOP;

    IF p_category_discounts IS NOT NULL THEN
      FOR v_cd IN SELECT * FROM jsonb_array_elements(p_category_discounts) LOOP
        INSERT INTO ufersin.promotion_category_discounts (id, promotion_id, category_id, discount_type, discount_value)
          VALUES (gen_random_uuid()::text, p_id, v_cd->>'category_id', v_cd->>'discount_type', (v_cd->>'discount_value')::double precision);
        PERFORM ufersin._sync_promotion_category_products(v_cd->>'category_id');
      END LOOP;
    END IF;

    UPDATE ufersin.promotions SET product_ids = (
      SELECT COALESCE(array_agg(DISTINCT product_id), ARRAY[]::text[])
      FROM ufersin.promotion_product_discounts WHERE promotion_id = p_id
    ) WHERE id = p_id;
  END IF;

  RETURN ufersin._promotion_json(p_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION ufersin.admin_create_promotion(text, text, text, text[], text, text, double precision, text, double precision, text, text, jsonb, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_promotion(text, text, text, text, text[], text, text, double precision, text, double precision, boolean, text, text, jsonb, jsonb, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_customer_auth.sql
-- ───────────────────────────────────────────────────────────────────
-- Login de cliente por whatsapp+senha (PIN numérico de 4 dígitos, igual o
-- código de recuperação por WhatsApp é de 3 dígitos). Mesmo padrão de
-- admin_login/vendedor_login/motoboy_login: pgcrypto crypt() + ufersin.sessions
-- (role='customer'). ufersin.customers já existe (linhas criadas hoje pelo
-- checkout sem senha nenhuma) — registro faz UPSERT por whatsapp em vez de
-- sempre inserir, pra não duplicar quem já tem pedido feito antes de logar.
ALTER TABLE ufersin.customers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE ufersin.customers ADD COLUMN IF NOT EXISTS password_hash text;

-- Código de recuperação de senha (3 dígitos, enviado por WhatsApp pelo
-- backend Rust — só ele toca a Evolution API). Curto de propósito (expira
-- rápido, 10 min) já que é só 3 dígitos.
CREATE TABLE IF NOT EXISTS ufersin.customer_password_resets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  customer_id text NOT NULL REFERENCES ufersin.customers(id) ON DELETE CASCADE,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_password_resets_customer ON ufersin.customer_password_resets(customer_id);

CREATE OR REPLACE FUNCTION ufersin._require_customer(p_token text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_subject text;
BEGIN
  SELECT subject_id INTO v_subject FROM ufersin.sessions
    WHERE token = p_token AND role = 'customer' AND expires_at > now();
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN v_subject;
END;
$function$;

CREATE OR REPLACE FUNCTION ufersin._customer_json(p_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ufersin', 'public'
AS $function$
  SELECT jsonb_build_object('id', id, 'name', name, 'whatsapp', whatsapp, 'email', email, 'birthdate', birthdate)
  FROM ufersin.customers WHERE id = p_id;
$function$;

-- Cadastro: se já existe uma linha com esse whatsapp (criada num checkout
-- anterior sem senha), completa o cadastro nela em vez de duplicar cliente.
-- Se já tinha senha definida, bloqueia (já é cadastrado — usar login).
CREATE OR REPLACE FUNCTION ufersin.customer_register(
  p_whatsapp text, p_password text, p_name text, p_email text, p_birthdate text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_id text;
  v_existing ufersin.customers%ROWTYPE;
  v_token text;
BEGIN
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF p_whatsapp IS NULL OR length(regexp_replace(p_whatsapp, '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'a valid whatsapp is required';
  END IF;
  IF trim(coalesce(p_email, '')) = '' THEN
    RAISE EXCEPTION 'email is required';
  END IF;
  IF trim(coalesce(p_birthdate, '')) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  IF p_password !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'password must be exactly 4 digits';
  END IF;

  SELECT * INTO v_existing FROM ufersin.customers WHERE whatsapp = p_whatsapp;
  IF FOUND THEN
    IF v_existing.password_hash IS NOT NULL THEN
      RAISE EXCEPTION 'this whatsapp is already registered';
    END IF;
    v_id := v_existing.id;
    UPDATE ufersin.customers SET
      name = trim(p_name), email = trim(p_email), birthdate = p_birthdate,
      password_hash = crypt(p_password, gen_salt('bf'))
    WHERE id = v_id;
  ELSE
    v_id := gen_random_uuid()::text;
    INSERT INTO ufersin.customers (id, name, whatsapp, email, birthdate, password_hash, created_at)
    VALUES (v_id, trim(p_name), p_whatsapp, trim(p_email), p_birthdate, crypt(p_password, gen_salt('bf')), now()::text);
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO ufersin.sessions (token, role, subject_id, expires_at) VALUES (v_token, 'customer', v_id, now() + interval '30 days');

  RETURN jsonb_build_object('token', v_token, 'customer', ufersin._customer_json(v_id));
END;
$function$;

CREATE OR REPLACE FUNCTION ufersin.customer_login(p_whatsapp text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_c ufersin.customers%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_c FROM ufersin.customers WHERE whatsapp = p_whatsapp;
  IF NOT FOUND OR v_c.password_hash IS NULL OR v_c.password_hash <> crypt(p_password, v_c.password_hash) THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO ufersin.sessions (token, role, subject_id, expires_at) VALUES (v_token, 'customer', v_c.id, now() + interval '30 days');

  RETURN jsonb_build_object('token', v_token, 'customer', ufersin._customer_json(v_c.id));
END;
$function$;

CREATE OR REPLACE FUNCTION ufersin.customer_me(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_id text := ufersin._require_customer(p_token);
BEGIN
  RETURN ufersin._customer_json(v_id);
END;
$function$;

-- Gera e grava o código de 3 dígitos (chamada pelo backend Rust, que faz
-- SQLx direto — não passa por PostgREST). Não devolve o código pra quem
-- chamar via RPC pública, só usada internamente; por isso não tem GRANT
-- pra anon/authenticated (só o Rust, com a connection string de serviço,
-- consegue rodar isso).
CREATE OR REPLACE FUNCTION ufersin._create_customer_reset_code(p_whatsapp text)
 RETURNS TABLE(customer_id text, customer_name text, code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_c ufersin.customers%ROWTYPE;
  v_code text;
BEGIN
  SELECT * INTO v_c FROM ufersin.customers WHERE whatsapp = p_whatsapp AND password_hash IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer not found';
  END IF;

  v_code := lpad(floor(random() * 1000)::int::text, 3, '0');
  INSERT INTO ufersin.customer_password_resets (id, customer_id, code, expires_at)
  VALUES (gen_random_uuid()::text, v_c.id, v_code, now() + interval '10 minutes');

  RETURN QUERY SELECT v_c.id, v_c.name, v_code;
END;
$function$;

CREATE OR REPLACE FUNCTION ufersin.customer_verify_reset_code(p_whatsapp text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_c ufersin.customers%ROWTYPE;
  v_reset ufersin.customer_password_resets%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM ufersin.customers WHERE whatsapp = p_whatsapp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  SELECT * INTO v_reset FROM ufersin.customer_password_resets
    WHERE customer_id = v_c.id AND code = p_code AND used = false AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  RETURN jsonb_build_object('valid', true);
END;
$function$;

CREATE OR REPLACE FUNCTION ufersin.customer_reset_password(p_whatsapp text, p_code text, p_new_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_c ufersin.customers%ROWTYPE;
  v_reset ufersin.customer_password_resets%ROWTYPE;
BEGIN
  IF p_new_password !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'password must be exactly 4 digits';
  END IF;

  SELECT * INTO v_c FROM ufersin.customers WHERE whatsapp = p_whatsapp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  SELECT * INTO v_reset FROM ufersin.customer_password_resets
    WHERE customer_id = v_c.id AND code = p_code AND used = false AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  UPDATE ufersin.customers SET password_hash = crypt(p_new_password, gen_salt('bf')) WHERE id = v_c.id;
  UPDATE ufersin.customer_password_resets SET used = true WHERE id = v_reset.id;
  -- derruba sessões antigas — troca de senha invalida logins anteriores.
  DELETE FROM ufersin.sessions WHERE role = 'customer' AND subject_id = v_c.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION ufersin.customer_register(text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ufersin.customer_login(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ufersin.customer_me(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ufersin.customer_verify_reset_code(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ufersin.customer_reset_password(text, text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_customer_session_role.sql
-- ───────────────────────────────────────────────────────────────────
-- sessions_role_check só permitia admin/motoboy/vendedor — bloqueava TODO
-- login/cadastro de cliente com "new row for relation sessions violates
-- check constraint sessions_role_check". Adiciona 'customer' à lista.
ALTER TABLE ufersin.sessions DROP CONSTRAINT IF EXISTS sessions_role_check;
ALTER TABLE ufersin.sessions ADD CONSTRAINT sessions_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'motoboy'::text, 'vendedor'::text, 'customer'::text]));

-- ───────────────────────────────────────────────────────────────────
-- sunset_customer_pages.sql
-- ───────────────────────────────────────────────────────────────────
-- Suporte pras 3 páginas do menu do cliente logado: /cliente/favoritos,
-- /cliente/cupons, /cliente/historico.

CREATE TABLE IF NOT EXISTS ufersin.customer_favorites (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  customer_id text NOT NULL REFERENCES ufersin.customers(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES ufersin.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id)
);

CREATE OR REPLACE FUNCTION ufersin.customer_toggle_favorite(p_token text, p_product_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := ufersin._require_customer(p_token);
  v_existing text;
BEGIN
  SELECT id INTO v_existing FROM ufersin.customer_favorites WHERE customer_id = v_customer_id AND product_id = p_product_id;
  IF v_existing IS NOT NULL THEN
    DELETE FROM ufersin.customer_favorites WHERE id = v_existing;
    RETURN false;
  ELSE
    INSERT INTO ufersin.customer_favorites (id, customer_id, product_id) VALUES (gen_random_uuid()::text, v_customer_id, p_product_id);
    RETURN true;
  END IF;
END;
$function$;

-- Devolve os produtos favoritados + a lista "crua" de ids (pro front
-- pintar o coração nos cards sem precisar de uma chamada por produto).
CREATE OR REPLACE FUNCTION ufersin.customer_list_favorites(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := ufersin._require_customer(p_token);
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price,
      'quantity', p.quantity, 'image_url', p.image_url, 'category_id', p.category_id,
      'active', (p.active <> 0)
    ) ORDER BY f.created_at DESC)
    FROM ufersin.customer_favorites f JOIN ufersin.products p ON p.id = f.product_id
    WHERE f.customer_id = v_customer_id
  ), '[]'::jsonb);
END;
$function$;

-- Cupons do cliente logado, já separados em ativos/inativos/histórico —
-- ativo: ainda tem uso sobrando E cupom ligado/dentro da validade.
-- inativo: esgotado, desativado pelo admin ou expirado.
-- histórico: pedidos onde um código de cupom foi de fato aplicado
-- (orders.coupon_code), não é a mesma coisa que "inativo" — um cupom
-- pode estar em uso mas já ter sido aplicado em pedidos anteriores.
CREATE OR REPLACE FUNCTION ufersin.customer_list_coupons(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := ufersin._require_customer(p_token);
  v_whatsapp text;
  v_active jsonb;
  v_inactive jsonb;
  v_history jsonb;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM ufersin.customers WHERE id = v_customer_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'grant_id', g.id, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'granted_uses', g.granted_uses, 'used_count', g.used_count,
    'expires_at', c.expires_at, 'created_at', g.created_at
  ) ORDER BY g.created_at DESC), '[]'::jsonb)
  INTO v_active
  FROM ufersin.coupon_grants g JOIN ufersin.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = v_whatsapp
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now());

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'grant_id', g.id, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'granted_uses', g.granted_uses, 'used_count', g.used_count,
    'expires_at', c.expires_at, 'created_at', g.created_at
  ) ORDER BY g.created_at DESC), '[]'::jsonb)
  INTO v_inactive
  FROM ufersin.coupon_grants g JOIN ufersin.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = v_whatsapp
    AND NOT (
      g.used_count < g.granted_uses
      AND c.active <> 0
      AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now())
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'order_id', o.id, 'coupon_code', o.coupon_code, 'created_at', o.created_at,
    'total', o.total, 'discount_amount', o.discount_amount, 'shipping_discount', o.shipping_discount
  ) ORDER BY o.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM ufersin.orders o
  WHERE o.customer_whatsapp = v_whatsapp AND o.coupon_code IS NOT NULL;

  RETURN jsonb_build_object('active', v_active, 'inactive', v_inactive, 'history', v_history);
END;
$function$;

-- Histórico de pedidos do cliente logado — mesmo formato de
-- track_orders_by_phone (usado em /consultar), só que resolve o
-- whatsapp a partir da sessão em vez de pedir pra digitar de novo.
CREATE OR REPLACE FUNCTION ufersin.customer_list_orders(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := ufersin._require_customer(p_token);
  v_whatsapp text;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM ufersin.customers WHERE id = v_customer_id;
  RETURN ufersin.track_orders_by_phone(v_whatsapp);
END;
$function$;

GRANT EXECUTE ON FUNCTION ufersin.customer_toggle_favorite(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ufersin.customer_list_favorites(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ufersin.customer_list_coupons(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ufersin.customer_list_orders(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_coupon_claim.sql
-- ───────────────────────────────────────────────────────────────────
-- Feature "Resgatar cupom": cupons concedidos (coupon_grants) agora passam
-- por um passo de resgate (raspadinha) antes de virarem utilizáveis. Um
-- grant recém-concedido fica "pendente" (claimed_at IS NULL) até o cliente
-- raspar o cartão em /cliente/resgatarcupom -- só depois disso ele aparece
-- nas abas Ativos/Inativos de /cliente/cupons.

ALTER TABLE ufersin.coupon_grants ADD COLUMN IF NOT EXISTS claimed_at text;

-- O backfill "grants antigos viram já-resgatados" rodou UMA VEZ só, na
-- aplicação original desta migration -- por isso NÃO é um UPDATE aqui.
-- Reaplicar este arquivo (ex: pra atualizar uma das funções abaixo) tem
-- que ser seguro sem re-varrer a tabela; um UPDATE ...WHERE claimed_at IS
-- NULL rodado de novo pegaria também grants novos ainda pendentes de
-- resgate e os marcaria como resgatados por engano (foi exatamente isso
-- que aconteceu com os cupons de teste seedados entre a 1ª e a 2ª vez que
-- este arquivo rodou -- corrigido manualmente depois, ver histórico).

CREATE OR REPLACE FUNCTION ufersin.customer_list_coupons(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := ufersin._require_customer(p_token);
  v_whatsapp text;
  v_active jsonb;
  v_inactive jsonb;
  v_history jsonb;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM ufersin.customers WHERE id = v_customer_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'grant_id', g.id, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'granted_uses', g.granted_uses, 'used_count', g.used_count,
    'expires_at', c.expires_at, 'created_at', g.created_at
  ) ORDER BY g.created_at DESC), '[]'::jsonb)
  INTO v_active
  FROM ufersin.coupon_grants g JOIN ufersin.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = v_whatsapp
    AND g.claimed_at IS NOT NULL
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now());

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'grant_id', g.id, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'granted_uses', g.granted_uses, 'used_count', g.used_count,
    'expires_at', c.expires_at, 'created_at', g.created_at
  ) ORDER BY g.created_at DESC), '[]'::jsonb)
  INTO v_inactive
  FROM ufersin.coupon_grants g JOIN ufersin.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = v_whatsapp
    AND g.claimed_at IS NOT NULL
    AND NOT (
      g.used_count < g.granted_uses
      AND c.active <> 0
      AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now())
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'order_id', o.id, 'coupon_code', o.coupon_code, 'created_at', o.created_at,
    'total', o.total, 'discount_amount', o.discount_amount, 'shipping_discount', o.shipping_discount
  ) ORDER BY o.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM ufersin.orders o
  WHERE o.customer_whatsapp = v_whatsapp AND o.coupon_code IS NOT NULL;

  RETURN jsonb_build_object('active', v_active, 'inactive', v_inactive, 'history', v_history);
END;
$function$;

-- Só diz SE tem cupom pra resgatar -- não revela nada, é só o que o botão
-- "Resgatar cupom" precisa pra decidir entre abrir o toggle de "sem cupom"
-- (preet_7613) ou redirecionar pra /cliente/resgatarcupom.
CREATE OR REPLACE FUNCTION ufersin.customer_has_claimable_coupon(p_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := ufersin._require_customer(p_token);
  v_whatsapp text;
  v_found boolean;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM ufersin.customers WHERE id = v_customer_id;

  SELECT EXISTS (
    SELECT 1
    FROM ufersin.coupon_grants g JOIN ufersin.coupons c ON c.id = g.coupon_id
    WHERE g.customer_whatsapp = v_whatsapp
      AND g.claimed_at IS NULL
      AND g.used_count < g.granted_uses
      AND c.active <> 0
      AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now())
  ) INTO v_found;

  RETURN v_found;
END;
$function$;

-- Resgata (raspa) o cupom pendente mais antigo do cliente -- marca
-- claimed_at e só ENTÃO devolve os dados do cupom (nada é revelado antes
-- de raspar). FOR UPDATE SKIP LOCKED evita resgatar o mesmo grant duas
-- vezes em cliques duplos/concorrentes.
CREATE OR REPLACE FUNCTION ufersin.customer_claim_coupon(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := ufersin._require_customer(p_token);
  v_whatsapp text;
  v_grant_id text;
  v_result jsonb;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM ufersin.customers WHERE id = v_customer_id;

  SELECT g.id INTO v_grant_id
  FROM ufersin.coupon_grants g JOIN ufersin.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = v_whatsapp
    AND g.claimed_at IS NULL
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now())
  ORDER BY g.created_at ASC
  LIMIT 1
  FOR UPDATE OF g SKIP LOCKED;

  IF v_grant_id IS NULL THEN
    RAISE EXCEPTION 'no coupon available to claim';
  END IF;

  UPDATE ufersin.coupon_grants SET claimed_at = now()::text WHERE id = v_grant_id;

  -- description NUNCA vai pro cliente (nota interna do admin sobre o
  -- cupom) -- só os campos já expostos em customer_list_coupons.
  SELECT jsonb_build_object(
    'grant_id', g.id, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'granted_uses', g.granted_uses, 'used_count', g.used_count,
    'expires_at', c.expires_at
  )
  INTO v_result
  FROM ufersin.coupon_grants g JOIN ufersin.coupons c ON c.id = g.coupon_id
  WHERE g.id = v_grant_id;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION ufersin.customer_has_claimable_coupon(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ufersin.customer_claim_coupon(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_coupon_peek.sql
-- ───────────────────────────────────────────────────────────────────
-- Bug crítico: a página /cliente/resgatarcupom chamava customer_claim_coupon
-- (que MARCA claimed_at) assim que carregava, achando que "resgatar" era só
-- revelar o que já tinha sido concedido -- só que isso mutava o banco a
-- cada carregamento de página, não só quando o cliente efetivamente
-- terminava de raspar. Resultado: recarregar a página várias vezes
-- (testando) resgatou um cupom por recarregamento, sem raspar nenhum.
--
-- customer_peek_claimable_coupon faz a MESMA seleção de
-- customer_claim_coupon só que sem UPDATE nenhum -- é só pra pré-visualizar
-- os dados do próximo cupom pendente (pra desenhar o CouponTicket por
-- baixo do papel dourado) antes de raspar. customer_claim_coupon continua
-- existindo do jeito que já estava (marca claimed_at de UM grant por
-- chamada) -- só que agora só é chamada quando o cliente termina de
-- raspar de verdade, não no carregamento da página.
CREATE OR REPLACE FUNCTION ufersin.customer_peek_claimable_coupon(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ufersin', 'public', 'extensions'
AS $function$
DECLARE
  v_customer_id text := ufersin._require_customer(p_token);
  v_whatsapp text;
  v_result jsonb;
BEGIN
  SELECT whatsapp INTO v_whatsapp FROM ufersin.customers WHERE id = v_customer_id;

  SELECT jsonb_build_object(
    'grant_id', g.id, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'granted_uses', g.granted_uses, 'used_count', g.used_count,
    'expires_at', c.expires_at
  )
  INTO v_result
  FROM ufersin.coupon_grants g JOIN ufersin.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = v_whatsapp
    AND g.claimed_at IS NULL
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at = '' OR c.expires_at::timestamptz > now())
  ORDER BY g.created_at ASC
  LIMIT 1;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'no coupon available to claim';
  END IF;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION ufersin.customer_peek_claimable_coupon(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_list_customer_coupons_claimed.sql
-- ───────────────────────────────────────────────────────────────────
-- list_customer_coupons (usada no checkout: auto-detecta cupom exclusivo
-- pelo whatsapp digitado, e agora tambem alimenta o select de cupons no
-- checkout) tinha DOIS bugs:
-- 1. Referenciava c.allow_campaign_checkout, coluna que nao existe mais
--    (o nome real e allow_promotion_checkout) -- a funcao inteira dava
--    erro em TODA chamada, silenciosamente engolido pelo .catch(() => {})
--    no Checkout.tsx. O "auto-detectar cupom exclusivo pelo whatsapp"
--    nunca funcionou de verdade em producao.
-- 2. Nao filtrava por claimed_at -- um cupom concedido mas ainda NAO
--    resgatado na raspadinha (/cliente/resgatarcupom) ja apareceria como
--    disponivel pra aplicar direto no checkout, furando a regra de que só
--    conta como resgatado depois de efetivamente raspar (ver
--    sunset_coupon_claim.sql / sunset_coupon_peek.sql).
CREATE OR REPLACE FUNCTION ufersin.list_customer_coupons(p_customer_whatsapp text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ufersin', 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', c.code, 'kind', c.kind, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'shipping_discount_type', c.shipping_discount_type, 'shipping_discount_value', c.shipping_discount_value,
    'allow_promotion_checkout', (c.allow_promotion_checkout <> 0),
    'combinable_with_public', (c.combinable_with_public <> 0),
    'product_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pd.product_id, 'discount_type', pd.discount_type, 'discount_value', pd.discount_value
      )) FROM ufersin.coupon_product_discounts pd WHERE pd.coupon_id = c.id
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  FROM ufersin.coupon_grants g
  JOIN ufersin.coupons c ON c.id = g.coupon_id
  WHERE g.customer_whatsapp = p_customer_whatsapp
    AND g.claimed_at IS NOT NULL
    AND g.used_count < g.granted_uses
    AND c.active <> 0
    AND (c.expires_at IS NULL OR c.expires_at::timestamptz > now())
    AND (c.max_uses IS NULL OR c.used_count < c.max_uses);
$function$;

-- ───────────────────────────────────────────────────────────────────
-- sunset_carousel_style.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Estilo do carrossel de banners/promoções da landing, escolhido pelo
-- admin em /admin/promocoes: 'atual' (um card só, troca de conteúdo
-- sozinho) ou 'cards' (cada card fica alguns segundos na tela e desliza
-- pra esquerda pro próximo). Puramente visual, não afeta os dados de
-- promoção/hero em si.
-- =====================================================

ALTER TABLE ufersin.site_settings
  ADD COLUMN IF NOT EXISTS carousel_style text NOT NULL DEFAULT 'atual';

CREATE OR REPLACE FUNCTION ufersin.admin_update_carousel_style(p_token text, p_style text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_style NOT IN ('atual', 'cards') THEN
    RAISE EXCEPTION 'invalid carousel_style';
  END IF;
  UPDATE ufersin.site_settings SET carousel_style = p_style WHERE id = 1;
  RETURN jsonb_build_object('carousel_style', p_style);
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_update_carousel_style(text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_page_decorations.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Layout por página de cliente (/catalogo, landing, /cliente/favoritos,
-- /cliente/cupons, /cliente/historico): imagem de fundo + elementos
-- decorativos de fumaça/fogo posicionados pelo admin em
-- /admin/layout-cliente. elements é um array jsonb livre — cada item tem
-- id/type/x/y/width/height/blur/opacity/speed/count (ver PageDecoration
-- em frontend/src/lib/types.ts).
-- =====================================================

CREATE TABLE IF NOT EXISTS ufersin.page_decorations (
  page_key text PRIMARY KEY,
  background_image_url text,
  elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (page_key IN ('catalogo', 'landing', 'favoritos', 'cupons', 'historico'))
);

ALTER TABLE ufersin.page_decorations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON ufersin.page_decorations TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_page_decorations" ON ufersin.page_decorations;
CREATE POLICY "sunset_anon_select_page_decorations" ON ufersin.page_decorations
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION ufersin.admin_save_page_decoration(
  p_token text,
  p_page_key text,
  p_background_image_url text,
  p_elements jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_page_key NOT IN ('catalogo', 'landing', 'favoritos', 'cupons', 'historico') THEN
    RAISE EXCEPTION 'invalid page_key';
  END IF;
  INSERT INTO ufersin.page_decorations (page_key, background_image_url, elements, updated_at)
  VALUES (p_page_key, p_background_image_url, COALESCE(p_elements, '[]'::jsonb), now())
  ON CONFLICT (page_key) DO UPDATE SET
    background_image_url = EXCLUDED.background_image_url,
    elements = EXCLUDED.elements,
    updated_at = now();
  RETURN jsonb_build_object('page_key', p_page_key, 'background_image_url', p_background_image_url, 'elements', COALESCE(p_elements, '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_save_page_decoration(text, text, text, jsonb) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────
-- sunset_page_decorations_cart_icon.sql
-- ───────────────────────────────────────────────────────────────────
-- =====================================================
-- Adiciona 'cart_icon' como page_key válido em ufersin.page_decorations —
-- um alvo especial (não é uma rota) que representa o botão flutuante do
-- carrinho (CartFab), renderizado globalmente em toda tela que o usa. O
-- admin edita em /admin/layout-cliente, aba "Ícone do carrinho".
-- =====================================================

ALTER TABLE ufersin.page_decorations DROP CONSTRAINT IF EXISTS page_decorations_page_key_check;
ALTER TABLE ufersin.page_decorations
  ADD CONSTRAINT page_decorations_page_key_check
  CHECK (page_key IN ('catalogo', 'landing', 'favoritos', 'cupons', 'historico', 'cart_icon'));

CREATE OR REPLACE FUNCTION ufersin.admin_save_page_decoration(
  p_token text,
  p_page_key text,
  p_background_image_url text,
  p_elements jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ufersin, public, extensions AS $$
BEGIN
  PERFORM ufersin._require_admin(p_token);
  IF p_page_key NOT IN ('catalogo', 'landing', 'favoritos', 'cupons', 'historico', 'cart_icon') THEN
    RAISE EXCEPTION 'invalid page_key';
  END IF;
  INSERT INTO ufersin.page_decorations (page_key, background_image_url, elements, updated_at)
  VALUES (p_page_key, p_background_image_url, COALESCE(p_elements, '[]'::jsonb), now())
  ON CONFLICT (page_key) DO UPDATE SET
    background_image_url = EXCLUDED.background_image_url,
    elements = EXCLUDED.elements,
    updated_at = now();
  RETURN jsonb_build_object('page_key', p_page_key, 'background_image_url', p_background_image_url, 'elements', COALESCE(p_elements, '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION ufersin.admin_save_page_decoration(text, text, text, jsonb) TO anon, authenticated;

