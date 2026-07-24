-- =====================================================
-- Agendamento de disparo por cupom exclusivo (principal ou extra) de uma
-- campanha 'evento': em vez de notificar o cliente por WhatsApp na hora
-- em que ele passa a bater o critério do gatilho, o admin pode definir
-- "manda em X dias, às H horas (horário de Brasília)". Sem isso
-- (schedule_delay_days NULL), comportamento é o de sempre — notifica na
-- hora que concede.
--
-- Como não existe job em background no projeto (só reavalia quando
-- alguém abre o CRM — ver comentário em AdminCrm.tsx), o agendamento
-- também só é checado nesse mesmo momento: cada vez que o CRM carrega,
-- roda admin_dispatch_scheduled_coupon_notifications, que resolve todo
-- concessão pendente (grant) cujo prazo+horário já bateu.
-- =====================================================

ALTER TABLE sunset.crm_segment_coupons
  ADD COLUMN IF NOT EXISTS schedule_delay_days int,
  ADD COLUMN IF NOT EXISTS schedule_hour int;
ALTER TABLE sunset.crm_segment_coupons
  ADD CONSTRAINT sunset_crm_segment_coupons_schedule_hour_check CHECK (schedule_hour IS NULL OR (schedule_hour >= 0 AND schedule_hour <= 23));

ALTER TABLE sunset.crm_campanha_extra_coupons
  ADD COLUMN IF NOT EXISTS schedule_delay_days int,
  ADD COLUMN IF NOT EXISTS schedule_hour int;
ALTER TABLE sunset.crm_campanha_extra_coupons
  ADD CONSTRAINT sunset_crm_campanha_extra_coupons_schedule_hour_check CHECK (schedule_hour IS NULL OR (schedule_hour >= 0 AND schedule_hour <= 23));

-- NULL = ainda não notificado (pendente, seja imediato ou agendado).
ALTER TABLE sunset.coupon_grants
  ADD COLUMN IF NOT EXISTS notified_at text;

