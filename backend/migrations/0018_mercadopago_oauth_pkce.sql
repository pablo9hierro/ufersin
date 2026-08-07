-- PKCE (RFC 7636) no fluxo de OAuth do Mercado Pago -- code_verifier fica
-- guardado ao lado do state até o callback, pra mandar junto na troca por
-- token (código de autorização sozinho não é mais suficiente se a
-- aplicação do lojista tiver PKCE habilitado no painel da Mercado Pago).
ALTER TABLE mercadopago_oauth_states ADD COLUMN IF NOT EXISTS code_verifier TEXT NOT NULL DEFAULT '';
