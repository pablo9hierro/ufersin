-- =====================================================
-- Sunset Tabas — login de admin/motoboy 100% dentro do
-- schema `sunset`, SEM usar o Supabase Auth (auth.users).
--
-- POR QUÊ NÃO USAR auth.users: ele é compartilhado por TODO o
-- projeto Supabase (o mesmo projeto usado pelo VRTech). Além de
-- um login não ter como "pertencer" a um app só, as policies do
-- VRTech usam `TO authenticated USING (true)` em várias tabelas
-- — ou seja, qualquer login feito ali (inclusive um admin do
-- Sunset) passaria a enxergar dados do VRTech também. Pra não
-- criar esse vazamento entre os dois projetos, o Sunset usa sua
-- própria tabela de sessões dentro do schema `sunset`, nunca
-- toca no papel "authenticated" do Postgres, e continua 100%
-- isolado — igual products/orders/etc já são.
--
-- Execute no SQL Editor do Supabase, DEPOIS de já ter rodado
-- sunset_public_rls_and_rpc.sql.
-- =====================================================

-- Necessário pra crypt()/gen_salt() (hash de senha) e
-- gen_random_bytes() (token de sessão). Extensão de projeto
-- inteiro, não é específica de nenhum schema — comum em
-- qualquer projeto Supabase, não afeta dados do VRTech.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────
-- 1. Tabela de sessões (token opaco, sem JWT)
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sunset.sessions (
  token text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('admin', 'motoboy')),
  subject_id text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sunset.sessions ENABLE ROW LEVEL SECURITY;
-- Sem nenhuma policy pra anon/authenticated de propósito: essa
-- tabela só é lida/escrita pelas funções SECURITY DEFINER abaixo,
-- nunca diretamente pela API REST.

-- Remove duplicatas (ex.: sobras de execuções anteriores desse script),
-- mantendo só a linha mais antiga entre os e-mails de teste conhecidos —
-- evita "duplicate key" no UPDATE logo abaixo, não importa quantas vezes
-- esse arquivo já foi rodado antes.
DELETE FROM sunset.admins a
  USING sunset.admins b
  WHERE a.email IN ('admin@sonset.com', 'sunset@gmail.com', 'pablo2@gmail.com')
    AND b.email IN ('admin@sonset.com', 'sunset@gmail.com', 'pablo2@gmail.com')
    AND a.created_at > b.created_at;

-- Re-hash das credenciais seedadas pelo backend Rust em argon2 (que o
-- Postgres não verifica nativamente) pra bcrypt via pgcrypto, e troca o
-- admin de teste pro e-mail/senha reais. WHERE cobre os e-mails antigos e o
-- novo pra esse UPDATE poder ser re-executado sem erro.
UPDATE sunset.admins SET email = 'pablo2@gmail.com', password_hash = crypt('123456', gen_salt('bf'))
  WHERE email IN ('admin@sonset.com', 'sunset@gmail.com', 'pablo2@gmail.com');
UPDATE sunset.motoboys SET password_hash = crypt('motoboy123', gen_salt('bf'))
  WHERE email = 'motoboy@sonset.com';

-- ─────────────────────────────────────────────────────
-- 2. Login
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.admin_login(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sunset, public, extensions
AS $$
DECLARE
  v_admin sunset.admins%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_admin FROM sunset.admins WHERE email = p_email;
  IF NOT FOUND OR v_admin.password_hash <> crypt(p_password, v_admin.password_hash) THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO sunset.sessions (token, role, subject_id) VALUES (v_token, 'admin', v_admin.id);

  RETURN jsonb_build_object('token', v_token, 'name', v_admin.name);
END;
$$;

GRANT EXECUTE ON FUNCTION sunset.admin_login(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.motoboy_login(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sunset, public, extensions
AS $$
DECLARE
  v_m sunset.motoboys%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_m FROM sunset.motoboys WHERE email = p_email;
  IF NOT FOUND OR v_m.active = 0 OR v_m.password_hash <> crypt(p_password, v_m.password_hash) THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO sunset.sessions (token, role, subject_id) VALUES (v_token, 'motoboy', v_m.id);

  RETURN jsonb_build_object('token', v_token, 'name', v_m.name);
END;
$$;

GRANT EXECUTE ON FUNCTION sunset.motoboy_login(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION sunset.logout(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = sunset, public, extensions
AS $$
  DELETE FROM sunset.sessions WHERE token = p_token;
$$;

GRANT EXECUTE ON FUNCTION sunset.logout(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────
-- 3. Helpers internos (usados pelas próximas RPCs de CRUD do
--    admin/motoboy — não chamados direto pelo frontend)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset._require_admin(p_token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sunset, public, extensions
AS $$
DECLARE
  v_subject text;
BEGIN
  SELECT subject_id INTO v_subject FROM sunset.sessions
    WHERE token = p_token AND role = 'admin' AND expires_at > now();
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN v_subject;
END;
$$;

CREATE OR REPLACE FUNCTION sunset._require_motoboy(p_token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sunset, public, extensions
AS $$
DECLARE
  v_subject text;
BEGIN
  SELECT subject_id INTO v_subject FROM sunset.sessions
    WHERE token = p_token AND role = 'motoboy' AND expires_at > now();
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN v_subject;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 4. Trocar a própria senha (painel admin → /admin/senha).
--    O token já prova que é o admin logado, não pede senha atual
--    de novo — é só um usuário admin único, sem e-mail trocável
--    por aqui (fixo no seed).
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sunset.admin_set_password(p_token text, p_new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sunset, public, extensions
AS $$
DECLARE
  v_admin_id text := sunset._require_admin(p_token);
BEGIN
  IF length(trim(p_new_password)) < 6 THEN
    RAISE EXCEPTION 'new password must be at least 6 characters';
  END IF;
  UPDATE sunset.admins SET password_hash = crypt(p_new_password, gen_salt('bf')) WHERE id = v_admin_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sunset.admin_set_password(text, text) TO anon, authenticated;
