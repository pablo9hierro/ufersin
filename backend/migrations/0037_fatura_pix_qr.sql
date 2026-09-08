-- Guarda o QR Pix da fatura de renovação -- sem isso, a tela persistente
-- de cobrança do painel da loja (bloqueada em 'pausado') não teria como
-- mostrar o QR pro lojista pagar: o código só existia na resposta HTTP do
-- momento em que o job gerou a cobrança, nunca era persistido.
ALTER TABLE subscriber_invoices
  ADD COLUMN IF NOT EXISTS pix_qr_code TEXT,
  ADD COLUMN IF NOT EXISTS pix_qr_base64 TEXT;
