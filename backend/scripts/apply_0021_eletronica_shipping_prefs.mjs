/** Aplica coleta_gratis/entrega_reparado_gratis + atualiza RPCs públicas. */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const strip = (s) => s.replace(/^﻿/, '')
const ufer = JSON.parse(strip(readFileSync(resolve(root, '.migration-tmp/ufer_vars.json'), 'utf8')))
const sql = readFileSync(resolve(root, 'backend/scripts/resolutoo_tenant_config_rpc.sql'), 'utf8')

const client = new pg.Client({ connectionString: ufer.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query('SET search_path TO resolutoo, public')
await client.query(`
  ALTER TABLE subscribers
    ADD COLUMN IF NOT EXISTS coleta_gratis BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS entrega_reparado_gratis BOOLEAN NOT NULL DEFAULT false
`)
await client.query(sql)
for (const slug of ['resusu', 'vrtech']) {
  const r = await client.query(`SELECT resolutoo.get_public_tenant_config($1) AS j`, [slug])
  const j = r.rows[0].j
  console.log(
    `RPC ${slug}:`,
    j ? `apenas_retirada=${j.apenas_retirada} coleta_gratis=${j.coleta_gratis} entrega_reparado_gratis=${j.entrega_reparado_gratis}` : '(sem loja ativa)',
  )
}
await client.end()
