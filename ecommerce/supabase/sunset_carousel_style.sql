-- =====================================================
-- Estilo do carrossel de banners/promoções da landing, escolhido pelo
-- admin em /admin/promocoes: 'atual' (um card só, troca de conteúdo
-- sozinho) ou 'cards' (cada card fica alguns segundos na tela e desliza
-- pra esquerda pro próximo). Puramente visual, não afeta os dados de
-- promoção/hero em si.
-- =====================================================

ALTER TABLE sunset.site_settings
  ADD COLUMN IF NOT EXISTS carousel_style text NOT NULL DEFAULT 'atual';

CREATE OR REPLACE FUNCTION sunset.admin_update_carousel_style(p_token text, p_style text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_style NOT IN ('atual', 'cards') THEN
    RAISE EXCEPTION 'invalid carousel_style';
  END IF;
  UPDATE sunset.site_settings SET carousel_style = p_style WHERE id = 1;
  RETURN jsonb_build_object('carousel_style', p_style);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_carousel_style(text, text) TO anon, authenticated;
