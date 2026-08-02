-- Run against the Resolutoo Supabase project (schema resolutoo).
-- Storefront reads layout_style via PostgREST:
--   POST /rest/v1/rpc/get_public_tenant_config
--   Headers: Accept-Profile / Content-Profile: resolutoo

ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS endereco_numero text,
  ADD COLUMN IF NOT EXISTS facebook text,
  ADD COLUMN IF NOT EXISTS vende_mais_18 boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION resolutoo.get_public_tenant_config(p_slug text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = resolutoo, public
AS $$
  SELECT json_build_object(
    'slug', slug,
    'loja_nome', loja_nome,
    'plano', plan_code,
    'vender_externamente', vender_externamente,
    'whatsapp_habilitado', whatsapp_habilitado,
    'whatsapp', regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'),
    'forma_pagamento', forma_pagamento,
    'plataforma_pagamento', plataforma_pagamento,
    'layout_style', coalesce(nullif(layout_style, ''), 'ufersin'),
    'cor_principal', cor_principal,
    'instagram', instagram,
    'facebook', facebook,
    'endereco', endereco,
    'endereco_numero', endereco_numero,
    'vende_mais_18', coalesce(vende_mais_18, false)
  )
  FROM resolutoo.subscribers
  WHERE lower(slug) = lower(p_slug)
    AND status = 'ativo'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION resolutoo.set_my_layout_style(p_style text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = resolutoo, public
AS $$
DECLARE
  v_slug text;
  v_style text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'não autenticado';
  END IF;
  IF p_style IS NULL OR p_style NOT IN ('ufersin', 'burgerbite', 'burgerhouse') THEN
    RAISE EXCEPTION 'layout_style inválido';
  END IF;
  UPDATE resolutoo.subscribers
  SET layout_style = p_style, updated_at = now()
  WHERE id = auth.uid()::text
  RETURNING slug, layout_style INTO v_slug, v_style;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'assinante não encontrado';
  END IF;
  RETURN json_build_object('slug', v_slug, 'layout_style', v_style, 'updated', true);
END;
$$;

GRANT USAGE ON SCHEMA resolutoo TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION resolutoo.get_public_tenant_config(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION resolutoo.set_my_layout_style(text) TO authenticated, service_role;
