# Recriar o banco num projeto Supabase novo (grátis)

Testado em 20/09/2026 num Postgres 17 local vazio: os dois backends sobem, as migrations rodam do zero e o ciclo
da corrida do motoboy (iniciar, ativa, posição, concluir) passa. Só **dados** não vêm (tenants, lojistas, pedidos).

> Melhor caminho, se der: no projeto antigo pausado o Supabase costuma oferecer **Download backup**.
> Restaurar esse backup traz TUDO (contas, tenant, certificados). Este kit é o plano B (banco limpo).

## Passo a passo

1. Criar o projeto (região `sa-east-1`). Guardar: senha do banco, `Project URL`, `anon key`, `service_role key`, JWT secret.
2. Dashboard > Settings > API > **Exposed schemas**: adicionar `resolutoo` (o frontend chama RPC com `Accept-Profile: resolutoo`).
3. Usar a connection string do **owner** (`postgres`), modo *session* (porta 5432 do pooler).
4. Preparar schemas + camada legada de RPC (sem o job de Pix por minuto, que é lixo antigo):

       node scripts/new-supabase/apply.mjs "<DATABASE_URL>" pre

5. Trocar `DATABASE_URL` (+ `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) no Railway em `ecommerce-api` e `ufersin-api`
   (e no `ouvir`, se for continuar) e redeployar. Cada backend roda as próprias migrations no boot:
   `ecommerce-api` cria `loja.*` e `eletronicos.*`; `ufersin-api` cria as tabelas da plataforma em `resolutoo.*`.
6. Depois que os dois subiram, aplicar patches + correções das RPCs do motoboy (precisam de `loja.orders`):

       node scripts/new-supabase/apply.mjs "<DATABASE_URL>" post

7. Conferir: `psql "<DATABASE_URL>" -f scripts/new-supabase/local-test/smoke_motoboy_run.sql`
   (imprime 5 linhas `NOTICE` terminando em `concluido / pago`; apaga o que criou).
8. Vercel (frontend da plataforma e o do ecommerce): `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Redeploy.
9. GitHub > Settings > Secrets > Actions: `SUPABASE_DB_URL` = mesma URL (keep-alive diário, `.github/workflows/supabase-keepalive.yml`).

## O que se perde / refazer
- Contas de lojista (Supabase Auth), assinatura, tenant `resusu`, pedidos, certificado fiscal, conexão Mercado Pago: refazer cadastro e onboarding.
- Tenants `demo-*`: o seed do `demo-eletronica` quebra em banco vazio (ids uuid sem cast em `seed.rs`). A API agora só loga o erro e sobe.
- O produto **Jubilados / `ouvir`** divide este mesmo banco (schema `jubilados`). Este kit não recria o schema dele.

## Limitações conhecidas
- Os backends conectam como `postgres` (dono das tabelas): as políticas RLS não valem contra ele. Endurecer depois, se for pra produção.
- `local-test/supabase_stubs.sql` é só pro teste local. **Nunca** rodar no Supabase real.
