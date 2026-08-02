-- Módulo de contratos Resolutoo (PandaDoc-ready).
-- Cláusulas ficam no PandaDoc; aqui: catálogo, versões, vias e aceites locais.

ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS vende_mais_18 BOOLEAN NOT NULL DEFAULT false;

-- Catálogo de templates (1 linha lógica por kind+category; versões em contract_template_versions)
CREATE TABLE IF NOT EXISTS contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- platform_subscription | checkout_compra_normal | checkout_mais18
  kind TEXT NOT NULL CHECK (kind IN (
    'platform_subscription',
    'checkout_compra_normal',
    'checkout_mais18'
  )),
  title TEXT NOT NULL,
  description TEXT,
  -- ID do template no PandaDoc (preencher quando a conta/sandbox estiver pronta)
  pandadoc_template_id TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind)
);

CREATE TABLE IF NOT EXISTS contract_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES contract_templates(id) ON DELETE CASCADE,
  version INT NOT NULL CHECK (version >= 1),
  -- Snapshot opcional do conteúdo / notas; cláusulas oficiais no PandaDoc
  notes TEXT,
  pandadoc_template_id TEXT,
  -- draft | published | retired
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

-- Documento gerado / via assinada (instância por assinante ou pedido)
CREATE TABLE IF NOT EXISTS contract_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_version_id UUID NOT NULL REFERENCES contract_template_versions(id),
  kind TEXT NOT NULL,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  tenant_slug TEXT,
  -- Referência opcional ao pedido no motor ecommerce (string)
  order_ref TEXT,
  signer_email TEXT,
  signer_name TEXT,
  -- draft | sent | viewed | completed | voided | declined | stub
  status TEXT NOT NULL DEFAULT 'stub' CHECK (status IN (
    'stub', 'draft', 'sent', 'viewed', 'completed', 'voided', 'declined'
  )),
  pandadoc_document_id TEXT,
  pandadoc_share_link TEXT,
  signed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_documents_subscriber
  ON contract_documents (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_contract_documents_kind_status
  ON contract_documents (kind, status);

-- Aceite local (checkbox Resolutoo) — válido mesmo sem PandaDoc ligado
CREATE TABLE IF NOT EXISTS contract_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN (
    'platform_subscription',
    'checkout_compra_normal',
    'checkout_mais18'
  )),
  template_version_id UUID REFERENCES contract_template_versions(id) ON DELETE SET NULL,
  document_id UUID REFERENCES contract_documents(id) ON DELETE SET NULL,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  tenant_slug TEXT,
  order_ref TEXT,
  acceptor_role TEXT NOT NULL CHECK (acceptor_role IN ('lojista', 'cliente')),
  acceptor_email TEXT,
  acceptor_name TEXT,
  accepted BOOLEAN NOT NULL DEFAULT true,
  ip INET,
  user_agent TEXT,
  -- checkbox | pandadoc_embedded | pandadoc_redirect
  channel TEXT NOT NULL DEFAULT 'checkbox',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_acceptances_subscriber
  ON contract_acceptances (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_contract_acceptances_tenant
  ON contract_acceptances (tenant_slug);

-- Seeds: templates vazios (sem cláusulas) — versão 1 draft
INSERT INTO contract_templates (kind, title, description)
VALUES
  (
    'platform_subscription',
    'Contrato de assinatura Resolutoo',
    'Contrato lojista × plataforma na assinatura do plano. Cláusulas a formular.'
  ),
  (
    'checkout_compra_normal',
    'Consentimento de compra',
    'Termos gerais do checkout do cliente. Cláusulas a formular.'
  ),
  (
    'checkout_mais18',
    'Consentimento compra para maiores de 18',
    'Termos adicionais quando a loja vende produtos 18+. Cláusulas a formular.'
  )
ON CONFLICT (kind) DO NOTHING;

INSERT INTO contract_template_versions (template_id, version, notes, status)
SELECT t.id, 1, 'Placeholder — cláusulas ainda não formuladas.', 'draft'
FROM contract_templates t
WHERE NOT EXISTS (
  SELECT 1 FROM contract_template_versions v WHERE v.template_id = t.id AND v.version = 1
);
