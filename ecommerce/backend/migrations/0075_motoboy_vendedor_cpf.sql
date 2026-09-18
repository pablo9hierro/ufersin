-- CPF do funcionário -- obrigatório só no auto-cadastro via convite (ver
-- employee_invites.rs), nullable aqui pra não quebrar cadastros manuais já
-- existentes (feitos pelo admin, que não pede CPF).
ALTER TABLE motoboys ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS cpf TEXT;
