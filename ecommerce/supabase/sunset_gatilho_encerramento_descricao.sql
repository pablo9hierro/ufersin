-- =====================================================
-- Campo de descrição livre (texto interno, só pro admin) pro gatilho de
-- encerramento da campanha — mesma ideia do trigger_description que o
-- gatilho de disparo já tem.
--
-- Execução: depois de sunset_cupom_e_gatilho_descricao.sql.
-- =====================================================

ALTER TABLE sunset.crm_segment_coupons ADD COLUMN IF NOT EXISTS end_description TEXT;

CREATE OR REPLACE FUNCTION sunset._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'name', name, 'description', description, 'starts_at', starts_at, 'ends_at', ends_at,
    'trigger_criteria', trigger_criteria, 'trigger_description', trigger_description,
    'end_criteria', end_criteria, 'end_description', end_description, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'last_synced_segment_criteria', last_synced_segment_criteria,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'coupon', sunset._coupon_json(ec.coupon_id), 'message_template', ec.message_template, 'end_criteria', ec.end_criteria
      ) ORDER BY ec.created_at)
      FROM sunset.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM sunset.crm_segment_coupons WHERE id = p_id;
$$;

-- admin_set_campanha_end_criteria ganha p_end_description (aditivo, sem
-- precisar de DROP já que o parâmetro novo é opcional e vai no final).
CREATE OR REPLACE FUNCTION sunset.admin_set_campanha_end_criteria(p_token text, p_id text, p_end_criteria jsonb, p_end_description text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF NOT EXISTS (SELECT 1 FROM sunset.crm_segment_coupons WHERE id = p_id) THEN
    RAISE EXCEPTION 'campanha not found';
  END IF;
  UPDATE sunset.crm_segment_coupons SET
    end_criteria = p_end_criteria,
    end_description = NULLIF(trim(p_end_description), '')
  WHERE id = p_id;
  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_set_campanha_end_criteria(text, text, jsonb, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
