-- Dois bugs achados em resolutoo.customer_register (nunca atualizada desde
-- a era pré-cadastro-de-cliente-por-loja):
--
-- 1. Exigia birthdate SEMPRE, mesmo em lojas com vende_mais_18 = false —
--    a coluna resolutoo.customers.birthdate é NULLABLE no banco (é
--    opcional por natureza; só é obrigatória quando a loja vende produto
--    18+, ver sunset.tenants.vende_mais_18 e o mesmo padrão já aplicado em
--    create_order via resolutoo_create_order_tenant_fix.sql). O front (
--    components/CustomerAuthModal.tsx e as 3 variantes uiux2/3/4) só
--    RENDERIZA o campo quando a loja é 18+, então lojas comuns nunca
--    mandavam birthdate — e essa função rejeitava com "birthdate is
--    required" mesmo assim.
-- 2. Exigia senha de EXATAMENTE 4 dígitos (`^[0-9]{4}$`) — o front migrou
--    pra senha de 6 dígitos há tempos (ver components/CustomerAuthModal.tsx),
--    então TODO cadastro de cliente vinha falhando aqui antes mesmo de
--    chegar na validação de birthdate teria passado.

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
  v_requires_18 boolean;
  v_birthdate text;
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
  IF p_password !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'password must be exactly 6 digits';
  END IF;

  -- O schema `sunset` foi renomeado pra `loja` em algum ponto depois que
  -- resolutoo_customer_auth_tenant_scope.sql foi escrito (comentário de lá
  -- ficou desatualizado) — a tabela de verdade hoje é `loja.tenants`
  -- (`resolutoo.tenants` é scaffolding legado sem `vende_mais_18` nem as
  -- outras colunas usadas pelo resto da plataforma).
  SELECT id, vende_mais_18 INTO v_tenant_id, v_requires_18 FROM loja.tenants WHERE slug = p_tenant_slug;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'store not found';
  END IF;

  IF v_requires_18 AND trim(coalesce(p_birthdate, '')) = '' THEN
    RAISE EXCEPTION 'birthdate is required';
  END IF;
  v_birthdate := NULLIF(trim(coalesce(p_birthdate, '')), '');

  SELECT * INTO v_existing FROM resolutoo.customers WHERE whatsapp = p_whatsapp AND tenant_id = v_tenant_id;
  IF FOUND THEN
    IF v_existing.password_hash IS NOT NULL THEN
      RAISE EXCEPTION 'this whatsapp is already registered';
    END IF;
    v_id := v_existing.id;
    UPDATE resolutoo.customers SET
      name = trim(p_name), email = trim(p_email), birthdate = v_birthdate,
      password_hash = crypt(p_password, gen_salt('bf'))
    WHERE id = v_id;
  ELSE
    v_id := gen_random_uuid()::text;
    INSERT INTO resolutoo.customers (id, name, whatsapp, email, birthdate, password_hash, tenant_id, created_at)
    VALUES (v_id, trim(p_name), p_whatsapp, trim(p_email), v_birthdate, crypt(p_password, gen_salt('bf')), v_tenant_id, now()::text);
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO resolutoo.sessions (token, role, subject_id, expires_at) VALUES (v_token, 'customer', v_id, now() + interval '30 days');

  RETURN jsonb_build_object('token', v_token, 'customer', resolutoo._customer_json(v_id));
END;
$function$;
