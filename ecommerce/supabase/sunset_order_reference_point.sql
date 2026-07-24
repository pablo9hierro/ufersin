-- =====================================================
-- Sunset Tabas — adiciona "ponto de referência" (número da casa,
-- condomínio, observações de entrega) ao pedido. Complementa
-- customer_lat/customer_lng: a coordenada localiza o endereço no mapa,
-- o ponto de referência é o texto livre que o motoboy lê pra achar a
-- porta certa.
--
-- IMPORTANTE: rode isso DEPOIS que o backend Rust no Railway já tiver
-- redeployado com a migration 0004_order_reference_point.sql (cria a
-- coluna reference_point em sunset.orders). Se rodar antes, vai dar
-- erro "column does not exist".
-- =====================================================

-- get_order alimenta admin_list_orders, motoboy_list_orders e
-- track_orders_by_phone (todos chamam essa função por pedido) — uma
-- única troca aqui já propaga o campo novo pra tudo.
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
      FROM sunset.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM sunset.orders o
  WHERE o.id = p_order_id;
$$;

GRANT EXECUTE ON FUNCTION sunset.get_order(text) TO anon, authenticated;

-- create_order — troca a assinatura de 9 pra 10 parâmetros (novo
-- p_reference_point no fim) — precisa dropar a antiga primeiro.
DROP FUNCTION IF EXISTS sunset.create_order(text, text, text, text, text, text, jsonb, double precision, double precision);

CREATE OR REPLACE FUNCTION sunset.create_order(
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
    neighborhood, address, reference_point, payment_method, payment_status, status,
    shipping_price, total, customer_lat, customer_lng
  ) VALUES (
    v_order_id, v_customer_id, p_customer_name, p_customer_whatsapp, p_delivery_type,
    p_neighborhood, p_address, p_reference_point, p_payment_method, 'pendente', 'pendente',
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

GRANT EXECUTE ON FUNCTION sunset.create_order(text,text,text,text,text,text,jsonb,double precision,double precision,text) TO anon, authenticated;
