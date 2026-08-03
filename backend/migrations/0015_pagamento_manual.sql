-- Preferência /meu-plano: modo pagamento manual (confirmação offline).
-- Quando true, vitrine/painel usam toggles de confirmação e checkout sem QR Pix,
-- mesmo se houver credenciais de plataforma salvas.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS pagamento_manual BOOLEAN NOT NULL DEFAULT false;

-- Feedback de cancelamento de assinatura (motivos multi-select + textos).
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS cancel_reasons jsonb,
  ADD COLUMN IF NOT EXISTS cancel_note text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_refund_status text
    CHECK (
      cancel_refund_status IS NULL
      OR cancel_refund_status IN ('none', 'not_applicable', 'pending', 'refunded', 'refund_failed')
    ),
  ADD COLUMN IF NOT EXISTS cancel_refund_id text;
