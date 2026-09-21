// Uso:
//   node scripts/new-supabase/apply.mjs "<DATABASE_URL do owner>" pre  [--local]
//   (subir os 2 backends uma vez pra eles criarem loja.* e resolutoo.* -- ver README.md)
//   node scripts/new-supabase/apply.mjs "<DATABASE_URL do owner>" post
// --local = Postgres puro de teste (cria stubs de storage/auth que o Supabase real já tem).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const [, , url, phase, ...flags] = process.argv
if (!url || !['pre', 'post'].includes(phase)) {
  console.error('uso: node apply.mjs "<DATABASE_URL>" pre|post [--local]')
  process.exit(1)
}
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const read = (p) => fs.readFileSync(p, 'utf8')

// O bootstrap legado agenda (pg_cron + pg_net) um job de Pix POR MINUTO contra tabela legada vazia,
// chamando uma URL antiga. Obsoleto (Pix hoje é o Rust) -- fora do kit.
function withoutLegacyPixCron(sql) {
  const before = sql.length
  const out = sql
    .replace(/CREATE EXTENSION IF NOT EXISTS pg_cron;\s*/g, '')
    .replace(/CREATE EXTENSION IF NOT EXISTS pg_net;\s*/g, '')
    .replace(/DO \$\$\s*BEGIN\s*IF EXISTS \(SELECT 1 FROM cron\.job[\s\S]*?END \$\$;/g, '')
    .replace(/SELECT cron\.schedule\([^\n]*\n/g, '')
  if (out.length === before) throw new Error('filtro do pg_cron não casou -- bootstrap mudou?')
  if (/cron\.schedule|CREATE EXTENSION IF NOT EXISTS pg_cron/.test(out)) throw new Error('sobrou pg_cron no bootstrap')
  return out
}

const steps =
  phase === 'pre'
    ? [
        ['00_prepare.sql', () => read(path.join(here, '00_prepare.sql'))],
        ...(flags.includes('--local') ? [['local-test/supabase_stubs.sql', () => read(path.join(here, 'local-test/supabase_stubs.sql'))]] : []),
        ['supabase/resolutoo-migration/0001_bootstrap_resolutoo_schema.sql (sem pg_cron)', () =>
          withoutLegacyPixCron(read(path.join(repo, 'supabase/resolutoo-migration/0001_bootstrap_resolutoo_schema.sql')))],
      ]
    : [
        ['ecommerce/supabase/resolutoo_create_order_fiscal_context.sql', () => read(path.join(repo, 'ecommerce/supabase/resolutoo_create_order_fiscal_context.sql'))],
        ['ecommerce/supabase/resolutoo_get_order_shipping_tenant_fix.sql', () => read(path.join(repo, 'ecommerce/supabase/resolutoo_get_order_shipping_tenant_fix.sql'))],
        ['ecommerce/supabase/resolutoo_create_order_contribuinte_icms.sql', () => read(path.join(repo, 'ecommerce/supabase/resolutoo_create_order_contribuinte_icms.sql'))],
        ['30_motoboy_run_fixes.sql', () => read(path.join(here, '30_motoboy_run_fixes.sql'))],
      ]

const client = new pg.Client({
  connectionString: url.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: /supabase|pooler/.test(url) ? { rejectUnauthorized: false } : false,
})
await client.connect()
for (const [name, load] of steps) {
  process.stdout.write(`-> ${name} ... `)
  await client.query('RESET search_path')
  try {
    await client.query(load())
    console.log('ok')
  } catch (e) {
    console.log('ERRO')
    console.error(`   ${e.message}${e.where ? '\n   ' + e.where : ''}`)
    await client.end()
    process.exit(1)
  }
}
await client.end()
console.log(`fase "${phase}" concluída`)
