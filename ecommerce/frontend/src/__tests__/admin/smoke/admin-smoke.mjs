/**
 * Optional lightweight concurrent smoke against ADMIN_SMOKE_BASE_URL.
 * Never used in CI without env. Does not require production credentials —
 * pass a staging/local base + bearer via ADMIN_SMOKE_TOKEN if you want auth routes.
 *
 * Usage:
 *   ADMIN_SMOKE_BASE_URL=http://localhost:8080 node src/__tests__/admin/smoke/admin-smoke.mjs
 */
const base = (process.env.ADMIN_SMOKE_BASE_URL || '').replace(/\/$/, '')
if (!base) {
  console.log('ADMIN_SMOKE_BASE_URL not set — smoke skipped')
  process.exit(0)
}

const token = process.env.ADMIN_SMOKE_TOKEN || ''
const headers = {
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
}

const paths = [
  '/api/admin/whatsapp/connection-events',
  '/api/admin/whatsapp/status',
  '/api/admin/products',
  '/api/admin/store-status',
  '/api/pdv/products',
]

const concurrency = Number(process.env.ADMIN_SMOKE_CONCURRENCY || 4)

async function hit(path) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${base}${path}`, { headers })
    return { path, status: res.status, ms: Date.now() - t0, ok: res.status < 500 }
  } catch (e) {
    return { path, status: 0, ms: Date.now() - t0, ok: false, error: String(e) }
  }
}

const queue = [...paths, ...paths] // two rounds
const results = []
async function worker() {
  while (queue.length) {
    const path = queue.shift()
    results.push(await hit(path))
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()))
for (const r of results) {
  console.log(`${r.ok ? 'OK' : 'FAIL'} ${r.status} ${r.ms}ms ${r.path}${r.error ? ' ' + r.error : ''}`)
}
const failed = results.filter((r) => !r.ok)
process.exit(failed.length ? 1 : 0)
