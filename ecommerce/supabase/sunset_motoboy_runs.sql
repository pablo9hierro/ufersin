-- =====================================================
-- Sunset Tabas — corrida do motoboy (revolução da fila + rastreamento
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
-- (usa sunset._motoboy_pending e sunset.motoboy_settlements) e depois que
-- a coluna sunset.orders.reference_point já existir (migration 0004 do
-- Rust já rodada — se você já rodou sunset_order_reference_point.sql com
-- sucesso, está tudo certo).
-- =====================================================

ALTER TABLE sunset.orders ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz;
ALTER TABLE sunset.orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE TABLE IF NOT EXISTS sunset.motoboy_runs (
  id text PRIMARY KEY,
  motoboy_id text NOT NULL REFERENCES sunset.motoboys(id) ON DELETE CASCADE,
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
  ON sunset.motoboy_runs (motoboy_id) WHERE status = 'ativo';

ALTER TABLE sunset.motoboy_runs ENABLE ROW LEVEL SECURITY;
-- Sem policies de propósito — só acessível via RPC SECURITY DEFINER.

-- ─────────────────────────────────────────────────────
-- Otimização de rota: nearest-neighbor guloso a partir da loja. Simples
-- e O(n²), mais que suficiente pro tamanho real de um lote de entregas.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._optimize_route(p_order_ids text[])
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
DECLARE
  v_settings  sunset.shipping_settings%ROWTYPE;
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
  SELECT * INTO v_settings FROM sunset.shipping_settings WHERE id = 1;
  v_cur_lat := v_settings.store_lat;
  v_cur_lng := v_settings.store_lng;

  WHILE array_length(v_remaining, 1) > 0 LOOP
    v_best_id := NULL;
    v_best_dist := NULL;
    FOREACH v_id IN ARRAY v_remaining LOOP
      SELECT customer_lat, customer_lng INTO v_lat, v_lng FROM sunset.orders WHERE id = v_id;
      v_dist := sunset._distance_km(v_cur_lat, v_cur_lng, v_lat, v_lng);
      IF v_best_dist IS NULL OR v_dist < v_best_dist THEN
        v_best_dist := v_dist;
        v_best_id := v_id;
      END IF;
    END LOOP;
    v_result := v_result || v_best_id;
    SELECT customer_lat, customer_lng INTO v_cur_lat, v_cur_lng FROM sunset.orders WHERE id = v_best_id;
    v_remaining := array_remove(v_remaining, v_best_id);
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION sunset._run_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
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
      SELECT jsonb_agg(sunset.get_order(oid))
      FROM unnest(r.order_ids) AS oid
    ), '[]'::jsonb)
  )
  FROM sunset.motoboy_runs r WHERE r.id = p_id;
$$;

-- ─────────────────────────────────────────────────────
-- RPCs do motoboy
-- ─────────────────────────────────────────────────────

