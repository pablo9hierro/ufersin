-- Conceito de "vertical" do tenant — distinto de "plano" (tier de preço).
-- Decide qual módulo/frontend atende o tenant: o motor de e-commerce
-- genérico (uiux2/3/4 + AdminLayout, ramo 'ecommerce') ou um módulo isolado
-- por ramo de negócio (ex: 'eletronicos' — assistência técnica, schema e
-- frontend próprios, só consome catálogo/pedido/pagamento em comum via API
-- pública deste motor). Default 'ecommerce' preserva o comportamento atual
-- de todo tenant existente.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS vertical TEXT NOT NULL DEFAULT 'ecommerce'
    CHECK (vertical IN ('ecommerce', 'eletronicos'));
