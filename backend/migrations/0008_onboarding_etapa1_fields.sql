-- Etapa 1 onboarding: Instagram + número do endereço (rua fica em `endereco`).
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS endereco_numero text;
