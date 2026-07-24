-- =====================================================
-- Corrige bug real do pdv_create_sale: orders.customer_id é NOT NULL, mas
-- a função deixava null quando o cliente do balcão não informa WhatsApp
-- (opcional de propósito) — toda venda assim vai pra um cliente-placeholder
-- fixo e reutilizado ("Cliente balcão"), em vez de inventar um novo
-- registro por venda.
--
-- De quebra, habilita RLS em sunset.vendedores (esqueci no script
-- original) — sem política nenhuma, igual sunset.sessions/motoboys: só
-- alcançável via função SECURITY DEFINER, nunca direto pelo cliente.
-- =====================================================

ALTER TABLE sunset.vendedores ENABLE ROW LEVEL SECURITY;

INSERT INTO sunset.customers (id, name, whatsapp)
VALUES ('pdv-balcao-anonimo', 'Cliente balcão', 'pdv-balcao-anonimo')
ON CONFLICT (id) DO NOTHING;

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
  ELSE
    v_customer_id := 'pdv-balcao-anonimo';
  END IF;

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