-- Reidrata a corrida ativa (ou null) — chamado ao abrir qualquer página
-- do dashboard do motoboy, é isso que garante que a corrida nunca "some"
-- se ele sair da tela de mapa ou recarregar.
CREATE OR REPLACE FUNCTION sunset.motoboy_active_run(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
  v_run_id text;
BEGIN
  SELECT id INTO v_run_id FROM sunset.motoboy_runs WHERE motoboy_id = v_motoboy_id AND status = 'ativo';
  IF v_run_id IS NULL THEN RETURN NULL; END IF;
  RETURN sunset._run_json(v_run_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_active_run(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.motoboy_start_run(p_token text, p_order_ids text[])
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

  v_sequence := sunset._optimize_route(v_distinct_ids);

  UPDATE sunset.orders
    SET motoboy_id = v_motoboy_id, status = 'em_rota_de_entrega',
        delivery_started_at = now(), updated_at = now()::text
    WHERE id = ANY(p_order_ids);

  INSERT INTO sunset.motoboy_runs (id, motoboy_id, order_ids)
    VALUES (v_run_id, v_motoboy_id, v_sequence);

  RETURN sunset._run_json(v_run_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_start_run(text, text[]) TO anon, authenticated;

-- Chamado com frequência (a cada poucos segundos) enquanto o motoboy
-- navega — atualiza a posição ao vivo que o /consultar do cliente lê.
CREATE OR REPLACE FUNCTION sunset.motoboy_update_run_position(
  p_token text, p_lat double precision, p_lng double precision, p_heading double precision DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
BEGIN
  UPDATE sunset.motoboy_runs
    SET motoboy_lat = p_lat, motoboy_lng = p_lng, motoboy_heading = p_heading, updated_at = now()
    WHERE motoboy_id = v_motoboy_id AND status = 'ativo';
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_update_run_position(text, double precision, double precision, double precision) TO anon, authenticated;

-- Conclui a entrega ATUAL da corrida (current_index) e avança pra
-- próxima; quando acaba a sequência, fecha a corrida inteira. Mesma
-- regra de confirmação de pagamento que já existia (pix não precisa,
-- cartão/dinheiro precisa do popup "recebeu?").
CREATE OR REPLACE FUNCTION sunset.motoboy_complete_current_delivery(p_token text, p_payment_confirmed boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
  v_run sunset.motoboy_runs%ROWTYPE;
  v_order_id text;
  v_order sunset.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM sunset.motoboy_runs WHERE motoboy_id = v_motoboy_id AND status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active run';
  END IF;

  v_order_id := v_run.order_ids[v_run.current_index + 1]; -- Postgres arrays são 1-indexados
  SELECT * INTO v_order FROM sunset.orders WHERE id = v_order_id;

  PERFORM sunset._confirm_payment_if_needed(v_order.payment_method, v_order.payment_status, p_payment_confirmed);

  UPDATE sunset.orders SET
    status = 'concluido',
    payment_status = CASE WHEN v_order.payment_method = 'pix' THEN payment_status ELSE 'pago' END,
    delivered_at = now(), updated_at = now()::text
  WHERE id = v_order_id;

  IF v_run.current_index + 1 >= array_length(v_run.order_ids, 1) THEN
    UPDATE sunset.motoboy_runs SET status = 'concluido', finished_at = now(), updated_at = now() WHERE id = v_run.id;
  ELSE
    UPDATE sunset.motoboy_runs SET current_index = current_index + 1, updated_at = now() WHERE id = v_run.id;
  END IF;

  RETURN sunset._run_json(v_run.id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_complete_current_delivery(text, boolean) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Rastreamento público (tela /consultar do cliente) — poll a cada
-- poucos segundos enquanto o pedido está em_rota_de_entrega. Não expõe
-- nada além da posição do motoboy responsável por ESSE pedido
-- específico (o cliente só tem o id do próprio pedido, não enumera).
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.track_delivery_position(p_order_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
DECLARE
  v_order sunset.orders%ROWTYPE;
  v_run sunset.motoboy_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM sunset.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_order.status <> 'em_rota_de_entrega' OR v_order.motoboy_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_run FROM sunset.motoboy_runs
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
GRANT EXECUTE ON FUNCTION sunset.track_delivery_position(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- get_order ganha delivery_started_at/delivered_at (duração da entrega).
-- ─────────────────────────────────────────────────────

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
  WHERE o.id = p_order_id;
$$;

GRANT EXECUTE ON FUNCTION sunset.get_order(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Contagem da fila do motoboy sem mais aguardando_localizacao (fluxo
-- extinto — a localização já vem do checkout).
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.motoboy_order_counts(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
  v_pronto bigint;
  v_em_rota bigint;
  v_concluido bigint;
BEGIN
  SELECT COUNT(*) INTO v_pronto FROM sunset.orders
    WHERE delivery_type = 'entrega' AND status = 'pedido_pronto' AND motoboy_id IS NULL;
  SELECT COUNT(*) INTO v_em_rota FROM sunset.orders
    WHERE delivery_type = 'entrega' AND status IN ('em_rota_de_entrega', 'entregue') AND motoboy_id = v_motoboy_id;
  SELECT COUNT(*) INTO v_concluido FROM sunset.orders
    WHERE delivery_type = 'entrega' AND status = 'concluido' AND motoboy_id = v_motoboy_id;

  RETURN jsonb_build_object(
    'pedido_pronto', v_pronto,
    'em_rota_de_entrega', v_em_rota,
    'concluido', v_concluido
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_order_counts(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Duração média de entrega (estatística) — financeiro do admin e do
-- motoboy passam a expor isso.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._avg_delivery_minutes(p_motoboy_id text DEFAULT NULL)
RETURNS double precision LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT AVG(EXTRACT(EPOCH FROM (delivered_at - delivery_started_at)) / 60)
  FROM sunset.orders
  WHERE delivery_type = 'entrega' AND status = 'concluido'
    AND delivery_started_at IS NOT NULL AND delivered_at IS NOT NULL
    AND (p_motoboy_id IS NULL OR motoboy_id = p_motoboy_id);
$$;

CREATE OR REPLACE FUNCTION sunset.motoboy_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_motoboy_id text := sunset._require_motoboy(p_token);
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
  FROM sunset.orders o
  WHERE o.motoboy_id = v_motoboy_id AND o.status = 'concluido' AND o.delivery_type = 'entrega';

  SELECT * INTO v_pending FROM sunset._motoboy_pending(v_motoboy_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM sunset.motoboy_settlements WHERE motoboy_id = v_motoboy_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'amount', amount, 'payment_method', payment_method, 'paid_at', paid_at
    ) ORDER BY paid_at DESC), '[]'::jsonb)
    INTO v_settlements
    FROM sunset.motoboy_settlements WHERE motoboy_id = v_motoboy_id;

  RETURN jsonb_build_object(
    'pending_amount', v_pending.amount,
    'total_paid', v_total_paid,
    'total_deliveries', jsonb_array_length(v_deliveries),
    'total_shipping', v_total_shipping,
    'avg_delivery_minutes', round(COALESCE(sunset._avg_delivery_minutes(v_motoboy_id), 0)::numeric, 1),
    'deliveries', v_deliveries,
    'settlements', v_settlements
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.motoboy_financeiro(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_financeiro(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_total_revenue double precision;
  v_total_orders bigint;
  v_status_counts jsonb;
  v_top_products jsonb;
  v_recent_orders jsonb;
  v_motoboys jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);

  SELECT COALESCE(SUM(total), 0) INTO v_total_revenue FROM sunset.orders WHERE payment_status = 'pago';
  SELECT COUNT(*) INTO v_total_orders FROM sunset.orders;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', cnt)), '[]'::jsonb)
    INTO v_status_counts
    FROM (SELECT status, COUNT(*) AS cnt FROM sunset.orders GROUP BY status) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'product_name', product_name,
      'quantity_sold', qty, 'revenue', rev
    ) ORDER BY qty DESC), '[]'::jsonb)
    INTO v_top_products
    FROM (
      SELECT oi.product_id, oi.product_name, SUM(oi.quantity) AS qty, SUM(oi.unit_price * oi.quantity) AS rev
      FROM sunset.order_items oi JOIN sunset.orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'pago'
      GROUP BY oi.product_id, oi.product_name
      ORDER BY qty DESC LIMIT 10
    ) t;

  SELECT COALESCE(jsonb_agg(sunset.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_recent_orders
    FROM (SELECT id, created_at FROM sunset.orders ORDER BY created_at DESC LIMIT 20) o;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name,
      'total_deliveries', d.cnt, 'total_shipping', d.total_shipping,
      'pending_amount', p.amount,
      'total_paid', COALESCE(s.total_paid, 0),
      'avg_delivery_minutes', round(COALESCE(sunset._avg_delivery_minutes(m.id), 0)::numeric, 1)
    ) ORDER BY m.name), '[]'::jsonb)
    INTO v_motoboys
    FROM sunset.motoboys m
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(o.shipping_price), 0) AS total_shipping
      FROM sunset.orders o
      WHERE o.motoboy_id = m.id AND o.status = 'concluido' AND o.delivery_type = 'entrega'
    ) d ON true
    LEFT JOIN LATERAL (SELECT * FROM sunset._motoboy_pending(m.id)) p ON true
    LEFT JOIN LATERAL (
      SELECT SUM(amount) AS total_paid FROM sunset.motoboy_settlements WHERE motoboy_id = m.id
    ) s ON true;

  RETURN jsonb_build_object(
    'total_revenue', v_total_revenue,
    'total_orders', v_total_orders,
    'orders_by_status', v_status_counts,
    'top_products', v_top_products,
    'recent_orders', v_recent_orders,
    'motoboys', v_motoboys,
    'avg_delivery_minutes', round(COALESCE(sunset._avg_delivery_minutes(NULL), 0)::numeric, 1)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_financeiro(text) TO anon, authenticated;
