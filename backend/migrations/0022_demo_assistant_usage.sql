-- Contador de uso da demo pública de assistente de IA (landing page) —
-- protege contra custo ilimitado de API de LLM numa rota sem autenticação.
-- Isolada de qualquer schema de tenant/produto real: só serve pra contar
-- mensagens por sessão anônima (gerada no browser) e por IP, numa janela
-- de tempo. Nunca referencia subscribers/tenants/orders.
CREATE TABLE IF NOT EXISTS platform_demo_assistant_usage (
  session_id     text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('ecommerce', 'eletronicos')),
  client_ip      text NOT NULL,
  window_start   timestamptz NOT NULL DEFAULT now(),
  message_count  integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, kind)
);

CREATE INDEX IF NOT EXISTS platform_demo_assistant_usage_ip_window_idx
  ON platform_demo_assistant_usage (client_ip, window_start);
