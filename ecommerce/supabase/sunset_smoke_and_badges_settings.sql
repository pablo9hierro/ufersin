-- =====================================================
-- Fumaça do botão do carrinho (velocidade/quantidade/largura do
-- container/altura de subida) e badges da landing (lista editável de
-- texto + layout lado-a-lado ou empilhado + espaçamento), ambos
-- ajustáveis pelo admin em /admin/conta. Badges guardadas como jsonb
-- (lista pequena, sem necessidade de tabela relacional própria).
-- =====================================================

ALTER TABLE sunset.site_settings
  ADD COLUMN IF NOT EXISTS smoke_speed numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS smoke_count int NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS smoke_width numeric NOT NULL DEFAULT 64,
  ADD COLUMN IF NOT EXISTS smoke_height numeric NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS badges jsonb NOT NULL DEFAULT '[
    {"id": "1", "text": "SUNSET • Desde 2023", "bold": true},
    {"id": "2", "text": "🔥 Experiência, vibe e essência", "bold": false},
    {"id": "3", "text": "👇 A vibe começa aqui", "bold": false}
  ]'::jsonb,
  ADD COLUMN IF NOT EXISTS badges_layout text NOT NULL DEFAULT 'row',
  ADD COLUMN IF NOT EXISTS badges_gap numeric NOT NULL DEFAULT 8;

ALTER TABLE sunset.site_settings
  ADD CONSTRAINT sunset_site_settings_badges_layout_check CHECK (badges_layout IN ('row', 'column'));

CREATE OR REPLACE FUNCTION sunset.admin_update_smoke_settings(
  p_token text,
  p_speed numeric,
  p_count int,
  p_width numeric,
  p_height numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_count < 1 OR p_count > 40 THEN
    RAISE EXCEPTION 'invalid smoke count';
  END IF;
  UPDATE sunset.site_settings SET
    smoke_speed = p_speed,
    smoke_count = p_count,
    smoke_width = p_width,
    smoke_height = p_height
  WHERE id = 1;
  RETURN jsonb_build_object('smoke_speed', p_speed, 'smoke_count', p_count, 'smoke_width', p_width, 'smoke_height', p_height);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_smoke_settings(text, numeric, int, numeric, numeric) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_badges(
  p_token text,
  p_badges jsonb,
  p_layout text,
  p_gap numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_layout NOT IN ('row', 'column') THEN
    RAISE EXCEPTION 'invalid badges_layout';
  END IF;
  UPDATE sunset.site_settings SET
    badges = p_badges,
    badges_layout = p_layout,
    badges_gap = p_gap
  WHERE id = 1;
  RETURN jsonb_build_object('badges', p_badges, 'badges_layout', p_layout, 'badges_gap', p_gap);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_badges(text, jsonb, text, numeric) TO anon, authenticated;
