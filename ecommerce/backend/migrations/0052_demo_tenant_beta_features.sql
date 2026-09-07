-- Liga as features beta (fiscal, Uber Direct, Mercado Pago Point) só pros
-- tenants demo publicos (demo-ecommerce/demo-eletronica) -- sem isso, o
-- preview 1:1 da landing (SystemsShowcase.tsx, iframe autenticado contra o
-- tenant demo real) mostrava "recurso não disponível" em vez da tela real.
-- Nunca liga pra tenant nenhum além desses dois, hardcoded por slug.
INSERT INTO feature_flags (id, tenant_id, feature_code, enabled)
SELECT gen_random_uuid()::text, t.id, f.code, true
FROM tenants t
CROSS JOIN (VALUES ('emissao_fiscal'), ('mercadopago_point'), ('entrega_terceirizada')) AS f(code)
WHERE t.slug IN ('demo-ecommerce', 'demo-eletronica')
ON CONFLICT (tenant_id, feature_code) DO UPDATE SET enabled = true;
