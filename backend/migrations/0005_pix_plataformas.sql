-- Pix automático do lojista: só Mercado Pago ou AbacatePay.
-- Quem tinha PagBank volta pra cobrança manual (credenciais PagBank não
-- servem nas outras plataformas).

UPDATE subscribers
SET forma_pagamento = 'manual',
    plataforma_pagamento = NULL,
    plataforma_credenciais = NULL
WHERE plataforma_pagamento = 'pagbank';

ALTER TABLE subscribers DROP CONSTRAINT IF EXISTS subscribers_plataforma_pagamento_check;
ALTER TABLE subscribers ADD CONSTRAINT subscribers_plataforma_pagamento_check
  CHECK (plataforma_pagamento IS NULL OR plataforma_pagamento IN ('mercado_pago', 'abacate_pay'));
