-- =====================================================
-- Layout por página de cliente (/catalogo, landing, /cliente/favoritos,
-- /cliente/cupons, /cliente/historico): imagem de fundo + elementos
-- decorativos de fumaça/fogo posicionados pelo admin em
-- /admin/layout-cliente. elements é um array jsonb livre — cada item tem
-- id/type/x/y/width/height/blur/opacity/speed/count (ver PageDecoration
-- em frontend/src/lib/types.ts).
-- =====================================================

CREATE TABLE IF NOT EXISTS sunset.page_decorations (
  page_key text PRIMARY KEY,
  background_image_url text,
  elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (page_key IN ('catalogo', 'landing', 'favoritos', 'cupons', 'historico'))
);

ALTER TABLE sunset.page_decorations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON sunset.page_decorations TO anon, authenticated;
DROP POLICY IF EXISTS "sunset_anon_select_page_decorations" ON sunset.page_decorations;
CREATE POLICY "sunset_anon_select_page_decorations" ON sunset.page_decorations
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION sunset.admin_save_page_decoration(
  p_token text,
  p_page_key text,
  p_background_image_url text,
  p_elements jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_page_key NOT IN ('catalogo', 'landing', 'favoritos', 'cupons', 'historico') THEN
    RAISE EXCEPTION 'invalid page_key';
  END IF;
  INSERT INTO sunset.page_decorations (page_key, background_image_url, elements, updated_at)
  VALUES (p_page_key, p_background_image_url, COALESCE(p_elements, '[]'::jsonb), now())
  ON CONFLICT (page_key) DO UPDATE SET
    background_image_url = EXCLUDED.background_image_url,
    elements = EXCLUDED.elements,
    updated_at = now();
  RETURN jsonb_build_object('page_key', p_page_key, 'background_image_url', p_background_image_url, 'elements', COALESCE(p_elements, '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_save_page_decoration(text, text, text, jsonb) TO anon, authenticated;
