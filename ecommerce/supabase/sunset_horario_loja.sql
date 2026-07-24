-- =====================================================
-- Horário de funcionamento da loja + fechamento manual (com justificativa
-- obrigatória quando o admin fecha durante um horário que deveria estar
-- aberto). A landing page usa isso pra decidir se mostra o site "aberto"
-- (normal) ou "fechado" (grayscale + mensagem de justificativa).
--
-- Cada dia pode ter MÚLTIPLOS intervalos (ex: 10:00-14:00 e 18:00-22:00,
-- pra almoço/pausa) — guardado como array jsonb de {opens_at, closes_at}
-- em vez de um único par de colunas.
-- =====================================================

CREATE TABLE IF NOT EXISTS sunset.store_hours (
  day_of_week smallint PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6), -- 0=domingo .. 6=sábado
  is_open boolean NOT NULL DEFAULT true,
  intervals jsonb NOT NULL DEFAULT '[]'::jsonb -- [{"opens_at":"10:00","closes_at":"14:00"}, ...]
);

-- Idempotente pra quem já rodou a versão anterior (opens_at/closes_at
-- únicos) desta migration antes desta reescrita.
ALTER TABLE sunset.store_hours ADD COLUMN IF NOT EXISTS intervals jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'sunset' AND table_name = 'store_hours' AND column_name = 'opens_at') THEN
    UPDATE sunset.store_hours SET intervals = jsonb_build_array(jsonb_build_object('opens_at', opens_at, 'closes_at', closes_at))
      WHERE opens_at IS NOT NULL AND closes_at IS NOT NULL AND intervals = '[]'::jsonb;
    ALTER TABLE sunset.store_hours DROP COLUMN opens_at;
    ALTER TABLE sunset.store_hours DROP COLUMN closes_at;
  END IF;
END $$;

INSERT INTO sunset.store_hours (day_of_week, is_open, intervals)
  SELECT d, true, jsonb_build_array(jsonb_build_object('opens_at', '09:00', 'closes_at', '18:00'))
  FROM generate_series(0, 6) AS d
  ON CONFLICT (day_of_week) DO NOTHING;

CREATE TABLE IF NOT EXISTS sunset.store_status (
  id int PRIMARY KEY DEFAULT 1,
  manually_closed boolean NOT NULL DEFAULT false,
  manual_closed_reason text,
  CHECK (id = 1)
);

INSERT INTO sunset.store_status (id, manually_closed) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

ALTER TABLE sunset.store_hours ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON sunset.store_hours TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_store_hours" ON sunset.store_hours;
CREATE POLICY "sunset_anon_select_store_hours" ON sunset.store_hours
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE sunset.store_status ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON sunset.store_status TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_store_status" ON sunset.store_status;
CREATE POLICY "sunset_anon_select_store_status" ON sunset.store_status
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION sunset.admin_set_store_hours(p_token text, p_hours jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_h jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);
  FOR v_h IN SELECT * FROM jsonb_array_elements(p_hours) LOOP
    UPDATE sunset.store_hours SET
      is_open = COALESCE((v_h->>'is_open')::boolean, false),
      intervals = COALESCE(v_h->'intervals', '[]'::jsonb)
    WHERE day_of_week = (v_h->>'day_of_week')::smallint;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_set_store_hours(text, jsonb) TO anon, authenticated;

-- Fechamento manual: se o admin está fechando a loja justamente num
-- horário em que ela deveria estar aberta (segundo o horário semanal —
-- qualquer um dos intervalos do dia cobrindo o horário atual), exige
-- justificativa — senão pode fechar/abrir livremente.
CREATE OR REPLACE FUNCTION sunset.admin_set_store_manual_status(p_token text, p_manually_closed boolean, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_now            timestamp := now() at time zone 'America/Recife';
  v_dow            smallint := extract(dow from v_now)::smallint;
  v_hour_row       sunset.store_hours%ROWTYPE;
  v_now_time       time := v_now::time;
  v_interval       jsonb;
  v_should_be_open boolean := false;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_manually_closed THEN
    SELECT * INTO v_hour_row FROM sunset.store_hours WHERE day_of_week = v_dow;
    IF FOUND AND v_hour_row.is_open THEN
      FOR v_interval IN SELECT * FROM jsonb_array_elements(v_hour_row.intervals) LOOP
        IF v_now_time >= (v_interval->>'opens_at')::time AND v_now_time < (v_interval->>'closes_at')::time THEN
          v_should_be_open := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;
    IF v_should_be_open AND trim(COALESCE(p_reason, '')) = '' THEN
      RAISE EXCEPTION 'a justification is required to close the store during scheduled open hours';
    END IF;
  END IF;

  UPDATE sunset.store_status SET
    manually_closed = p_manually_closed,
    manual_closed_reason = CASE WHEN p_manually_closed THEN NULLIF(trim(p_reason), '') ELSE NULL END
  WHERE id = 1;

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_set_store_manual_status(text, boolean, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
