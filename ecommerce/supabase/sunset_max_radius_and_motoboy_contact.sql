-- =====================================================
-- Sunset Tabas — raio máximo de entrega + contato do motoboy no /consultar
--
-- 1) admin define uma distância máxima (km) de entrega em sunset.shipping_settings.
--    max_km NULL = sem limite (comportamento atual, compatível).
--    Enforçado tanto em estimate_shipping (avisa o cliente antes de confirmar
--    a localização) quanto em create_order (nunca confia só no front — barra
--    de verdade o pedido se a distância exceder o limite).
-- 2) get_order passa a incluir o nome/whatsapp do motoboy responsável, pra
--    o cliente conseguir falar com ele direto em /consultar quando o pedido
--    já está em_rota_de_entrega.
-- =====================================================

ALTER TABLE sunset.shipping_settings ADD COLUMN IF NOT EXISTS max_km double precision;

-- estimate_shipping — mesma assinatura, só passa a devolver max_km/within_range
-- junto pro frontend avisar o cliente antes de ele confirmar a localização.
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
    'price', round((v_km * v_settings.price_per_km)::numeric, 2),
    'max_km', v_settings.max_km,
    'within_range', (v_settings.max_km IS NULL OR v_km <= v_settings.max_km)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.estimate_shipping(double precision, double precision) TO anon, authenticated;

-- admin_update_shipping_settings ganhou um parâmetro novo (p_max_km) — troca
-- a lista de argumentos, então precisa dropar a assinatura antiga de 2
-- parâmetros antes (CREATE OR REPLACE não troca assinatura, só sobrescreve
-- se for idêntica).
DROP FUNCTION IF EXISTS sunset.admin_update_shipping_settings(text, double precision);

CREATE OR REPLACE FUNCTION sunset.admin_update_shipping_settings(
  p_token text,
  p_price_per_km double precision,
  p_max_km double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_price_per_km IS NULL OR p_price_per_km < 0 THEN
    RAISE EXCEPTION 'price_per_km must be a non-negative number';
  END IF;
  IF p_max_km IS NOT NULL AND p_max_km <= 0 THEN
    RAISE EXCEPTION 'max_km must be a positive number';
  END IF;
  UPDATE sunset.shipping_settings SET price_per_km = p_price_per_km, max_km = p_max_km WHERE id = 1;
  RETURN jsonb_build_object('price_per_km', p_price_per_km, 'max_km', p_max_km);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_shipping_settings(text, double precision, double precision) TO anon, authenticated;

-- create_order — mesma assinatura de sunset_order_reference_point.sql, só
-- adiciona a checagem do raio máximo antes de gravar o pedido. Nunca confia
-- no front: recalcula a distância aqui de novo, igual já fazia pro preço.
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
  -- aqui do zero). Também barra o pedido se exceder o raio máximo
  -- configurado pelo admin.
  IF p_delivery_type = 'entrega' THEN
    SELECT * INTO v_settings FROM sunset.shipping_settings WHERE id = 1;
    v_km := sunset._distance_km(v_settings.store_lat, v_settings.store_lng, p_customer_lat, p_customer_lng);
    IF v_settings.max_km IS NOT NULL AND v_km > v_settings.max_km THEN
      RAISE EXCEPTION 'delivery address is % km away, which exceeds the maximum delivery range of % km', round(v_km::numeric, 1), v_settings.max_km;
    END IF;
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

-- get_order — mesma assinatura, só passa a trazer nome/whatsapp do motoboy
-- responsável (LEFT JOIN, fica null se ainda não tiver motoboy atribuído)
-- pro botão "Falar com motoboy" em /consultar.
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
      FROM sunset.order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM sunset.orders o
  LEFT JOIN sunset.motoboys m ON m.id = o.motoboy_id
  WHERE o.id = p_order_id;
$$;
