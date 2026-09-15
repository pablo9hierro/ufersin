-- Etapa 2 / Parte 4 — a configuração de funcionários sai da plataforma e vai
-- pro admin da loja (/admin/motoboys). A plataforma passa a perguntar só duas
-- coisas guarda-chuva no onboarding/Meu Plano:
--   tem_funcionarios  -> a loja vai ter alguém além do dono
--   estilo_operacao   -> 'restaurante' (garçom/cozinha/mesas) ou 'loja'
-- Os três booleanos antigos (tem_motoboy_proprio / precisa_vendedor /
-- precisa_tela_cozinha) CONTINUAM existindo e sendo lidos por todo o motor
-- (AdminMotoboys, Checkout, AdminPedidos...) — só mudam de lugar de edição:
-- agora vêm do admin da loja via /internal/tenant-employee-config.
--
-- As três colunas novas de preferência são consumidas pelas etapas seguintes
-- (impressão de comanda, mesas, terminal Point fixo).
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS tem_funcionarios boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estilo_operacao text NOT NULL DEFAULT 'loja',
  ADD COLUMN IF NOT EXISTS impressao_modo text NOT NULL DEFAULT 'nenhuma',
  ADD COLUMN IF NOT EXISTS usa_mesas boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS point_terminal_fixo boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  ALTER TABLE subscribers
    ADD CONSTRAINT subscribers_estilo_operacao_check
    CHECK (estilo_operacao IN ('restaurante', 'loja'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE subscribers
    ADD CONSTRAINT subscribers_impressao_modo_check
    CHECK (impressao_modo IN ('nenhuma', 'agente_local', 'navegador', 'ambos'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Quem já tinha marcado algum funcionário na plataforma não pode "perder" a
-- configuração: liga o guarda-chuva pra esses, e quem já usava tela de cozinha
-- claramente opera estilo restaurante.
UPDATE subscribers
   SET tem_funcionarios = true
 WHERE tem_motoboy_proprio OR precisa_vendedor OR precisa_tela_cozinha;

UPDATE subscribers SET estilo_operacao = 'restaurante' WHERE precisa_tela_cozinha;
