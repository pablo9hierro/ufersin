-- =====================================================
-- Deslocamento vertical (px, pode ser negativo) do container de badges
-- da landing — o admin sobe ou desce o bloco pra fechar o espaço vazio
-- entre o banner e ele, sem mexer em código.
-- =====================================================

ALTER TABLE sunset.site_settings
  ADD COLUMN IF NOT EXISTS badges_offset_y numeric NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS sunset.admin_update_badges(text, jsonb, text, numeric);

CREATE OR REPLACE FUNCTION sunset.admin_update_badges(
  p_token text,
  p_badges jsonb,
  p_layout text,
  p_gap numeric,
  p_offset_y numeric
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
    badges_gap = p_gap,
    badges_offset_y = p_offset_y
  WHERE id = 1;
  RETURN jsonb_build_object('badges', p_badges, 'badges_layout', p_layout, 'badges_gap', p_gap, 'badges_offset_y', p_offset_y);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_badges(text, jsonb, text, numeric, numeric) TO anon, authenticated;
