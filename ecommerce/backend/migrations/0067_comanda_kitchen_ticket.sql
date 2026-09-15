-- Impressão térmica de comanda -> cozinha (Etapa 4).
-- `sent_to_kitchen_at` marca quando um item foi impresso/enviado (idempotente:
-- reimprimir só pega o que ainda está NULL). `kitchen_ticket_status` resume o
-- estado do ticket pra tela de cozinha:
--   'nenhum'   -- nunca imprimiu, ou já voltou a não ter nada pendente
--   'pendente' -- tem item(ns) enviado(s) aguardando a cozinha marcar pronto
--   'pronto'   -- cozinha marcou pronto (fica assim até nova impressão criar
--                 itens pendentes de novo, ver print_kitchen_ticket)
ALTER TABLE comanda_items ADD COLUMN IF NOT EXISTS sent_to_kitchen_at TIMESTAMPTZ NULL;
ALTER TABLE comandas ADD COLUMN IF NOT EXISTS kitchen_ticket_status TEXT NOT NULL DEFAULT 'nenhum'
  CHECK (kitchen_ticket_status IN ('nenhum', 'pendente', 'pronto'));
