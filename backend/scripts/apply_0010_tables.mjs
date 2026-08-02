/** Aplica tabelas da migration 0010 no schema resolutoo (sem seed de planos). */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const stripBom = (s) => s.replace(/^\uFEFF/, '')
const ufer = JSON.parse(stripBom(readFileSync(resolve(root, '.migration-tmp/ufer_vars.json'), 'utf8')))
const sql = readFileSync(resolve(root, 'backend/migrations/0010_superadmin_cms_coupons.sql'), 'utf8')

const client = new pg.Client({ connectionString: ufer.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query('SET search_path TO resolutoo, public')
await client.query(sql)
const tables = await client.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema='resolutoo' AND table_name LIKE 'platform_%' ORDER BY 1`,
)
await client.end()
console.log('OK 0010 applied. tables:', tables.rows.map((r) => r.table_name).join(', '))
