-- Campos do onboarding específico do plano Essential (ver conversa: "o
-- formulário de onboarding do plano essential é diferente dos outros
-- planos"). Ficam em `subscribers` -- mesma tabela que já guarda o resto
-- do onboarding (categoria/endereco/logo_url/cor_principal, ver
-- 0002_platform_accounts.sql) -- em vez de uma tabela nova, pra não
-- duplicar o "dono" do onboarding por assinante.

ALTER TABLE subscribers ADD COLUMN documento text;
ALTER TABLE subscribers ADD COLUMN tipo_documento text CHECK (tipo_documento IN ('cnpj', 'cpf'));

-- Se false: as páginas públicas do cliente (landing/catálogo/carrinho/
-- checkout) do motor de e-commerce ficam bloqueadas (404) pra esse
-- tenant -- ele só usa o admin+PDV internamente. Também controla se
-- "Pedidos" aparece no menu do admin dele.
ALTER TABLE subscribers ADD COLUMN vender_externamente boolean NOT NULL DEFAULT true;

-- Se false: nenhuma instância de Evolution API é provisionada pro tenant
-- e a seção de conectar WhatsApp some de /admin/configuracoes lá.
ALTER TABLE subscribers ADD COLUMN whatsapp_habilitado boolean NOT NULL DEFAULT true;

-- 'manual': o lojista cobra/recebe por conta própria (Pix copia-e-cola
-- manual, maquininha, dinheiro) e dá baixa manual em cada venda -- o PDV/
-- Pedidos ganham um toggle "confirmar recebimento" nesse caso.
-- 'plataforma': o motor gera QR Pix de verdade via a plataforma
-- cadastrada abaixo; cartão/dinheiro continuam sempre manuais, isso não
-- muda com a plataforma.
ALTER TABLE subscribers ADD COLUMN forma_pagamento text NOT NULL DEFAULT 'manual'
  CHECK (forma_pagamento IN ('manual', 'plataforma'));
ALTER TABLE subscribers ADD COLUMN plataforma_pagamento text
  CHECK (plataforma_pagamento IN ('mercado_pago', 'pagbank', 'abacate_pay'));
-- Credenciais da plataforma de pagamento DO LOJISTA (chave API etc,
-- nunca as credenciais da própria Rodoletas) -- jsonb pra caber o
-- formato de cada plataforma sem 3 colunas fixas diferentes. Nunca
-- exposto no endpoint público de tenant-config, só no /api/me
-- autenticado do próprio assinante.
ALTER TABLE subscribers ADD COLUMN plataforma_credenciais jsonb;

ALTER TABLE subscribers ADD CONSTRAINT subscribers_plataforma_pagamento_requer_forma
  CHECK (forma_pagamento = 'manual' OR plataforma_pagamento IS NOT NULL);
