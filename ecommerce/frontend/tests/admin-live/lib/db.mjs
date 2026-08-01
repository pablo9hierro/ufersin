/**
 * Optional Postgres checks when ADMIN_TEST_DATABASE_URL / DATABASE_URL is set.
 * Requires `pg` (`npm i -D pg` in ecommerce/frontend).
 */

export async function withDb(databaseUrl, fn) {
  if (!databaseUrl) return null
  let pg
  try {
    pg = await import('pg')
  } catch {
    throw new Error(
      'ADMIN_TEST_DATABASE_URL is set but package "pg" is not installed. Run: npm i -D pg',
    )
  }
  const client = new pg.default.Client({ connectionString: databaseUrl, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => {})
  }
}

export async function assertProductRow(client, productId, expect) {
  const { rows } = await client.query(
    'SELECT id, name, barcode, price, quantity, active FROM products WHERE id = $1',
    [productId],
  )
  if (!rows.length) throw new Error(`DB: product ${productId} not found`)
  const row = rows[0]
  if (expect.name != null && row.name !== expect.name) {
    throw new Error(`DB name mismatch: ${row.name} !== ${expect.name}`)
  }
  if (expect.barcode != null && row.barcode !== expect.barcode) {
    throw new Error(`DB barcode mismatch: ${row.barcode} !== ${expect.barcode}`)
  }
  return row
}

export async function assertProductGone(client, productId) {
  const { rows } = await client.query('SELECT id FROM products WHERE id = $1', [productId])
  if (rows.length) throw new Error(`DB: product ${productId} still present after delete`)
}
