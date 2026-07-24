-- Login de cliente por whatsapp+senha (PIN numérico de 4 dígitos, igual o
-- código de recuperação por WhatsApp é de 3 dígitos). Mesmo padrão de
-- admin_login/vendedor_login/motoboy_login: pgcrypto crypt() + sunset.sessions
-- (role='customer'). sunset.customers já existe (linhas criadas hoje pelo
-- checkout sem senha nenhuma) — registro faz UPSERT por whatsapp em vez de
-- sempre inserir, pra não duplicar quem já tem pedido feito antes de logar.
ALTER TABLE sunset.customers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE sunset.customers ADD COLUMN IF NOT EXISTS password_hash text;

-- Código de recuperação de senha (3 dígitos, enviado por WhatsApp pelo
-- backend Rust — só ele toca a Evolution API). Curto de propósito (expira
-- rápido, 10 min) já que é só 3 dígitos.
CREATE TABLE IF NOT EXISTS sunset.customer_password_resets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  customer_id text NOT NULL REFERENCES sunset.customers(id) ON DELETE CASCADE,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_password_resets_customer ON sunset.customer_password_resets(customer_id);

CREATE OR REPLACE FUNCTION sunset._require_customer(p_token text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_subject text;
BEGIN
  SELECT subject_id INTO v_subject FROM sunset.sessions
    WHERE token = p_token AND role = 'customer' AND expires_at > now();
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN v_subject;
END;
$function$;

CREATE OR REPLACE FUNCTION sunset._customer_json(p_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'sunset', 'public'
AS $function$
  SELECT jsonb_build_object('id', id, 'name', name, 'whatsapp', whatsapp, 'email', email, 'birthdate', birthdate)
  FROM sunset.customers WHERE id = p_id;
$function$;

-- Cadastro: se já existe uma linha com esse whatsapp (criada num checkout
-- anterior sem senha), completa o cadastro nela em vez de duplicar cliente.
-- Se já tinha senha definida, bloqueia (já é cadastrado — usar login).
CREATE OR REPLACE FUNCTION sunset.customer_register(
  p_whatsapp text, p_password text, p_name text, p_email text, p_birthdate text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_id text;
  v_existing sunset.customers%ROWTYPE;
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

  SELECT * INTO v_existing FROM sunset.customers WHERE whatsapp = p_whatsapp;
  IF FOUND THEN
    IF v_existing.password_hash IS NOT NULL THEN
      RAISE EXCEPTION 'this whatsapp is already registered';
    END IF;
    v_id := v_existing.id;
    UPDATE sunset.customers SET
      name = trim(p_name), email = trim(p_email), birthdate = p_birthdate,
      password_hash = crypt(p_password, gen_salt('bf'))
    WHERE id = v_id;
  ELSE
    v_id := gen_random_uuid()::text;
    INSERT INTO sunset.customers (id, name, whatsapp, email, birthdate, password_hash, created_at)
    VALUES (v_id, trim(p_name), p_whatsapp, trim(p_email), p_birthdate, crypt(p_password, gen_salt('bf')), now()::text);
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO sunset.sessions (token, role, subject_id, expires_at) VALUES (v_token, 'customer', v_id, now() + interval '30 days');

  RETURN jsonb_build_object('token', v_token, 'customer', sunset._customer_json(v_id));
END;
$function$;

CREATE OR REPLACE FUNCTION sunset.customer_login(p_whatsapp text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_c sunset.customers%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_c FROM sunset.customers WHERE whatsapp = p_whatsapp;
  IF NOT FOUND OR v_c.password_hash IS NULL OR v_c.password_hash <> crypt(p_password, v_c.password_hash) THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO sunset.sessions (token, role, subject_id, expires_at) VALUES (v_token, 'customer', v_c.id, now() + interval '30 days');

  RETURN jsonb_build_object('token', v_token, 'customer', sunset._customer_json(v_c.id));
END;
$function$;

CREATE OR REPLACE FUNCTION sunset.customer_me(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_id text := sunset._require_customer(p_token);
BEGIN
  RETURN sunset._customer_json(v_id);
END;
$function$;

-- Gera e grava o código de 3 dígitos (chamada pelo backend Rust, que faz
-- SQLx direto — não passa por PostgREST). Não devolve o código pra quem
-- chamar via RPC pública, só usada internamente; por isso não tem GRANT
-- pra anon/authenticated (só o Rust, com a connection string de serviço,
-- consegue rodar isso).
CREATE OR REPLACE FUNCTION sunset._create_customer_reset_code(p_whatsapp text)
 RETURNS TABLE(customer_id text, customer_name text, code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_c sunset.customers%ROWTYPE;
  v_code text;
BEGIN
  SELECT * INTO v_c FROM sunset.customers WHERE whatsapp = p_whatsapp AND password_hash IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer not found';
  END IF;

  v_code := lpad(floor(random() * 1000)::int::text, 3, '0');
  INSERT INTO sunset.customer_password_resets (id, customer_id, code, expires_at)
  VALUES (gen_random_uuid()::text, v_c.id, v_code, now() + interval '10 minutes');

  RETURN QUERY SELECT v_c.id, v_c.name, v_code;
END;
$function$;

CREATE OR REPLACE FUNCTION sunset.customer_verify_reset_code(p_whatsapp text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_c sunset.customers%ROWTYPE;
  v_reset sunset.customer_password_resets%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM sunset.customers WHERE whatsapp = p_whatsapp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  SELECT * INTO v_reset FROM sunset.customer_password_resets
    WHERE customer_id = v_c.id AND code = p_code AND used = false AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  RETURN jsonb_build_object('valid', true);
END;
$function$;

CREATE OR REPLACE FUNCTION sunset.customer_reset_password(p_whatsapp text, p_code text, p_new_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sunset', 'public', 'extensions'
AS $function$
DECLARE
  v_c sunset.customers%ROWTYPE;
  v_reset sunset.customer_password_resets%ROWTYPE;
BEGIN
  IF p_new_password !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'password must be exactly 4 digits';
  END IF;

  SELECT * INTO v_c FROM sunset.customers WHERE whatsapp = p_whatsapp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  SELECT * INTO v_reset FROM sunset.customer_password_resets
    WHERE customer_id = v_c.id AND code = p_code AND used = false AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid code';
  END IF;

  UPDATE sunset.customers SET password_hash = crypt(p_new_password, gen_salt('bf')) WHERE id = v_c.id;
  UPDATE sunset.customer_password_resets SET used = true WHERE id = v_reset.id;
  -- derruba sessões antigas — troca de senha invalida logins anteriores.
  DELETE FROM sunset.sessions WHERE role = 'customer' AND subject_id = v_c.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION sunset.customer_register(text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sunset.customer_login(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sunset.customer_me(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sunset.customer_verify_reset_code(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sunset.customer_reset_password(text, text, text) TO anon, authenticated;
