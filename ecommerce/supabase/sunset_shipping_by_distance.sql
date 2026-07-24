-- =====================================================
-- Sunset Tabas — frete calculado por DISTÂNCIA real (loja → cliente)
-- em vez de tabela fixa por bairro. Substitui inteiramente
-- neighborhood_shipping_rates.
--
-- store_lat/store_lng são um ponto de referência dentro do bairro
-- José Américo de Almeida (o endereço exato da loja não está
-- mapeado no OpenStreetMap) — dá pra corrigir depois rodando um
-- UPDATE manual em sunset.shipping_settings se você tiver a
-- coordenada exata (ex.: soltando o pino no Google Maps e copiando
-- lat/lng).
--
-- Execute DEPOIS que o backend Rust já tiver rodado a migration
-- 0003_drop_neighborhood_shipping_rates.sql (senão o DROP abaixo já
-- resolve isso também, tanto faz a ordem dessa vez).
-- =====================================================

DROP TABLE IF EXISTS sunset.neighborhood_shipping_rates CASCADE;
DROP FUNCTION IF EXISTS sunset.admin_list_shipping_rates(text);
DROP FUNCTION IF EXISTS sunset.admin_update_shipping_rate(text, text, double precision);

CREATE TABLE IF NOT EXISTS sunset.shipping_settings (
  id int PRIMARY KEY DEFAULT 1,
  price_per_km double precision NOT NULL DEFAULT 1.5,
  store_lat double precision NOT NULL,
  store_lng double precision NOT NULL,
  CHECK (id = 1)
);

INSERT INTO sunset.shipping_settings (id, price_per_km, store_lat, store_lng)
VALUES (1, 1.5, -7.1746, -34.8576)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE sunset.shipping_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON sunset.shipping_settings TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_shipping_settings" ON sunset.shipping_settings;
CREATE POLICY "sunset_anon_select_shipping_settings" ON sunset.shipping_settings
  FOR SELECT TO anon, authenticated USING (true);

-- Distância em linha reta (Haversine), em km. IMMUTABLE = calculável sem
-- tocar o banco, só matemática — mesma fórmula usada no frontend
-- (frontend/src/lib/geo/rotas.ts) pra estimativa ao vivo no checkout.
CREATE OR REPLACE FUNCTION sunset._distance_km(
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
CREATE OR REPLACE FUNCTION sunset.estimate_shipping(p_lat double precision, p_lng double precision)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
DECLARE
  v_settings sunset.shipping_settings%ROWTYPE;
  v_km double precision;
BEGIN
  SELECT * INTO v_settings FROM sunset.shipping_settings WHERE id = 1;
  v_km := sunset._distance_km(v_settings.store_lat, v_settings.store_lng, p_lat, p_lng);
  RETURN jsonb_build_object(
    'km', round(v_km::numeric, 2),
    'price', round((v_km * v_settings.price_per_km)::numeric, 2)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.estimate_shipping(double precision, double precision) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_shipping_settings(p_token text, p_price_per_km double precision)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_price_per_km IS NULL OR p_price_per_km < 0 THEN
    RAISE EXCEPTION 'price_per_km must be a non-negative number';
  END IF;
  UPDATE sunset.shipping_settings SET price_per_km = p_price_per_km WHERE id = 1;
  RETURN jsonb_build_object('price_per_km', p_price_per_km);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_shipping_settings(text, double precision) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- create_order — troca o lookup por bairro pelo cálculo por distância.
-- Precisa dropar a assinatura antiga (7 parâmetros) já que a nova tem 2 a
-- mais (lat/lng do cliente) — CREATE OR REPLACE não troca lista de
-- parâmetros, só sobrescreve se for idêntica.
-- ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS sunset.create_order(text, text, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION sunset.create_order(
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
  v_settings    sunset.shipping_settings%ROWTYPE;
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

  -- frete: só pra entrega, calculado por distância real (nunca confia no
  -- valor vindo do cliente, só nas coordenadas — o preço é recalculado
  -- aqui do zero)
  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM sunset.shipping_settings WHERE id = 1;
    v_km := sunset._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    v_shipping := round((v_km * v_settings.price_per_km)::numeric, 2);
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
    shipping_price, total, customer_lat, customer_lng
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_payment_method, 'pendente', 'pendente',
    v_shipping, v_total, p_customer_lat, p_customer_lng
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

GRANT EXECUTE ON FUNCTION sunset.create_order(text,text,text,text,text,text,jsonb,double precision,double precision) TO anon, authenticated;
