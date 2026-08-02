-- Extra CMS keys for Visual CMS tabs (demo + assinar). Safe to re-run.
INSERT INTO platform_content (key, value) VALUES
  ('demo.title', 'Escolha um plano pra ver por dentro'),
  ('demo.sub', 'Você vai acessar as páginas reais que vem com cada plano — vitrine, painel admin e área do motoboy — com dados de demonstração, exatamente como o assinante recebe.'),
  ('assinar.title', 'Escolha o ciclo e como pagar.'),
  ('assinar.sub', 'Preço cobrado vem do banco — cupons aplicam no servidor.')
ON CONFLICT (key) DO NOTHING;
