-- =====================================================
-- Segmentações persistidas do CRM: substitui o dropdown rápido antigo
-- ("aniversariantes", "mais frequentes" etc, fixo no código) por
-- segmentações nomeadas e salvas, criadas a partir do filtro avançado —
-- nome, descrição e o próprio critério do filtro (jsonb, mesmo formato
-- que o front já monta), opcionalmente vinculadas a um cupom exclusivo
-- (sunset.coupons, criado pra exatamente os clientes daquele filtro) e/ou
-- uma campanha existente (só referência, campanha não é por-cliente).
-- =====================================================

CREATE TABLE IF NOT EXISTS sunset.crm_segments (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name             TEXT NOT NULL,
  description      TEXT,
  filter_criteria  JSONB NOT NULL,
  coupon_id        TEXT REFERENCES sunset.coupons(id) ON DELETE SET NULL,
  campaign_id      TEXT REFERENCES sunset.campaigns(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (now()::text)
);
ALTER TABLE sunset.crm_segments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION sunset._segment_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'description', description, 'filter_criteria', filter_criteria,
    'coupon_id', coupon_id, 'campaign_id', campaign_id, 'created_at', created_at
  ) FROM sunset.crm_segments WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_list_segments(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE((SELECT jsonb_agg(sunset._segment_json(id) ORDER BY created_at DESC) FROM sunset.crm_segments), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_segments(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_create_segment(
  p_token text, p_name text, p_description text, p_filter_criteria jsonb,
  p_coupon_id text DEFAULT NULL, p_campaign_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  INSERT INTO sunset.crm_segments (id, name, description, filter_criteria, coupon_id, campaign_id)
    VALUES (v_id, trim(p_name), NULLIF(trim(p_description), ''), p_filter_criteria, p_coupon_id, p_campaign_id);
  RETURN sunset._segment_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_segment(text, text, text, jsonb, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_segment(
  p_token text, p_id text, p_name text, p_description text, p_filter_criteria jsonb,
  p_coupon_id text DEFAULT NULL, p_campaign_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  UPDATE sunset.crm_segments SET
    name = trim(p_name), description = NULLIF(trim(p_description), ''),
    filter_criteria = p_filter_criteria, coupon_id = p_coupon_id, campaign_id = p_campaign_id
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'segment not found';
  END IF;
  RETURN sunset._segment_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_segment(text, text, text, text, jsonb, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_delete_segment(p_token text, p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  DELETE FROM sunset.crm_segments WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_delete_segment(text, text) TO anon, authenticated;
