-- =====================================================
-- Imagem inicial do carrossel da landing — sempre obrigatória e sempre a
-- primeira a aparecer (mesmo quando existem campanhas cadastradas), o
-- admin pode trocá-la a qualquer momento em /admin/campanhas. Enquanto
-- nenhuma for enviada, hero_image_url fica null e o front cai no banner
-- estático padrão (asset local), sem quebrar o carrossel.
-- =====================================================

CREATE TABLE IF NOT EXISTS sunset.site_settings (
  id int PRIMARY KEY DEFAULT 1,
  hero_image_url text,
  CHECK (id = 1)
);

INSERT INTO sunset.site_settings (id, hero_image_url) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;

ALTER TABLE sunset.site_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON sunset.site_settings TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_site_settings" ON sunset.site_settings;
CREATE POLICY "sunset_anon_select_site_settings" ON sunset.site_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION sunset.admin_update_hero_image(p_token text, p_image_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_image_url IS NULL OR trim(p_image_url) = '' THEN
    RAISE EXCEPTION 'image is required';
  END IF;
  UPDATE sunset.site_settings SET hero_image_url = p_image_url WHERE id = 1;
  RETURN jsonb_build_object('hero_image_url', p_image_url);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_hero_image(text, text) TO anon, authenticated;
