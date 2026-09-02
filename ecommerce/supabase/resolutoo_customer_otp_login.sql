-- Login único do cliente (cadastro + login viram a mesma coisa): nome +
-- whatsapp + código OTP de 6 dígitos. Reaproveita resolutoo.customers
-- (email/password_hash/birthdate já são nullable) e a tabela de código já
-- existente resolutoo.customer_password_resets (mesmo formato: customer_id,
-- code, expires_at, used) -- sem tabela nova.
--
-- _create_customer_login_code é SECURITY DEFINER sem GRANT pra anon/
-- authenticated (só alcançável com a service_role key, chamada pelo backend
-- Rust -- ele que manda o WhatsApp de verdade, igual ao fluxo de
-- recuperação de senha em resolutoo_customer_auth.sql/public.rs). Já
-- customer_verify_login_code é chamada direto pelo navegador (anon), igual
-- customer_login/customer_verify_reset_code.

CREATE OR REPLACE FUNCTION resolutoo._create_customer_login_code(p_whatsapp text, p_name text, p_tenant_id text)
RETURNS TABLE(customer_id text, customer_name text, code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'resolutoo', 'public', 'extensions'
AS $$
DECLARE
  v_c resolutoo.customers%ROWTYPE;
  v_code text;
BEGIN
  IF trim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF p_whatsapp IS NULL OR length(regexp_replace(p_whatsapp, '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'a valid whatsapp is required';
  END IF;

  -- whatsapp é a chave primária de identidade do cliente dentro do tenant:
  -- mesmo whatsapp = mesmo customer, nome pode mudar dinamicamente.
  SELECT * INTO v_c FROM resolutoo.customers WHERE whatsapp = p_whatsapp AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    INSERT INTO resolutoo.customers (id, name, whatsapp, tenant_id, created_at)
    VALUES (gen_random_uuid()::text, trim(p_name), p_whatsapp, p_tenant_id, now()::text)
    RETURNING * INTO v_c;
  ELSIF trim(p_name) <> v_c.name THEN
    UPDATE resolutoo.customers SET name = trim(p_name) WHERE id = v_c.id
    RETURNING * INTO v_c;
  END IF;

  v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
  INSERT INTO resolutoo.customer_password_resets (id, customer_id, code, expires_at)
  VALUES (gen_random_uuid()::text, v_c.id, v_code, now() + interval '10 minutes');

  RETURN QUERY SELECT v_c.id, v_c.name, v_code;
END;
$$;

CREATE OR REPLACE FUNCTION resolutoo.customer_verify_login_code(p_whatsapp text, p_code text, p_tenant_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'resolutoo', 'public', 'extensions'
AS $$
DECLARE
  v_tenant_id text;
  v_c resolutoo.customers%ROWTYPE;
  v_reset resolutoo.customer_password_resets%ROWTYPE;
  v_token text;
BEGIN
  SELECT id INTO v_tenant_id FROM loja.tenants WHERE slug = p_tenant_slug;
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

  UPDATE resolutoo.customer_password_resets SET used = true WHERE id = v_reset.id;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO resolutoo.sessions (token, role, subject_id, expires_at)
  VALUES (v_token, 'customer', v_c.id, now() + interval '30 days');

  RETURN jsonb_build_object('token', v_token, 'customer', resolutoo._customer_json(v_c.id));
END;
$$;

GRANT EXECUTE ON FUNCTION resolutoo.customer_verify_login_code(text, text, text) TO anon, authenticated;
-- _create_customer_login_code fica sem GRANT de propósito (só service_role, via backend Rust).
