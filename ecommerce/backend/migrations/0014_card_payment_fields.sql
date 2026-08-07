-- Cartao real (nao mais so "paga por fora"): 3 modos, aditivo, sem tocar
-- em payment_method/pix_* existentes.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS card_payment_mode TEXT
  CHECK (card_payment_mode IS NULL OR card_payment_mode IN ('nfc','link','transparente'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS card_payment_link_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS card_payment_charge_id TEXT;
