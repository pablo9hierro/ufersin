-- Emissao fiscal (NF-e/NFC-e) integrada ao modulo Jubilados (backend .NET
-- separado, ver src/fiscal/jubilados_client.rs). Espelha o padrao ja
-- estabelecido pelo modulo de entregas terceirizadas
-- (tenant_delivery_settings/delivery_provider_credentials, migration 0047).

INSERT INTO features (code, name, description) VALUES
  ('emissao_fiscal', 'Emissao fiscal', 'Emissao de NF-e/NFC-e na venda de produtos, via modulo Jubilados')
ON CONFLICT (code) DO NOTHING;

-- Dados fiscais do produto -- adicionados na propria tabela (nao e um
-- "FiscalProduct" separado, e o mesmo produto ganhando uma secao fiscal).
-- Tudo nullable: produto sem isso configurado simplesmente nao pode ser
-- emitido (nunca preenchido com valor inventado).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ncm TEXT,
  ADD COLUMN IF NOT EXISTS cfop TEXT,
  ADD COLUMN IF NOT EXISTS cst TEXT,
  ADD COLUMN IF NOT EXISTS csosn TEXT,
  ADD COLUMN IF NOT EXISTS cest TEXT,
  ADD COLUMN IF NOT EXISTS origem TEXT,
  ADD COLUMN IF NOT EXISTS unidade_fiscal TEXT,
  ADD COLUMN IF NOT EXISTS ean TEXT,
  -- Codigo oficial do Portal de Classificacao Tributaria (Reforma
  -- Tributaria/IBS-CBS) -- o Jubilados VALIDA isso contra a tabela oficial
  -- ao vivo (dfe-portal.svrs.rs.gov.br) antes de aceitar o produto, entao
  -- e obrigatorio de verdade, nao um campo qualquer inventado aqui.
  ADD COLUMN IF NOT EXISTS cclass_trib TEXT,
  -- Mapeamento pro produto espelhado no Jubilados (EmitirNFeDto.Itens
  -- referencia um ProdutoId real de la, nao aceita dados fiscais soltos).
  ADD COLUMN IF NOT EXISTS jubilados_produto_id UUID;

-- Config fiscal por tenant -- mesmo padrao de tenant_delivery_settings
-- (PK = tenant_id, flags direto, nada de JSON generico).
CREATE TABLE IF NOT EXISTS tenant_fiscal_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  jubilados_empresa_id UUID,
  ambiente TEXT NOT NULL DEFAULT 'homologacao' CHECK (ambiente IN ('homologacao', 'producao')),
  cfop_padrao_saida TEXT,
  -- Mesma semantica de tenant_delivery_settings.mode: manual = lojista
  -- clica "Emitir nota"; automatico = dispara sozinho quando o pedido e
  -- pago (webhooks.rs::handle_mercadopago).
  auto_emitir BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);

-- Uma nota por pedido. Indice unico parcial identico em espirito ao de
-- `deliveries` (migration 0047/0049): evita duas notas pro mesmo pedido em
-- corrida/retry -- so uma linha "ativa" (nao rejeitada/cancelada) por
-- order_id.
CREATE TABLE IF NOT EXISTS fiscal_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  modelo TEXT NOT NULL CHECK (modelo IN ('55', '65')),
  status TEXT NOT NULL DEFAULT 'processando' CHECK (status IN (
    'processando', 'autorizada', 'rejeitada', 'cancelada', 'erro'
  )),
  chave_acesso TEXT,
  protocolo TEXT,
  cstat TEXT,
  xmotivo TEXT,
  jubilados_nota_id UUID,
  xml_url TEXT,
  danfe_url TEXT,
  created_at TEXT NOT NULL DEFAULT (now()::text),
  updated_at TEXT NOT NULL DEFAULT (now()::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_documents_order_active
  ON fiscal_documents (order_id)
  WHERE status NOT IN ('rejeitada', 'cancelada');
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_tenant ON fiscal_documents (tenant_id);
