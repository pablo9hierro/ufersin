-- 30_motoboy_run_fixes.sql -- roda DEPOIS que o backend do ecommerce subiu (precisa de loja.orders / loja.motoboys).
-- As RPCs legadas de corrida do motoboy liam resolutoo.orders (tabela legada VAZIA); os pedidos reais vivem em loja.*.
-- Estas são as versões corrigidas (as mesmas aplicadas manualmente em produção em 19/09/2026).
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION resolutoo._optimize_route(p_order_ids text[])
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = resolutoo, public, extensions AS $$
DECLARE
  v_tenant_id text;
  v_store_lat double precision;
  v_store_lng double precision;
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
  SELECT tenant_id INTO v_tenant_id FROM loja.orders WHERE id = p_order_ids[1];
  SELECT store_lat, store_lng INTO v_store_lat, v_store_lng FROM loja.shipping_settings WHERE tenant_id = v_tenant_id;
  v_cur_lat := v_store_lat;
  v_cur_lng := v_store_lng;

  WHILE array_length(v_remaining, 1) > 0 LOOP
    v_best_id := NULL;
    v_best_dist := NULL;
    FOREACH v_id IN ARRAY v_remaining LOOP
      SELECT customer_lat, customer_lng INTO v_lat, v_lng FROM loja.orders WHERE id = v_id;
      v_dist := resolutoo._distance_km(v_cur_lat, v_cur_lng, v_lat, v_lng);
      IF v_best_dist IS NULL OR v_dist < v_best_dist THEN
        v_best_dist := v_dist;
        v_best_id := v_id;
      END IF;
    END LOOP;
    v_result := v_result || v_best_id;
    SELECT customer_lat, customer_lng INTO v_cur_lat, v_cur_lng FROM loja.orders WHERE id = v_best_id;
    v_remaining := array_remove(v_remaining, v_best_id);
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION resolutoo.motoboy_start_run(
  p_token text,
  p_order_ids text[],
  p_precomputed_order text[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = resolutoo, public, extensions AS $$
DECLARE
  v_motoboy_id text := resolutoo._require_motoboy(p_token);
  v_run_id text := gen_random_uuid()::text;
  v_sequence text[];
  v_order loja.orders%ROWTYPE;
  v_distinct_ids text[];
  v_found_count int;
BEGIN
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'select at least one order to start a run';
  END IF;
  IF EXISTS (SELECT 1 FROM resolutoo.motoboy_runs WHERE motoboy_id = v_motoboy_id AND status = 'ativo') THEN
    RAISE EXCEPTION 'you already have an active run -- finish it before starting another';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_distinct_ids FROM unnest(p_order_ids) AS x;
  SELECT COUNT(*) INTO v_found_count FROM loja.orders WHERE id = ANY(v_distinct_ids);
  IF v_found_count <> array_length(v_distinct_ids, 1) THEN
    RAISE EXCEPTION 'one or more order ids do not exist';
  END IF;

  FOR v_order IN SELECT * FROM loja.orders WHERE id = ANY(v_distinct_ids) LOOP
    IF v_order.delivery_type <> 'entrega' OR v_order.status <> 'pedido_pronto' OR v_order.motoboy_id IS NOT NULL THEN
      RAISE EXCEPTION 'order % is not available to start a delivery run', v_order.id;
    END IF;
  END LOOP;

  IF p_precomputed_order IS NOT NULL THEN
    IF (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(p_precomputed_order) AS x)
       IS DISTINCT FROM (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(v_distinct_ids) AS x) THEN
      RAISE EXCEPTION 'precomputed order does not match the given order ids';
    END IF;
    v_sequence := p_precomputed_order;
  ELSE
    v_sequence := resolutoo._optimize_route(v_distinct_ids);
  END IF;

  UPDATE loja.orders
    SET motoboy_id = v_motoboy_id, status = 'em_rota_de_entrega',
        updated_at = now()::text
    WHERE id = ANY(p_order_ids);

  INSERT INTO resolutoo.motoboy_runs (id, motoboy_id, order_ids)
    VALUES (v_run_id, v_motoboy_id, v_sequence);

  RETURN resolutoo._run_json(v_run_id);
END;
$$;

CREATE OR REPLACE FUNCTION resolutoo.motoboy_complete_current_delivery(
  p_token text,
  p_payment_confirmed boolean DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = resolutoo, public, extensions AS $$
DECLARE
  v_motoboy_id text := resolutoo._require_motoboy(p_token);
  v_run resolutoo.motoboy_runs%ROWTYPE;
  v_order_id text;
  v_order loja.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM resolutoo.motoboy_runs WHERE motoboy_id = v_motoboy_id AND status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active run';
  END IF;

  v_order_id := v_run.order_ids[v_run.current_index + 1];
  SELECT * INTO v_order FROM loja.orders WHERE id = v_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', v_order_id;
  END IF;

  PERFORM resolutoo._confirm_payment_if_needed(v_order.payment_method, v_order.payment_status, p_payment_confirmed);

  UPDATE loja.orders SET
    status = 'concluido',
    payment_status = CASE WHEN v_order.payment_method = 'pix' THEN payment_status ELSE 'pago' END,
    updated_at = now()::text
  WHERE id = v_order_id;

  IF v_run.current_index + 1 >= array_length(v_run.order_ids, 1) THEN
    UPDATE resolutoo.motoboy_runs SET status = 'concluido', finished_at = now(), updated_at = now() WHERE id = v_run.id;
  ELSE
    UPDATE resolutoo.motoboy_runs SET current_index = current_index + 1, updated_at = now() WHERE id = v_run.id;
  END IF;

  RETURN resolutoo._run_json(v_run.id);
END;
$$;

GRANT EXECUTE ON FUNCTION resolutoo.motoboy_start_run(text, text[], text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION resolutoo.motoboy_complete_current_delivery(text, boolean) TO anon, authenticated;

-- A FK de motoboy_runs apontava pra resolutoo.motoboys (legada, vazia); o motoboy real vive em loja.motoboys.
ALTER TABLE resolutoo.motoboy_runs DROP CONSTRAINT IF EXISTS motoboy_runs_motoboy_id_fkey;
ALTER TABLE resolutoo.motoboy_runs ADD CONSTRAINT motoboy_runs_motoboy_id_fkey
  FOREIGN KEY (motoboy_id) REFERENCES loja.motoboys(id) ON DELETE CASCADE;
