-- Lista de features exibida nos cards de assinatura/demo estava
-- desatualizada (faltava nota fiscal, Uber Direct, Mercado Pago Point,
-- catalogo de servico, ficha tecnica/formulacao). Uber Direct citado pelo
-- nome de proposito -- e um carro-chefe do produto, nao pode ficar generico.
UPDATE platform_plans SET features = '["Catálogo de produto e serviço", "Checkout", "Pix", "Nota fiscal automática", "WhatsApp", "Pedidos"]'::jsonb
  WHERE code = 'essential';

UPDATE platform_plans SET features = '["Tudo do Essential", "Funcionários", "Motoboy", "Uber Direct", "Banner promocional", "Comissões"]'::jsonb
  WHERE code = 'management';

UPDATE platform_plans SET features = '["Tudo do Management", "Mercado Pago Point", "CRM completo", "Segmentações", "Automações", "Cupons", "Campanhas", "Relatórios"]'::jsonb
  WHERE code = 'premium';

UPDATE platform_plans SET features = '["Ordem de serviço", "Diagnóstico e orçamento", "Catálogo de serviços com ficha técnica", "Estoque de peças com garantia", "Agenda de coleta e entrega", "Uber Direct", "PDV com comandas e Pix", "Mercado Pago Point", "Nota fiscal automática", "Assistente de IA no WhatsApp"]'::jsonb
  WHERE code = 'eletronica';
