-- Nonce efêmero do OAuth do Mercado Pago (CSRF `state` -> assinante).
-- Curto de propósito: consumido (deletado) no callback, expira sozinho.
CREATE TABLE IF NOT EXISTS mercadopago_oauth_states (
  state TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
