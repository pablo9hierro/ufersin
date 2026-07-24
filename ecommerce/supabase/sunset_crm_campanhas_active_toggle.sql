-- =====================================================
-- Campanha (crm_segment_coupons) ganha um toggle "Ativa/Pausada", igual ao
-- que cupom já tem — o wireframe do admin mostra esse "On" em todo card de
-- campanha. Pausar uma campanha 'evento' impede que ela seja reavaliada
-- (admin_fire_campanha_event e o auto-check do front pulam linhas
-- inativas); pausar uma 'segmento' só é cosmético já que ela dispara uma
-- vez só na criação.
--
-- Execução: depois de sunset_crm_campanhas_eventos.sql (a tabela
-- crm_segment_coupons precisa existir).
-- =====================================================

ALTER TABLE sunset.crm_segment_coupons ADD COLUMN IF NOT EXISTS active BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION sunset._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'trigger_criteria', trigger_criteria, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at
  ) FROM sunset.crm_segment_coupons WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_toggle_campanha_coupon(p_token text, p_id text, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  UPDATE sunset.crm_segment_coupons SET active = CASE WHEN p_active THEN 1 ELSE 0 END WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_toggle_campanha_coupon(text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row      sunset.crm_segment_coupons%ROWTYPE;
  v_whatsapp text;
  v_newly    text[] := '{}';
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT * INTO v_row FROM sunset.crm_segment_coupons WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campanha coupon not found';
  END IF;
  IF v_row.orientation <> 'evento' THEN
    RAISE EXCEPTION 'only orientation=evento campanhas can be re-fired';
  END IF;
  IF v_row.active = 0 THEN
    RAISE EXCEPTION 'this campanha is paused';
  END IF;

  FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
    IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = v_row.coupon_id AND customer_whatsapp = v_whatsapp) THEN
      INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count)
        VALUES (gen_random_uuid()::text, v_row.coupon_id, v_whatsapp, v_row.uses_per_customer, 0);
      v_newly := array_append(v_newly, v_whatsapp);
    END IF;
  END LOOP;

  IF array_length(v_newly, 1) > 0 THEN
    UPDATE sunset.crm_segment_coupons SET last_fired_at = now()::text WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_newly));
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_fire_campanha_event(text, text, text[]) TO anon, authenticated;
