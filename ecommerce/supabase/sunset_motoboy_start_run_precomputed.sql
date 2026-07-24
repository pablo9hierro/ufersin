-- =====================================================
-- sunset.motoboy_start_run ganha um 3º parâmetro opcional: a ordem de
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

DROP FUNCTION IF EXISTS sunset.motoboy_start_run(text, text[]);

CREATE OR REPLACE FUNCTION sunset.motoboy_start_run(
  p_token text,
  p_order_ids text[],
  p_precomputed_order text[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
  v_run_id text := gen_random_uuid()::text;
  v_sequence text[];
  v_order sunset.orders%ROWTYPE;
  v_distinct_ids text[];
  v_found_count int;
BEGIN
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'select at least one order to start a run';
  END IF;
  IF EXISTS (SELECT 1 FROM sunset.motoboy_runs WHERE motoboy_id = v_motoboy_id AND status = 'ativo') THEN
    RAISE EXCEPTION 'you already have an active run — finish it before starting another';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_distinct_ids FROM unnest(p_order_ids) AS x;
  SELECT COUNT(*) INTO v_found_count FROM sunset.orders WHERE id = ANY(v_distinct_ids);
  IF v_found_count <> array_length(v_distinct_ids, 1) THEN
    RAISE EXCEPTION 'one or more order ids do not exist';
  END IF;

  FOR v_order IN SELECT * FROM sunset.orders WHERE id = ANY(v_distinct_ids) LOOP
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
    v_sequence := sunset._optimize_route(v_distinct_ids);
  END IF;

  UPDATE sunset.orders
    SET motoboy_id = v_motoboy_id, status = 'em_rota_de_entrega',
        delivery_started_at = now(), updated_at = now()::text
    WHERE id = ANY(p_order_ids);

  INSERT INTO sunset.motoboy_runs (id, motoboy_id, order_ids)
    VALUES (v_run_id, v_motoboy_id, v_sequence);

  RETURN sunset._run_json(v_run_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_start_run(text, text[], text[]) TO anon, authenticated;
