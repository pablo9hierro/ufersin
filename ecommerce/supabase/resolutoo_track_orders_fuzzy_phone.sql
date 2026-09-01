-- BUG GRAVE: track_orders_by_phone comparava customer_whatsapp por match
-- EXATO. Pedido real encontrado no banco com o número salvo faltando o 9º
-- dígito do celular (ex.: "558399434152" em vez de "5583999434152").
-- Cliente digitando o número certo em /consultar nunca batia com o que
-- estava salvo torto, e a busca voltava "nenhum pedido encontrado" mesmo
-- com o pedido existindo. Corrige comparando só os últimos 8 dígitos (o
-- número local sem DDD nem o 9º dígito opcional, dos dois lados) --
-- resiliente a DDD/9 estarem presentes ou ausentes de formas diferentes em
-- cada lado, sem precisar corrigir dado histórico. Colisão entre DDDs
-- diferentes com os mesmos 8 dígitos finais é teoricamente possível mas
-- rara na prática.
CREATE OR REPLACE FUNCTION resolutoo.track_orders_by_phone(p_whatsapp text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'resolutoo', 'loja', 'public'
AS $$
  SELECT COALESCE(jsonb_agg(resolutoo.get_order(o.id) ORDER BY o.created_at DESC), '[]'::jsonb)
  FROM loja.orders o
  WHERE right(regexp_replace(o.customer_whatsapp, '\D', '', 'g'), 8)
      = right(regexp_replace(p_whatsapp, '\D', '', 'g'), 8);
$$;
