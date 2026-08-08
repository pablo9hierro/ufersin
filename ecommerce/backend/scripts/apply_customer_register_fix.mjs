import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const strip = (s) => s.replace(/^﻿/, '')
const ufer = JSON.parse(strip(readFileSync(resolve(root, '.migration-tmp/ufer_vars.json'), 'utf8')))
const sql = readFileSync(resolve(root, 'ecommerce/supabase/resolutoo_customer_register_birthdate_optional.sql'), 'utf8')

const client = new pg.Client({ connectionString: ufer.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query(sql)
console.log('resolutoo.customer_register atualizada: birthdate condicional a vende_mais_18, senha 6 dígitos.')
await client.end()
