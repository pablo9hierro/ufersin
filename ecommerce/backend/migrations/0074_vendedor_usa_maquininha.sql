-- Mesma pergunta que já existe pra motoboy (usa_maquininha), agora também
-- pra vendedor -- reaproveita o singleton por tenant já existente em vez de
-- criar tabela nova. Não restringe nada sozinho: o Point de vendedor
-- continua funcionando por PdvUser como sempre funcionou; isso é só a
-- preferência exibida/editável no cadastro.
ALTER TABLE motoboy_payroll_config
  ADD COLUMN IF NOT EXISTS vendedor_usa_maquininha BOOLEAN NOT NULL DEFAULT false;
