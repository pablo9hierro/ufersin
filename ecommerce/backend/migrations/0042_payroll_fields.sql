-- Frequência/valor de pagamento fixo pra motoboy e vendedor (diária/semanal/
-- quinzenal/mensal) -- separado da comissão por entrega/venda, que já existe
-- (motoboys: 100% da taxa de frete por entrega, sempre; vendedores:
-- commission_percent, opcional). Cozinha não tem nenhum desses campos --
-- conta só de acesso à tela, sem remuneração controlada pelo sistema.
ALTER TABLE motoboys
  ADD COLUMN IF NOT EXISTS payment_frequency TEXT CHECK (payment_frequency IN ('diaria', 'semanal', 'quinzenal', 'mensal')),
  ADD COLUMN IF NOT EXISTS payment_fixed_value DOUBLE PRECISION;

ALTER TABLE vendedores
  ADD COLUMN IF NOT EXISTS payment_frequency TEXT CHECK (payment_frequency IN ('diaria', 'semanal', 'quinzenal', 'mensal')),
  ADD COLUMN IF NOT EXISTS payment_fixed_value DOUBLE PRECISION;
