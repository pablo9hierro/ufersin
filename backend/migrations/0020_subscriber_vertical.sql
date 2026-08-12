-- Espelha tenants.vertical (ecommerce/backend) aqui pra /api/me devolver
-- sem precisar de uma chamada cross-service — fonte de verdade continua
-- sendo o tenant, isso é só cache de leitura gravado no onboarding.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS vertical TEXT NOT NULL DEFAULT 'ecommerce'
    CHECK (vertical IN ('ecommerce', 'eletronicos'));
