-- Run against the Resolutoo Supabase project (schema resolutoo).
-- Storefront reads layout_style via PostgREST:
--   POST /rest/v1/rpc/get_public_tenant_config
--   Headers: Accept-Profile / Content-Profile: resolutoo

ALTER TABLE IF EXISTS resolutoo.subscribers
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS endereco_numero text,
  ADD COLUMN IF NOT EXISTS facebook text,
  ADD COLUMN IF NOT EXISTS vende_mais_18 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS apenas_retirada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pagamento_na_retirada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entrega_somente_pix boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pagamento_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coleta_gratis boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entrega_reparado_gratis boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS landing_hero_image_url text,
  ADD COLUMN IF NOT EXISTS landing_headline text,
  ADD COLUMN IF NOT EXISTS landing_sub text,
  ADD COLUMN IF NOT EXISTS landing_badge text,
  ADD COLUMN IF NOT EXISTS landing_highlights jsonb,
  ADD COLUMN IF NOT EXISTS landing_texts jsonb,
  ADD COLUMN IF NOT EXISTS oferece_servicos boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS precisa_tela_cozinha boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cart_fab_style text NOT NULL DEFAULT 'sacola',
  ADD COLUMN IF NOT EXISTS cart_fab_animate boolean NOT NULL DEFAULT false;

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
    'plataforma_oauth', coalesce(plataforma_credenciais->>'source' = 'oauth', false),
    'layout_style', coalesce(nullif(layout_style, ''), 'ufersin'),
    'vertical', coalesce(nullif(vertical, ''), 'ecommerce'),
    'cor_principal', cor_principal,
    'instagram', instagram,
    'facebook', facebook,
    'endereco', endereco,
    'endereco_numero', endereco_numero,
    'vende_mais_18', coalesce(vende_mais_18, false),
    'apenas_retirada', coalesce(apenas_retirada, false),
    -- Loja de retirada não tem deslocamento pra ser cortesia — mesma
    -- normalização do endpoint Rust, pra dado legado inconsistente nunca
    -- fazer a vitrine oferecer coleta/entrega numa loja sem deslocamento.
    'coleta_gratis', NOT coalesce(apenas_retirada, false) AND coalesce(coleta_gratis, false),
    'entrega_reparado_gratis', NOT coalesce(apenas_retirada, false) AND coalesce(entrega_reparado_gratis, false),
    'pagamento_na_retirada', coalesce(pagamento_na_retirada, false),
    'entrega_somente_pix', coalesce(entrega_somente_pix, false),
    'pagamento_manual', coalesce(pagamento_manual, false),
    'landing_hero_image_url', landing_hero_image_url,
    'logo_url', logo_url,
    'landing_headline', landing_headline,
    'landing_sub', landing_sub,
    'landing_badge', landing_badge,
    'landing_highlights', coalesce(landing_highlights, 'null'::jsonb),
    'landing_texts', coalesce(landing_texts, '{}'::jsonb),
    'oferece_servicos', coalesce(oferece_servicos, false),
    'precisa_tela_cozinha', coalesce(precisa_tela_cozinha, false),
    'cart_fab_style', coalesce(nullif(cart_fab_style, ''), 'sacola'),
    'cart_fab_animate', coalesce(cart_fab_animate, false)
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assinante não encontrado';
  END IF;
  RETURN json_build_object('slug', v_slug, 'layout_style', v_style, 'updated', true);
END;
$$;

CREATE OR REPLACE FUNCTION resolutoo.set_my_sale_prefs(
  p_apenas_retirada boolean DEFAULT NULL,
  p_vende_mais_18 boolean DEFAULT NULL,
  p_vender_externamente boolean DEFAULT NULL,
  p_pagamento_na_retirada boolean DEFAULT NULL,
  p_entrega_somente_pix boolean DEFAULT NULL,
  p_pagamento_manual boolean DEFAULT NULL,
  p_coleta_gratis boolean DEFAULT NULL,
  p_entrega_reparado_gratis boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = resolutoo, public
AS $$
DECLARE
  v_slug text;
  v_apenas boolean;
  v_mais18 boolean;
  v_ext boolean;
  v_pag_ret boolean;
  v_ent_pix boolean;
  v_pag_man boolean;
  v_coleta_gratis boolean;
  v_entrega_gratis boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'não autenticado';
  END IF;
  UPDATE resolutoo.subscribers
  SET
    apenas_retirada = COALESCE(p_apenas_retirada, apenas_retirada),
    vende_mais_18 = COALESCE(p_vende_mais_18, vende_mais_18),
    vender_externamente = COALESCE(p_vender_externamente, vender_externamente),
    pagamento_na_retirada = COALESCE(p_pagamento_na_retirada, pagamento_na_retirada),
    entrega_somente_pix = COALESCE(p_entrega_somente_pix, entrega_somente_pix),
    pagamento_manual = COALESCE(p_pagamento_manual, pagamento_manual),
    -- Marcar "apenas retirada" aqui zera as cortesias de deslocamento (não
    -- há deslocamento pra ser cortesia) — mesma regra do PATCH em Rust.
    coleta_gratis = CASE WHEN COALESCE(p_apenas_retirada, apenas_retirada)
      THEN false ELSE COALESCE(p_coleta_gratis, coleta_gratis) END,
    entrega_reparado_gratis = CASE WHEN COALESCE(p_apenas_retirada, apenas_retirada)
      THEN false ELSE COALESCE(p_entrega_reparado_gratis, entrega_reparado_gratis) END,
    updated_at = now()
  WHERE id = auth.uid()::text
  RETURNING slug, apenas_retirada, vende_mais_18, vender_externamente, pagamento_na_retirada,
            entrega_somente_pix, pagamento_manual, coleta_gratis, entrega_reparado_gratis
    INTO v_slug, v_apenas, v_mais18, v_ext, v_pag_ret, v_ent_pix, v_pag_man,
         v_coleta_gratis, v_entrega_gratis;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assinante não encontrado';
  END IF;
  -- slug may still be NULL mid-onboarding; prefs are stored on the subscriber row anyway.
  RETURN json_build_object(
    'slug', v_slug,
    'apenas_retirada', v_apenas,
    'vende_mais_18', v_mais18,
    'vender_externamente', v_ext,
    'pagamento_na_retirada', v_pag_ret,
    'entrega_somente_pix', v_ent_pix,
    'pagamento_manual', v_pag_man,
    'coleta_gratis', v_coleta_gratis,
    'entrega_reparado_gratis', v_entrega_gratis,
    'updated', true
  );
END;
$$;

GRANT USAGE ON SCHEMA resolutoo TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION resolutoo.get_public_tenant_config(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION resolutoo.set_my_layout_style(text) TO authenticated, service_role;
-- Drop prior overloads, then grant current signature.
DROP FUNCTION IF EXISTS resolutoo.set_my_sale_prefs(boolean, boolean, boolean);
DROP FUNCTION IF EXISTS resolutoo.set_my_sale_prefs(boolean, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS resolutoo.set_my_sale_prefs(boolean, boolean, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS resolutoo.set_my_sale_prefs(boolean, boolean, boolean, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS resolutoo.set_my_sale_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean);
GRANT EXECUTE ON FUNCTION resolutoo.set_my_sale_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) TO authenticated, service_role;
