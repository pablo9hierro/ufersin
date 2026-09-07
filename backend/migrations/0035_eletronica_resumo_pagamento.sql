-- "PDV com comandas e Pix" + "Mercado Pago Point" viravam duas linhas
-- separadas falando de pagamento -- resume em "Pix e Mercado Pago Point"
-- (mesmo padrão já usado no card do Essential), card fica mais enxuto.
UPDATE platform_plans SET features = '["Ordem de serviço", "Diagnóstico e orçamento", "Catálogo de serviços com ficha técnica", "Estoque de peças com garantia", "Agenda de coleta e entrega", "Uber Direct", "PDV com comandas", "Pix e Mercado Pago Point", "Nota fiscal automática", "Assistente de IA no WhatsApp"]'::jsonb
  WHERE code = 'eletronica';
