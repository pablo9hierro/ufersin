-- =====================================================
-- "Resultados da segmentação" (histórico de disparos de uma campanha)
-- precisa mostrar a data de cada disparo — coupon_grants já tem
-- created_at, só faltava expor no retorno.
-- =====================================================

CREATE OR REPLACE FUNCTION sunset.admin_list_coupon_grants(p_token text, p_coupon_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id, 'customer_whatsapp', g.customer_whatsapp, 'customer_name', c.name,
      'granted_uses', g.granted_uses, 'used_count', g.used_count, 'created_at', g.created_at
    ) ORDER BY g.created_at DESC)
    FROM sunset.coupon_grants g
    LEFT JOIN sunset.customers c ON c.whatsapp = g.customer_whatsapp
    WHERE g.coupon_id = p_coupon_id
  ), '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_list_coupon_grants(text, text) TO anon, authenticated;
