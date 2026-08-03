/** Aplica colunas pagamento_na_retirada + entrega_somente_pix e atualiza RPCs. */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const strip = (s) => s.replace(/^\uFEFF/, '')
const ufer = JSON.parse(strip(readFileSync(resolve(root, '.migration-tmp/ufer_vars.json'), 'utf8')))
const sql = readFileSync(resolve(root, 'backend/scripts/resolutoo_tenant_config_rpc.sql'), 'utf8')

const client = new pg.Client({ connectionString: ufer.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query('SET search_path TO resolutoo, public')
await client.query(`
  ALTER TABLE subscribers
    ADD COLUMN IF NOT EXISTS pagamento_na_retirada BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS entrega_somente_pix BOOLEAN NOT NULL DEFAULT false
`)
await client.query(sql)
const r = await client.query(`SELECT resolutoo.get_public_tenant_config($1) AS j`, ['resusu'])
const j = r.rows[0].j
console.log(
  'RPC ok: pagamento_na_retirada=',
  j?.pagamento_na_retirada,
  'entrega_somente_pix=',
  j?.entrega_somente_pix,
  'apenas_retirada=',
  j?.apenas_retirada,
)
await client.end()
