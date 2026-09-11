-- Bug real encontrado em teste de ponta a ponta (Paulo Ferro): uma emissão
-- que falha com status 'erro' (ex: config incompleta, empresa sem
-- certificado) ficava travando pra sempre qualquer nova tentativa de
-- emissão pro mesmo pedido -- o índice único parcial só liberava retry
-- pra 'rejeitada'/'cancelada', nunca pra 'erro' (que é claramente um
-- estado transitório/recuperável, não um estado final).
DROP INDEX IF EXISTS idx_fiscal_documents_order_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_documents_order_active
  ON fiscal_documents (order_id)
  WHERE status NOT IN ('rejeitada', 'cancelada', 'erro');
