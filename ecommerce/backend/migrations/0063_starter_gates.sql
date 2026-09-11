-- Fecha os gaps reais encontrados pro plano Starter (master prompt de
-- reorganização do Starter, seção 3 "O que não faz parte"):
--
-- 1. `assistente_ia` e `servicos` nunca tiveram feature_code -- eram
--    capacidades DISPONÍVEIS PRA QUALQUER TENANT sem gate nenhum (achado
--    lendo webhooks.rs::forward_to_assistant_ia e admin.rs::list_services/
--    create_service/update_service/delete_service). Sem essa migration,
--    "Starter não tem Assistente IA/Serviços" seria só um texto de
--    marketing, não uma regra real -- o master prompt exige que seja
--    aplicado no backend, nunca só escondido no frontend.
-- 2. Correção de rota própria: a migration 0062 (criação do plano Starter)
--    tinha excluído `whatsapp` por engano -- o master prompt confirma que
--    o Starter PRECISA de notificação de status por WhatsApp (é só o
--    encaminhamento pro serviço de Assistente IA que fica de fora, feature
--    diferente).
--
-- Backfill em TODOS os planos que já tinham `catalogo` (essential,
-- management, premium, eletronica) -- preserva 100% o comportamento atual
-- deles (nenhum perde acesso a serviço/IA que já usava), só o Starter novo
-- fica de fora por não ter essas linhas.

INSERT INTO features (code, name, description) VALUES
  ('assistente_ia', 'Assistente de IA', 'Encaminha mensagem de WhatsApp recebida pro serviço de Assistente IA'),
  ('servicos', 'Catálogo de serviços', 'Cadastro e venda de serviços (distinto de produto)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO plan_features (plan_id, feature_code)
SELECT p.id, f.code
FROM plans p
CROSS JOIN (VALUES ('assistente_ia'), ('servicos')) AS f(code)
WHERE p.code IN ('essential', 'management', 'premium', 'eletronica')
ON CONFLICT DO NOTHING;

-- Corrige o Starter: adiciona `whatsapp` (notificação de status, sempre
-- deve ter) -- nunca adiciona `assistente_ia`/`servicos` (de propósito,
-- ficam de fora).
INSERT INTO plan_features (plan_id, feature_code)
VALUES ('plan_starter', 'whatsapp')
ON CONFLICT DO NOTHING;
