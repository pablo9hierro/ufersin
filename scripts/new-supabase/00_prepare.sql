-- 00_prepare.sql -- roda UMA vez num projeto Supabase novo (SQL Editor), como owner (postgres).
-- Cria só o que os backends NÃO criam sozinhos: schemas, extensões e roles de aplicação.
-- As tabelas vêm das migrations sqlx que cada backend roda no boot:
--   ecommerce/backend  -> schema loja      (tabela de controle: loja._sqlx_migrations)
--   backend (plataforma)-> schema resolutoo (tabela de controle: resolutoo._sqlx_migrations)

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"  WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS loja;
CREATE SCHEMA IF NOT EXISTS resolutoo;

-- Roles do Supabase (anon/authenticated/service_role) já existem lá; no Postgres puro (teste local) criamos vazias.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
