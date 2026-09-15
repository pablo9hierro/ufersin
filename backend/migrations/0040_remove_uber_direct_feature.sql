-- Uber Direct citado no card de plano (Management/Essential/Eletronica) foi
-- removido a pedido do dono -- migrations anteriores (0033-0035) tinham
-- colocado "Uber Direct" na lista `features` (jsonb) de platform_plans,
-- que é a fonte real servida por GET /api/public/plans (o código estático
-- de frontend/src/lib/plans.ts NAO é usado pelos cards reais da landing --
-- só documentação/fallback -- por isso editar só ele não tirava o texto do
-- ar). Reescreve as 3 linhas sem "Uber Direct", preservando o resto exatamente
-- como ficou depois de 0034/0035.
UPDATE platform_plans SET features = '["Catálogo de produto e serviço", "Catálogo de serviços com ficha técnica", "Checkout", "Pix e Mercado Pago Point", "Nota fiscal automática", "PDV com comandas e estoque", "Assistente de IA no WhatsApp", "Pedidos"]'::jsonb
  WHERE code = 'essential';

UPDATE platform_plans SET features = '["Tudo do Essential", "Funcionários", "Motoboy", "Banner promocional", "Comissões"]'::jsonb
  WHERE code = 'management';

UPDATE platform_plans SET features = '["Ordem de serviço", "Diagnóstico e orçamento", "Catálogo de serviços com ficha técnica", "Estoque de peças com garantia", "Agenda de coleta e entrega", "PDV com comandas", "Pix e Mercado Pago Point", "Nota fiscal automática", "Assistente de IA no WhatsApp"]'::jsonb
  WHERE code = 'eletronica';
