-- Tipo do cartão (crédito/débito) e parcelas escolhidas pelo lojista no
-- PDV ANTES de abrir a cobrança (NFC/link/transparente) — puramente
-- informativo/registro (a Mercado Pago decide o processamento de verdade
-- em link/transparente; NFC é confirmado na maquininha física). Aditivo,
-- não mexe em nenhuma coluna existente.
ALTER TABLE orders
    ADD COLUMN card_type TEXT CHECK (card_type IS NULL OR card_type IN ('credito', 'debito')),
    ADD COLUMN card_installments INT CHECK (card_installments IS NULL OR card_installments >= 1);
