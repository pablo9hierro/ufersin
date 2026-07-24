-- =====================================================
-- RPC mínima só pra validar um token de admin (usada pela Vercel Edge
-- Function de upload de imagem, que precisa confirmar "é admin de verdade"
-- antes de gravar no Storage com a service_role key, sem duplicar a lógica
-- de sessão em outro lugar).
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.admin_ping(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_ping(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
