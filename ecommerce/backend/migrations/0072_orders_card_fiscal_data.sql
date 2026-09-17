-- Grupo <card> da NFC-e (NT 2025.001, rejeicao 391/392) exige bandeira e
-- codigo de autorizacao da operadora quando o pagamento e cartao/PIX
-- integrado -- confirmado que a SEFAZ-PB ja valida isso (ativo desde antes
-- de jul/2024 pra cartao, set/2025 tambem pra PIX dinamico), e a regra e
-- opcional por estado sem aviso publico centralizado, entao tratamos como
-- sempre preenchido quando disponivel. Dados nunca eram capturados antes
-- (nem no checkout transparente nem no Point/PDV fisico).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS card_brand TEXT,
  ADD COLUMN IF NOT EXISTS card_authorization_code TEXT;
