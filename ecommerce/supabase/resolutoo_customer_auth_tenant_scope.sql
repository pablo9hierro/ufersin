-- resolutoo.customers ganhou uma coluna tenant_id (text, NOT NULL) fora de
-- qualquer migração rastreada neste repo -- provavelmente adicionada direto
-- pelo Table Editor do Supabase quando o resto da plataforma virou
-- multi-tenant. Nenhuma das funções de auth de cliente
-- (customer_register/customer_login/_create_customer_reset_code/
-- customer_verify_reset_code/customer_reset_password) foi atualizada pra
-- preencher/filtrar por ela -- resultado: TODO cadastro de cliente falhava
-- com "null value in column tenant_id violates not-null constraint", e as
-- buscas por whatsapp eram GLOBAIS (sem filtro de loja nenhum).
--
-- Duas lojas diferentes com o mesmo cliente cadastrado (mesmo whatsapp)
-- colidiam: a segunda loja a se cadastrar batia em "this whatsapp is
-- already registered" (linha da primeira loja) mesmo sendo lojas
-- diferentes, e login/recuperação de senha de uma loja encontrava conta de
-- outra loja. Este arquivo escopa todas essas funções por tenant.
--
-- Pegadinha adicional encontrada ao aplicar isso: a coluna tenant_id tinha
-- FK pra `resolutoo.tenants` -- mas essa tabela é lixo/scaffolding vazio
-- (só 2 linhas: "tenant_resolutoo" e "tenant_jubilados", nada a ver com
-- lojas reais). A tabela de verdade, que o backend Rust (ecommerce/backend,
-- role sunset_svc2, search_path "sunset, public") realmente usa pra
-- resolver slug -> tenant, é `sunset.tenants`. Este arquivo:
--   1. derruba a FK errada (customers_tenant_id_fkey -> resolutoo.tenants)
--   2. usa `sunset.tenants` (a tabela real) pra resolver slug -> id
-- (GRANT USAGE ON SCHEMA sunset + SELECT ON sunset.tenants pra
-- resolutoo_svc já aplicado separadamente, necessário pra essas funções
-- conseguirem ler essa tabela cross-schema).
--
-- Convenção adotada aqui: funções chamadas direto do navegador (register/
-- login/verify/reset) recebem p_tenant_slug (o front já tem o slug da URL,
-- ?tenant=xibata) e resolvem o id internamente via sunset.tenants. A função
-- chamada só pelo backend Rust (_create_customer_reset_code) recebe
-- p_tenant_id direto, porque o Rust já resolveu isso via tenant::tenant_for_slug
-- pra mandar a mensagem no WhatsApp da loja certa -- reaproveita em vez de
-- fazer o Supabase resolver de novo.

ALTER TABLE resolutoo.customers DROP CONSTRAINT IF EXISTS customers_tenant_id_fkey;

