-- =====================================================
-- Sunset Tabas — contagem de pedidos por status pro motoboy (mostra
-- o número em cada aba da fila, tipo "Pedido pronto (3)"). Espelha
-- exatamente os mesmos WHERE de sunset.motoboy_list_orders, só que
-- devolve COUNT em vez da lista inteira — mais leve, principalmente
-- pra "concluído" que só cresce com o tempo.
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.motoboy_order_counts(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
BEGIN
  RETURN jsonb_build_object(
    'pedido_pronto', (
      SELECT COUNT(*) FROM sunset.orders
      WHERE delivery_type = 'entrega' AND status = 'pedido_pronto' AND motoboy_id IS NULL
    ),
    'aguardando_localizacao', (
      SELECT COUNT(*) FROM sunset.orders
      WHERE delivery_type = 'entrega' AND status = 'aguardando_localizacao' AND motoboy_id = v_motoboy_id
    ),
    'em_rota_de_entrega', (
      SELECT COUNT(*) FROM sunset.orders
      WHERE delivery_type = 'entrega' AND status IN ('em_rota_de_entrega', 'entregue') AND motoboy_id = v_motoboy_id
    ),
    'concluido', (
      SELECT COUNT(*) FROM sunset.orders
      WHERE delivery_type = 'entrega' AND status = 'concluido' AND motoboy_id = v_motoboy_id
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION sunset.motoboy_order_counts(text) TO anon, authenticated;
