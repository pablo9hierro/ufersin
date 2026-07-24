-- =====================================================
-- Gestão de funcionários exclusiva do admin:
-- 1) Admin consegue VISUALIZAR a senha atual de um motoboy/vendedor (não só
--    resetar) — o hash bcrypt (password_hash, usado pra login de verdade)
--    é irreversível de propósito, então guardamos também password_plain
--    (texto puro) só pra esse fim. Só uma RPC admin-gated expõe isso, sob
--    demanda (por funcionário, não embutido na listagem).
-- 2) Funcionário nunca troca a própria senha sozinho — só o admin, no
--    dashboard /admin/motoboys (funcionários). Isso já era verdade (motoboy
--    e vendedor nunca tiveram uma tela de "trocar senha" própria), esse
--    arquivo só formaliza o dado que faltava pro admin poder LER a senha.
--
-- Execução: depois de sunset_motoboy_payout.sql e sunset_comissao_origem_pedido.sql.
-- =====================================================

ALTER TABLE sunset.motoboys ADD COLUMN IF NOT EXISTS password_plain text;
ALTER TABLE sunset.vendedores ADD COLUMN IF NOT EXISTS password_plain text;

-- ─────────────────────────────────────────────────────
-- Motoboy: create/update passam a gravar password_plain junto com o hash.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.admin_create_motoboy(
  p_token text, p_name text, p_phone text, p_email text, p_password text,
  p_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_password IS NULL OR trim(p_password) = '' THEN
    RAISE EXCEPTION 'password is required to create a motoboy';
  END IF;
  BEGIN
    INSERT INTO sunset.motoboys (id, name, phone, email, password_hash, password_plain, whatsapp, active)
      VALUES (v_id, p_name, p_phone, p_email, crypt(p_password, gen_salt('bf')), p_password, p_whatsapp, 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN sunset._motoboy_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_motoboy(text, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_motoboy(
  p_token text, p_id text, p_name text, p_phone text, p_email text,
  p_password text DEFAULT NULL, p_active boolean DEFAULT true,
  p_whatsapp text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE sunset.motoboys SET
      name = p_name, phone = p_phone, email = p_email,
      password_hash = crypt(p_password, gen_salt('bf')), password_plain = p_password,
      active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp)
    WHERE id = p_id;
  ELSE
    UPDATE sunset.motoboys SET
      name = p_name, phone = p_phone, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      whatsapp = COALESCE(p_whatsapp, whatsapp)
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
  RETURN sunset._motoboy_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_motoboy(text, text, text, text, text, text, boolean, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_get_motoboy_password(p_token text, p_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_password text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT password_plain INTO v_password FROM sunset.motoboys WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'motoboy not found';
  END IF;
  RETURN v_password;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_get_motoboy_password(text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- Vendedor: mesma coisa.
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.admin_create_vendedor(
  p_token text, p_name text, p_email text, p_password text,
  p_commission_active boolean DEFAULT false, p_commission_percent double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_id text := gen_random_uuid()::text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF trim(p_name) = '' OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'name and email are required';
  END IF;
  IF p_password IS NULL OR trim(p_password) = '' THEN
    RAISE EXCEPTION 'password is required to create a vendedor';
  END IF;
  IF p_commission_active AND (p_commission_percent IS NULL OR p_commission_percent <= 0 OR p_commission_percent > 100) THEN
    RAISE EXCEPTION 'commission_percent must be between 0 and 100';
  END IF;
  BEGIN
    INSERT INTO sunset.vendedores (id, name, email, password_hash, password_plain, commission_active, commission_percent)
      VALUES (
        v_id, p_name, p_email, crypt(p_password, gen_salt('bf')), p_password,
        CASE WHEN p_commission_active THEN 1 ELSE 0 END,
        CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
      );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'email already in use';
  END;
  RETURN sunset._vendedor_json(v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_create_vendedor(text, text, text, text, boolean, double precision) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_update_vendedor(
  p_token text, p_id text, p_name text, p_email text, p_active boolean DEFAULT true, p_password text DEFAULT NULL,
  p_commission_active boolean DEFAULT false, p_commission_percent double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
BEGIN
  PERFORM sunset._require_admin(p_token);
  IF p_commission_active AND (p_commission_percent IS NULL OR p_commission_percent <= 0 OR p_commission_percent > 100) THEN
    RAISE EXCEPTION 'commission_percent must be between 0 and 100';
  END IF;
  IF p_password IS NOT NULL AND trim(p_password) <> '' THEN
    UPDATE sunset.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      password_hash = crypt(p_password, gen_salt('bf')), password_plain = p_password,
      commission_active = CASE WHEN p_commission_active THEN 1 ELSE 0 END,
      commission_percent = CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
    WHERE id = p_id;
  ELSE
    UPDATE sunset.vendedores SET
      name = p_name, email = p_email, active = CASE WHEN p_active THEN 1 ELSE 0 END,
      commission_active = CASE WHEN p_commission_active THEN 1 ELSE 0 END,
      commission_percent = CASE WHEN p_commission_active THEN p_commission_percent ELSE NULL END
    WHERE id = p_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendedor not found';
  END IF;
  RETURN sunset._vendedor_json(p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_update_vendedor(text, text, text, text, boolean, text, boolean, double precision) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.admin_get_vendedor_password(p_token text, p_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = sunset, public, extensions AS $$
DECLARE
  v_password text;
BEGIN
  PERFORM sunset._require_admin(p_token);
  SELECT password_plain INTO v_password FROM sunset.vendedores WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendedor not found';
  END IF;
  RETURN v_password;
END;
$$;
GRANT EXECUTE ON FUNCTION sunset.admin_get_vendedor_password(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
