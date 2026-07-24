-- =====================================================
-- Fundo do site (SunsetBackdrop) ajustável pelo admin em /admin/conta:
-- escolhe entre o SVG padrão (coqueiro), a cena synthwave, ou uma imagem
-- própria enviada por upload — e ajusta tamanho/posição/enquadramento
-- do que estiver ativo. Vale pra TODO mundo que visita o site (fica
-- salvo no banco, não é um ajuste local do navegador do admin).
-- =====================================================

ALTER TABLE sunset.site_settings
  ADD COLUMN IF NOT EXISTS bg_mode text NOT NULL DEFAULT 'svg1',
  ADD COLUMN IF NOT EXISTS bg_image_url text,
  ADD COLUMN IF NOT EXISTS bg_scale numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bg_x numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bg_y numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bg_fit text NOT NULL DEFAULT 'meet';

ALTER TABLE sunset.site_settings
  ADD CONSTRAINT sunset_site_settings_bg_mode_check CHECK (bg_mode IN ('svg1', 'synthwave', 'stars', 'custom'));

ALTER TABLE sunset.site_settings
  ADD CONSTRAINT sunset_site_settings_bg_fit_check CHECK (bg_fit IN ('meet', 'slice'));

CREATE OR REPLACE FUNCTION sunset.admin_update_bg_settings(
  p_token text,
  p_bg_mode text,
  p_bg_image_url text,
  p_bg_scale numeric,
  p_bg_x numeric,
  p_bg_y numeric,
  p_bg_fit text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_bg_mode NOT IN ('svg1', 'synthwave', 'stars', 'custom') THEN
    RAISE EXCEPTION 'invalid bg_mode';
  END IF;
  IF p_bg_fit NOT IN ('meet', 'slice') THEN
    RAISE EXCEPTION 'invalid bg_fit';
  END IF;
  UPDATE sunset.site_settings SET
    bg_mode = p_bg_mode,
    bg_image_url = p_bg_image_url,
    bg_scale = p_bg_scale,
    bg_x = p_bg_x,
    bg_y = p_bg_y,
    bg_fit = p_bg_fit
  WHERE id = 1;
  RETURN jsonb_build_object(
    'bg_mode', p_bg_mode, 'bg_image_url', p_bg_image_url, 'bg_scale', p_bg_scale,
    'bg_x', p_bg_x, 'bg_y', p_bg_y, 'bg_fit', p_bg_fit
  );
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_bg_settings(text, text, text, numeric, numeric, numeric, text) TO anon, authenticated;
