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
await client.query(sql)
const r = await client.query(`SELECT resolutoo.get_public_tenant_config($1) AS j`, ['resusu'])
const j = r.rows[0].j
const keys = ['endereco', 'endereco_numero', 'instagram', 'facebook', 'whatsapp']
console.log('RPC ok:', keys.map((k) => `${k}=${j[k] != null && j[k] !== '' ? 'yes' : 'empty'}`).join(' '))
await client.end()
