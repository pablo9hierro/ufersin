-- Uma linha por lojista assinante da plataforma ufersin. Projeto Supabase
-- dedicado (não compartilhado com sunset/vrtech/juete), schema "public" padrão.
CREATE TABLE IF NOT EXISTS subscribers (
  id                     text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  loja_nome              text NOT NULL,
  responsavel_nome       text NOT NULL,
  whatsapp               text NOT NULL,
  email                  text NOT NULL,
  plano                  text NOT NULL DEFAULT 'padrao',
  valor_mensal           double precision NOT NULL,
  mp_preapproval_id      text,
  status                 text NOT NULL DEFAULT 'pendente', -- pendente | ativo | pausado | cancelado
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscribers_mp_preapproval_id ON subscribers (mp_preapproval_id);
