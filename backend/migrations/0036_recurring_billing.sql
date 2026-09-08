-- Cobranca recorrente da assinatura da plataforma. Ate aqui, a plataforma
-- so cobrava UMA VEZ (onboarding/reassinatura) e a loja ficava 'ativo' pra
-- sempre, sem nenhum campo de vencimento -- nao era bug, a funcionalidade
-- de renovacao mensal/semestral simplesmente nunca existiu (ver auditoria
-- que motivou esta migration: loja "top-motos" nunca foi cobrada de novo).
--
-- Regras implementadas (ver src/billing.rs):
-- 1. valor_mensal ja e o valor "honrado" (travado no momento da assinatura,
--    com cupom aplicado se houver) -- a cobranca de renovacao usa esse
--    valor exato, nunca recalcula pelo preco de tabela atual.
-- 2. No vencimento (next_billing_at), gera uma cobranca Pix nova, marca a
--    loja como 'pausado' (bloqueia o painel/vitrine -- reaproveita o mesmo
--    gate que ja existe pra loja inativa) e abre uma janela de 3 dias
--    uteis (billing_grace_until) pra pagar SEM perder o cupom.
-- 3. Pago dentro da janela: volta pra 'ativo', valor_mensal e cupom
--    intactos, next_billing_at avanca mais um ciclo.
-- 4. Vencida a janela sem pagar: vira 'cancelado' e perde qualquer cupom
--    (proxima assinatura usa o preco de tabela do momento).
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS next_billing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_grace_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_billed_at TIMESTAMPTZ;

-- Historico de cobrancas de renovacao (a cobranca inicial do onboarding
-- continua sem registro aqui -- so a partir da primeira renovacao).
CREATE TABLE IF NOT EXISTS subscriber_invoices (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL,
  billing_cycle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente | pago | expirado
  gateway TEXT NOT NULL DEFAULT 'mercadopago',
  external_id TEXT,
  due_date TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriber_invoices_subscriber ON subscriber_invoices(subscriber_id);

-- Backfill: assinantes ja ativos nunca tiveram next_billing_at -- sem isso
-- o job novo nunca os selecionaria (NULL <= now() e falso em SQL) e
-- ninguem jamais seria cobrado de novo, perpetuando o problema atual.
-- 1 mes (ou 6 se semestral) apos a ultima atualizacao e a melhor estimativa
-- disponivel do ciclo real de cada um.
UPDATE subscribers
SET next_billing_at = updated_at + CASE WHEN billing_cycle = 'semestral' THEN INTERVAL '6 months' ELSE INTERVAL '1 month' END
WHERE status = 'ativo' AND next_billing_at IS NULL;
