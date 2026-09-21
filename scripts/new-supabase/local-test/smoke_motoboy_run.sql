-- Smoke test do ciclo da corrida do motoboy (iniciar -> ativa -> posição -> concluir). Cria e apaga os próprios dados.
-- Serve no teste local E no projeto novo, depois de apply pre + backends + apply post:
--   psql "<url>" -f scripts/new-supabase/local-test/smoke_motoboy_run.sql
\set ON_ERROR_STOP on
DO $$
DECLARE t text; m text; o text := gen_random_uuid()::text; c text := gen_random_uuid()::text; tok text := 'smoke-token-1'; r jsonb;
BEGIN
  SELECT id INTO t FROM loja.tenants ORDER BY created_at LIMIT 1;
  INSERT INTO loja.motoboys (id, tenant_id, name, phone, password_hash, active) VALUES (gen_random_uuid()::text, t, 'Smoke Motoboy', '5511999990000', 'x', 1) RETURNING id INTO m;
  INSERT INTO loja.shipping_settings (tenant_id, price_per_km, store_lat, store_lng) VALUES (t, 1.5, -7.1746, -34.8576) ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO loja.customers (id, tenant_id, name, whatsapp) VALUES (c, t, 'SMOKE Cliente', '5511988887777');
  INSERT INTO loja.orders (id, tenant_id, customer_id, customer_name, customer_whatsapp, delivery_type, status, payment_method, payment_status, shipping_price, total, customer_lat, customer_lng, created_at, updated_at)
    VALUES (o, t, c, 'SMOKE Cliente', '5511988887777', 'entrega', 'pedido_pronto', 'dinheiro', 'pendente', 5, 25, -7.18, -34.86, now()::text, now()::text);
  INSERT INTO resolutoo.sessions (token, role, subject_id) VALUES (tok, 'motoboy', m);

  r := resolutoo.motoboy_start_run(tok, ARRAY[o]);
  RAISE NOTICE '1 start_run  -> run=% pedidos=%', r->>'status', jsonb_array_length(r->'orders');
  r := resolutoo.motoboy_active_run(tok);
  RAISE NOTICE '2 active_run -> pedido=%', r->'orders'->0->>'customer_name';
  PERFORM resolutoo.motoboy_update_run_position(tok, -7.175, -34.857, 90);
  RAISE NOTICE '3 update_pos -> ok';
  r := resolutoo.motoboy_complete_current_delivery(tok, true);
  RAISE NOTICE '4 complete   -> run=%', r->>'status';
  RAISE NOTICE '5 loja.orders -> %', (SELECT status || ' / ' || payment_status FROM loja.orders WHERE id = o);

  DELETE FROM resolutoo.motoboy_runs WHERE motoboy_id = m;
  DELETE FROM loja.orders WHERE id = o;
  DELETE FROM loja.customers WHERE id = c;
  DELETE FROM resolutoo.sessions WHERE token = tok;
  DELETE FROM loja.motoboys WHERE id = m;
END $$;
