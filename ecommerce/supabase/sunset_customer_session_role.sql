-- sessions_role_check só permitia admin/motoboy/vendedor — bloqueava TODO
-- login/cadastro de cliente com "new row for relation sessions violates
-- check constraint sessions_role_check". Adiciona 'customer' à lista.
ALTER TABLE sunset.sessions DROP CONSTRAINT IF EXISTS sessions_role_check;
ALTER TABLE sunset.sessions ADD CONSTRAINT sessions_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'motoboy'::text, 'vendedor'::text, 'customer'::text]));
