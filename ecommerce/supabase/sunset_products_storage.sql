-- =====================================================
-- Sunset Tabas — bucket de imagens de produto.
--
-- O upload em si passa pelo backend Rust (usa a service_role key,
-- que ignora RLS) — só precisa dessa policy pra leitura pública
-- funcionar (o <img src=...> do navegador do cliente/admin).
-- =====================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('sunset-products', 'sunset-products', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "sunset_public_read_products" ON storage.objects;
CREATE POLICY "sunset_public_read_products" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'sunset-products');
