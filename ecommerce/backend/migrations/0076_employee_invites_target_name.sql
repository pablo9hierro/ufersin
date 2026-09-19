-- Lojista informa o nome junto com o WhatsApp ao gerar o convite (mensagem
-- personalizada + prefill na tela de cadastro do funcionário).
ALTER TABLE employee_invites ADD COLUMN IF NOT EXISTS target_name TEXT NOT NULL DEFAULT '';
