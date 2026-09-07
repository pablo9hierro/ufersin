-- Essential é o UNICO plano ativo do ramo ecommerce hoje (management/premium
-- nao existem mais como planos separados) -- a lista de features do card
-- unico na landing tinha que citar TUDO que a Resolutoo oferece pro ramo,
-- nao só um subconjunto pensado pra tier de entrada. Uber Direct e Mercado
-- Pago Point sao carro-chefe e nao podiam ficar de fora do unico card.
UPDATE platform_plans SET features = '["Catálogo de produto e serviço", "Catálogo de serviços com ficha técnica", "Checkout", "Pix e Mercado Pago Point", "Nota fiscal automática", "Uber Direct", "PDV com comandas e estoque", "Assistente de IA no WhatsApp", "Pedidos"]'::jsonb
  WHERE code = 'essential';