CREATE OR REPLACE FUNCTION sunset._campanha_coupon_json(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sunset, public AS $$
  SELECT jsonb_build_object(
    'id', id, 'segment_id', segment_id, 'coupon_id', coupon_id, 'orientation', orientation,
    'name', name, 'description', description, 'starts_at', starts_at, 'ends_at', ends_at,
    'trigger_criteria', trigger_criteria, 'trigger_description', trigger_description,
    'end_criteria', end_criteria, 'end_description', end_description, 'message_template', message_template,
    'uses_per_customer', uses_per_customer, 'active', (active <> 0), 'fired_at', last_fired_at, 'created_at', created_at,
    'last_synced_segment_criteria', last_synced_segment_criteria,
    'schedule_delay_days', schedule_delay_days, 'schedule_hour', schedule_hour,
    'extra_coupons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'coupon', sunset._coupon_json(ec.coupon_id), 'message_template', ec.message_template, 'end_criteria', ec.end_criteria,
        'schedule_delay_days', ec.schedule_delay_days, 'schedule_hour', ec.schedule_hour
      ) ORDER BY ec.created_at)
      FROM sunset.crm_campanha_extra_coupons ec WHERE ec.campanha_id = crm_segment_coupons.id
    ), '[]'::jsonb)
  ) FROM sunset.crm_segment_coupons WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION sunset.admin_set_campanha_coupon_schedule(p_token text, p_id text, p_delay_days int, p_hour int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_delay_days IS NOT NULL AND p_hour IS NULL THEN
    RAISE EXCEPTION 'hour is required when scheduling';
  END IF;
  IF p_hour IS NOT NULL AND (p_hour < 0 OR p_hour > 23) THEN
    RAISE EXCEPTION 'invalid hour';
  END IF;
  UPDATE sunset.crm_segment_coupons SET schedule_delay_days = p_delay_days, schedule_hour = p_hour WHERE id = p_id;
  RETURN sunset._campanha_coupon_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_set_campanha_coupon_schedule(text, text, int, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_set_extra_coupon_schedule(p_token text, p_id text, p_delay_days int, p_hour int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_delay_days IS NOT NULL AND p_hour IS NULL THEN
    RAISE EXCEPTION 'hour is required when scheduling';
  END IF;
  IF p_hour IS NOT NULL AND (p_hour < 0 OR p_hour > 23) THEN
    RAISE EXCEPTION 'invalid hour';
  END IF;
  UPDATE sunset.crm_campanha_extra_coupons SET schedule_delay_days = p_delay_days, schedule_hour = p_hour WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_set_extra_coupon_schedule(text, text, int, int) TO anon, authenticated;

-- Grava o grant já com notified_at preenchido (não agendado -> pronto
-- pra notificar na hora, front chama notifyCouponGrant logo depois) OU
-- em aberto (agendado -> fica pendente até
-- admin_dispatch_scheduled_coupon_notifications resolver). Também passa
-- a retornar 'to_notify' (principal + extras sem agendamento, juntos —
-- antes só o principal era notificado, extras eram concedidos sem
-- avisar o cliente).
CREATE OR REPLACE FUNCTION sunset.admin_fire_campanha_event(p_token text, p_id text, p_customer_whatsapps text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_row       sunset.crm_segment_coupons%ROWTYPE;
  v_whatsapp  text;
  v_newly     text[] := '{}';
  v_in_window boolean;
  v_to_notify jsonb := '[]'::jsonb;
  v_notify_ws text[];
  rec         record;
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

  v_in_window := (v_row.starts_at IS NULL OR v_row.starts_at::timestamptz <= now())
    AND (v_row.ends_at IS NULL OR v_row.ends_at::timestamptz >= now());
  IF NOT v_in_window THEN
    RETURN jsonb_build_object('newly_granted', '[]'::jsonb, 'to_notify', '[]'::jsonb);
  END IF;

  FOR rec IN
    SELECT c.id AS coupon_id, c.active, c.starts_at, c.expires_at,
           v_row.schedule_delay_days AS delay, v_row.schedule_hour AS hour, v_row.message_template AS message_template,
           true AS is_primary
    FROM sunset.coupons c WHERE c.id = v_row.coupon_id
    UNION ALL
    SELECT c.id, c.active, c.starts_at, c.expires_at,
           ec.schedule_delay_days, ec.schedule_hour, ec.message_template,
           false
    FROM sunset.coupons c JOIN sunset.crm_campanha_extra_coupons ec ON ec.coupon_id = c.id WHERE ec.campanha_id = p_id
  LOOP
    IF rec.active = 0
       OR (rec.starts_at IS NOT NULL AND rec.starts_at::timestamptz > now())
       OR (rec.expires_at IS NOT NULL AND rec.expires_at::timestamptz <= now()) THEN
      CONTINUE;
    END IF;
    v_notify_ws := '{}';
    FOREACH v_whatsapp IN ARRAY p_customer_whatsapps LOOP
      IF v_whatsapp IS NULL OR trim(v_whatsapp) = '' THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM sunset.coupon_grants WHERE coupon_id = rec.coupon_id AND customer_whatsapp = v_whatsapp) THEN
        INSERT INTO sunset.coupon_grants (id, coupon_id, customer_whatsapp, granted_uses, used_count, notified_at)
          VALUES (
            gen_random_uuid()::text, rec.coupon_id, v_whatsapp, v_row.uses_per_customer, 0,
            CASE WHEN rec.delay IS NULL THEN now()::text ELSE NULL END
          );
        IF rec.is_primary THEN
          v_newly := array_append(v_newly, v_whatsapp);
        END IF;
        IF rec.delay IS NULL THEN
          v_notify_ws := array_append(v_notify_ws, v_whatsapp);
        END IF;
      END IF;
    END LOOP;
    IF array_length(v_notify_ws, 1) > 0 THEN
      v_to_notify := v_to_notify || jsonb_build_object('coupon_id', rec.coupon_id, 'message_template', rec.message_template, 'whatsapps', to_jsonb(v_notify_ws));
    END IF;
  END LOOP;

  IF array_length(v_newly, 1) > 0 THEN
    UPDATE sunset.crm_segment_coupons SET last_fired_at = now()::text WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_newly), 'to_notify', v_to_notify);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_fire_campanha_event(text, text, text[]) TO anon, authenticated;

-- Roda a cada load do CRM (junto do resto do auto-check): resolve todo
-- grant pendente (notified_at NULL) de cupom AGENDADO cujo prazo (dias
-- desde a concessão) já passou e cuja hora de Brasília bate com a
-- configurada — marca como notificado e devolve pro front disparar o
-- WhatsApp de cada um.
CREATE OR REPLACE FUNCTION sunset.admin_dispatch_scheduled_coupon_notifications(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM sunset._require_admin(p_token);

  WITH due AS (
    SELECT
      g.id AS grant_id,
      g.coupon_id,
      g.customer_whatsapp,
      COALESCE(sc.message_template, ec.message_template) AS message_template
    FROM sunset.coupon_grants g
    LEFT JOIN sunset.crm_segment_coupons sc ON sc.coupon_id = g.coupon_id AND sc.schedule_delay_days IS NOT NULL
    LEFT JOIN sunset.crm_campanha_extra_coupons ec ON ec.coupon_id = g.coupon_id AND ec.schedule_delay_days IS NOT NULL
    WHERE g.notified_at IS NULL
      AND (sc.coupon_id IS NOT NULL OR ec.coupon_id IS NOT NULL)
      AND (g.created_at::timestamptz + make_interval(days => COALESCE(sc.schedule_delay_days, ec.schedule_delay_days))) <= now()
      AND EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int = COALESCE(sc.schedule_hour, ec.schedule_hour)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('coupon_id', coupon_id, 'customer_whatsapp', customer_whatsapp, 'message_template', message_template)), '[]'::jsonb)
    INTO v_result
  FROM due;

  UPDATE sunset.coupon_grants g SET notified_at = now()::text
  WHERE g.notified_at IS NULL
    AND EXISTS (
      SELECT 1 FROM sunset.crm_segment_coupons sc
      WHERE sc.coupon_id = g.coupon_id AND sc.schedule_delay_days IS NOT NULL
        AND (g.created_at::timestamptz + make_interval(days => sc.schedule_delay_days)) <= now()
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int = sc.schedule_hour
    )
    OR EXISTS (
      SELECT 1 FROM sunset.crm_campanha_extra_coupons ec
      WHERE ec.coupon_id = g.coupon_id AND ec.schedule_delay_days IS NOT NULL
        AND (g.created_at::timestamptz + make_interval(days => ec.schedule_delay_days)) <= now()
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int = ec.schedule_hour
    );

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_dispatch_scheduled_coupon_notifications(text) TO anon, authenticated;
