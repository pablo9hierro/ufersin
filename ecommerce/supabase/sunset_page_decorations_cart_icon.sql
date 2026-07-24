-- =====================================================
-- Adiciona 'cart_icon' como page_key válido em sunset.page_decorations —
-- um alvo especial (não é uma rota) que representa o botão flutuante do
-- carrinho (CartFab), renderizado globalmente em toda tela que o usa. O
-- admin edita em /admin/layout-cliente, aba "Ícone do carrinho".
-- =====================================================

ALTER TABLE sunset.page_decorations DROP CONSTRAINT IF EXISTS page_decorations_page_key_check;
ALTER TABLE sunset.page_decorations
  ADD CONSTRAINT page_decorations_page_key_check
  CHECK (page_key IN ('catalogo', 'landing', 'favoritos', 'cupons', 'historico', 'cart_icon'));

CREATE OR REPLACE FUNCTION sunset.admin_save_page_decoration(
  p_token text,
  p_page_key text,
  p_background_image_url text,
  p_elements jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_page_key NOT IN ('catalogo', 'landing', 'favoritos', 'cupons', 'historico', 'cart_icon') THEN
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