CREATE OR REPLACE FUNCTION resolutoo.customer_register(
  p_whatsapp text, p_password text, p_name text, p_email text, p_birthdate text, p_tenant_slug text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'resolutoo', 'public', 'extensions'
AS $function$
DECLARE
  v_id text;
  v_tenant_id text;
  v_existing resolutoo.customers%ROWTYPE;
  v_token text;
BEGIN
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF p_whatsapp IS NULL OR length(regexp_replace(p_whatsapp, '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'a valid whatsapp is required';
  END IF;
  IF trim(coalesce(p_email, '')) = '' THEN
    RAISE EXCEPTION 'email is required';
  END IF;
  IF trim(coalesce(p_birthdate, '')) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  IF p_password !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'password must be exactly 4 digits';
  END IF;

  SELECT id INTO v_tenant_id FROM sunset.tenants WHERE slug = p_tenant_slug;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'store not found';
  END IF;

  SELECT * INTO v_existing FROM resolutoo.customers WHERE whatsapp = p_whatsapp AND tenant_id = v_tenant_id;
  IF FOUND THEN
    IF v_existing.password_hash IS NOT NULL THEN
      RAISE EXCEPTION 'this whatsapp is already registered';
    END IF;
    v_id := v_existing.id;
    UPDATE resolutoo.customers SET
      name = trim(p_name), email = trim(p_email), birthdate = p_birthdate,
      password_hash = crypt(p_password, gen_salt('bf'))
    WHERE id = v_id;
  ELSE
    v_id := gen_random_uuid()::text;
    INSERT INTO resolutoo.customers (id, name, whatsapp, email, birthdate, password_hash, tenant_id, created_at)
    VALUES (v_id, trim(p_name), p_whatsapp, trim(p_email), p_birthdate, crypt(p_password, gen_salt('bf')), v_tenant_id, now()::text);
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO resolutoo.sessions (token, role, subject_id, expires_at) VALUES (v_token, 'customer', v_id, now() + interval '30 days');

  RETURN jsonb_build_object('token', v_token, 'customer', resolutoo._customer_json(v_id));
END;
$function$;

CREATE OR REPLACE FUNCTION resolutoo.customer_login(p_whatsapp text, p_password text, p_tenant_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'resolutoo', 'public', 'extensions'
AS $function$
DECLARE
  v_c resolutoo.customers%ROWTYPE;
  v_tenant_id text;
  v_token text;
BEGIN
  SELECT id INTO v_tenant_id FROM sunset.tenants WHERE slug = p_tenant_slug;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  SELECT * INTO v_c FROM resolutoo.customers WHERE whatsapp = p_whatsapp AND tenant_id = v_tenant_id;
  IF NOT FOUND OR v_c.password_hash IS NULL OR v_c.password_hash <> crypt(p_password, v_c.password_hash) THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO resolutoo.sessions (token, role, subject_id, expires_at) VALUES (v_token, 'customer', v_c.id, now() + interval '30 days');

  RETURN jsonb_build_object('token', v_token, 'customer', resolutoo._customer_json(v_c.id));
END;
$function$;

-- Chamada só pelo backend Rust (service_role, via PostgREST) -- p_tenant_id
-- já vem resolvido de lá (ver ecommerce/backend/src/routes/public.rs::
-- request_customer_password_reset), sem GRANT pra anon/authenticated.
CREATE OR REPLACE FUNCTION resolutoo._create_customer_reset_code(p_whatsapp text, p_tenant_id text)
 RETURNS TABLE(customer_id text, customer_name text, code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'resolutoo', 'public', 'extensions'
AS $function$
DECLARE
  v_c resolutoo.customers%ROWTYPE;
  v_code text;
BEGIN
  SELECT * INTO v_c FROM resolutoo.customers WHERE whatsapp = p_whatsapp AND tenant_id = p_tenant_id AND password_hash IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer not found';
  END IF;

  v_code := lpad(floor(random() * 1000)::int::text, 3, '0');
  INSERT INTO resolutoo.customer_password_resets (id, customer_id, code, expires_at)
  VALUES (gen_random_uuid()::text, v_c.id, v_code, now() + interval '10 minutes');

  RETURN QUERY SELECT v_c.id, v_c.name, v_code;
END;
$function$;

CREATE OR REPLACE FUNCTION resolutoo.customer_verify_reset_code(p_whatsapp text, p_code text, p_tenant_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'resolutoo', 'public', 'extensions'
AS $function$
DECLARE
  v_c resolutoo.customers%ROWTYPE;
  v_tenant_id text;
  v_reset resolutoo.customer_password_resets%ROWTYPE;
BEGIN
  SELECT id INTO v_tenant_id FROM sunset.tenants WHERE slug = p_tenant_slug;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  SELECT * INTO v_c FROM resolutoo.customers WHERE whatsapp = p_whatsapp AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  SELECT * INTO v_reset FROM resolutoo.customer_password_resets
    WHERE customer_id = v_c.id AND code = p_code AND used = false AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  RETURN jsonb_build_object('valid', true);
END;
$function$;

CREATE OR REPLACE FUNCTION resolutoo.customer_reset_password(p_whatsapp text, p_code text, p_new_password text, p_tenant_slug text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'resolutoo', 'public', 'extensions'
AS $function$
DECLARE
  v_c resolutoo.customers%ROWTYPE;
  v_tenant_id text;
  v_reset resolutoo.customer_password_resets%ROWTYPE;
BEGIN
  IF p_new_password !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'password must be exactly 4 digits';
  END IF;

  SELECT id INTO v_tenant_id FROM sunset.tenants WHERE slug = p_tenant_slug;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  SELECT * INTO v_c FROM resolutoo.customers WHERE whatsapp = p_whatsapp AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  SELECT * INTO v_reset FROM resolutoo.customer_password_resets
    WHERE customer_id = v_c.id AND code = p_code AND used = false AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  UPDATE resolutoo.customers SET password_hash = crypt(p_new_password, gen_salt('bf')) WHERE id = v_c.id;
  UPDATE resolutoo.customer_password_resets SET used = true WHERE id = v_reset.id;
  -- derruba sessões antigas — troca de senha invalida logins anteriores.
  DELETE FROM resolutoo.sessions WHERE role = 'customer' AND subject_id = v_c.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION resolutoo.customer_register(text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION resolutoo.customer_login(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION resolutoo.customer_verify_reset_code(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION resolutoo.customer_reset_password(text, text, text, text) TO anon, authenticated;
