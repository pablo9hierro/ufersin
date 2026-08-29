/** Aplica oferece_servicos + atualiza get_public_tenant_config. */
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sqlPath = path.join(__dirname, '../migrations/0025_oferece_servicos.sql')
const rpcPath = path.join(__dirname, 'resolutoo_tenant_config_rpc.sql')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL required')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(fs.readFileSync(sqlPath, 'utf8'))
  await client.query(fs.readFileSync(rpcPath, 'utf8'))
  const r = await client.query(`SELECT resolutoo.get_public_tenant_config($1) AS j`, ['resusu'])
  console.log('RPC ok: oferece_servicos=', r.rows[0]?.j?.oferece_servicos ?? null)
} finally {
  await client.end()
}
