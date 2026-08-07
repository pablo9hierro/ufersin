-- Conta Mercado Pago da PROPRIA Resolutoo (recebe as assinaturas dos
-- lojistas) — totalmente separada da conta Mercado Pago de cada lojista
-- (essa fica em subscribers.plataforma_credenciais, recebe as vendas da
-- loja dele). Linha unica ('default'): so existe uma conta recebedora de
-- assinaturas na plataforma inteira.
CREATE TABLE IF NOT EXISTS platform_payment_credentials (
    id TEXT PRIMARY KEY DEFAULT 'default',
    provider TEXT NOT NULL DEFAULT 'mercado_pago',
    credenciais JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_payment_credentials (id, provider, credenciais)
VALUES ('default', 'mercado_pago', NULL)
ON CONFLICT (id) DO NOTHING;

-- Estados OAuth (CSRF) do fluxo do SUPERADMIN — separado de
-- mercadopago_oauth_states (que e por subscriber_id/lojista), pra nunca
-- misturar os dois fluxos de autorizacao.
CREATE TABLE IF NOT EXISTS platform_mercadopago_oauth_states (
    state TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
