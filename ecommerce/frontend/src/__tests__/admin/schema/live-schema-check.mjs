/**
 * Optional live DB schema probe (requires `pg` + ADMIN_TEST_DATABASE_URL).
 * Not part of Vitest CI — run manually:
 *   ADMIN_TEST_DATABASE_URL=postgres://... node src/__tests__/admin/schema/live-schema-check.mjs
 */
const url = process.env.ADMIN_TEST_DATABASE_URL
if (!url) {
  console.log('ADMIN_TEST_DATABASE_URL not set — live schema check skipped')
  process.exit(0)
}

let Client
try {
  ;({ Client } = await import('pg'))
} catch {
  console.error('Install pg to run live checks: npm i -D pg')
  process.exit(1)
}

const client = new Client({ connectionString: url })
await client.connect()
try {
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [['products', 'store_hours', 'whatsapp_connection_events', 'tenants']]
  )
  const names = new Set(tables.rows.map((r) => r.table_name))
  for (const t of ['products', 'whatsapp_connection_events', 'tenants', 'store_hours']) {
    if (!names.has(t)) throw new Error(`missing table ${t}`)
    console.log('OK table', t)
  }
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'whatsapp_connection_events'`
  )
  const colSet = new Set(cols.rows.map((r) => r.column_name))
  for (const c of ['id', 'tenant_id', 'event_type', 'created_at', 'new_state']) {
    if (!colSet.has(c)) throw new Error(`whatsapp_connection_events missing ${c}`)
  }
  console.log('OK whatsapp_connection_events columns')
  const barcode = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='barcode'`
  )
  if (!barcode.rowCount) throw new Error('products.barcode missing')
  console.log('OK products.barcode')
} finally {
  await client.end()
}
