-- Etapa 2 do projeto de perfis fiscais: coluna real pra `contribuinte_icms`
-- do contexto de venda (ate agora sempre hardcoded `false` em
-- OperationContext, ver TODO(fiscal-part-2) em resolution.rs e fiscal.rs).
-- Default `false` e a suposicao mais segura (nao-contribuinte/consumidor
-- final) quando o lojista/cliente nao informa nada -- preserva 100% o
-- comportamento atual pra quem nao usa esse campo novo.
ALTER TABLE orders ADD COLUMN destinatario_contribuinte_icms BOOLEAN NOT NULL DEFAULT false;
