-- =====================================================
-- Migra o Pix (AbacatePay) do backend Rust/Railway pra rodar via Vercel
-- Edge Functions + Supabase direto (Railway fica só com Evolution API +
-- Rust, nada de pagamento). Duas RPCs públicas idempotentes (chamadas
-- pelas Edge Functions, que detêm a chave da AbacatePay) + um cron de
-- backstop (confirma o pagamento mesmo se o cliente fechar a aba antes de
-- o polling do navegador pegar) + um trigger que dispara a notificação de
-- WhatsApp NA HORA que o pagamento confirma, via pg_net (fila
-- instantânea, sem esperar ciclo nenhum, sem Redis, sem Railway extra).
--
-- Execução: depois de sunset_admin_ping.sql. Habilita pg_cron e pg_net
-- (extensões padrão do Supabase, disponíveis em todos os planos).
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────
-- 1. RPCs públicas de escrita — mesma superfície de dados que o Rust já
--    escrevia via sqlx, só que chamadas pelas Edge Functions em vez do
--    backend. Idempotentes: seguro chamar mais de uma vez (ex: cron +
--    polling do navegador tentando o mesmo pedido ao mesmo tempo).
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.set_pix_charge(
  p_order_id text, p_payment_id text, p_qr_base64 text, p_copia_cola text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public AS $$
BEGIN
  UPDATE sunset.orders SET
    pix_payment_id = p_payment_id,
    pix_qr_base64 = p_qr_base64,
    pix_copia_cola = p_copia_cola,
    updated_at = now()::text
  WHERE id = p_order_id AND pix_payment_id IS NULL;
  RETURN sunset.get_order(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.set_pix_charge(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.confirm_pix_payment(p_order_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public AS $$
BEGIN
  UPDATE sunset.orders SET payment_status = 'pago', updated_at = now()::text
    WHERE id = p_order_id AND payment_method = 'pix' AND payment_status <> 'pago';
  RETURN sunset.get_order(p_order_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.confirm_pix_payment(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 2. Trigger: no exato momento que payment_status vira 'pago' (por
--    qualquer caminho — polling do cliente OU o cron de backstop
--    abaixo), dispara uma chamada assíncrona (pg_net não bloqueia, só
--    enfileira) pra Edge Function que aciona o WhatsApp via Rust/Railway.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._notify_pix_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, net AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://sunset-tabas.vercel.app/api/notify-payment',
    body := jsonb_build_object('order_id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sunset_pix_paid_notify ON sunset.orders;
CREATE TRIGGER sunset_pix_paid_notify
  AFTER UPDATE ON sunset.orders
  FOR EACH ROW
  WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NEW.payment_status = 'pago' AND NEW.payment_method = 'pix')
  EXECUTE FUNCTION sunset._notify_pix_paid();

-- ─────────────────────────────────────────────────────
-- 3. pg_cron backstop: confere Pix pendente a cada 1 min, independente
--    do cliente ter fechado a aba — chama a MESMA Edge Function que o
--    polling do navegador chama. Só olha pedidos dos últimos 2 dias pra
--    não ficar varrendo histórico velho pra sempre.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._cron_check_pending_pix()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, net AS $$
DECLARE
  v_order sunset.orders%ROWTYPE;
BEGIN
  FOR v_order IN
    SELECT * FROM sunset.orders
    WHERE payment_method = 'pix' AND payment_status <> 'pago' AND pix_payment_id IS NOT NULL
      AND created_at::timestamptz > now() - interval '2 days'
  LOOP
    PERFORM net.http_post(
      url := 'https://sunset-tabas.vercel.app/api/pix-check',
      body := jsonb_build_object('order_id', v_order.id),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sunset_pix_backstop') THEN
    PERFORM cron.unschedule('sunset_pix_backstop');
  END IF;
END $$;

SELECT cron.schedule('sunset_pix_backstop', '* * * * *', $$SELECT sunset._cron_check_pending_pix();$$);

NOTIFY pgrst, 'reload schema';
