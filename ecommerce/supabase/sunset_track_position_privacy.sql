-- =====================================================
-- Sunset Tabas — track_delivery_position só revela a posição do motoboy
-- pro pedido que é REALMENTE a parada atual da corrida (current_index).
-- Antes a posição vazava pra qualquer pedido do lote, mesmo enquanto o
-- motoboy ainda tava terminando outra entrega antes — exatamente o que o
-- Uber/99 evita: o cliente só vê o motoboy quando ele já está a caminho
-- DELE, não enquanto entrega pra outra pessoa do mesmo lote.
--
-- 100% em Supabase, sem dependência de deploy do Rust.
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.track_delivery_position(p_order_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
DECLARE
  v_order sunset.orders%ROWTYPE;
  v_run sunset.motoboy_runs%ROWTYPE;
  v_is_next boolean;
BEGIN
  SELECT * INTO v_order FROM sunset.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_order.status <> 'em_rota_de_entrega' OR v_order.motoboy_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_run FROM sunset.motoboy_runs
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
GRANT EXECUTE ON FUNCTION sunset.track_delivery_position(text) TO anon, authenticated;
