/**
 * Live admin panel suite — real HTTP against ecommerce-api.
 * No API/DB mocks. Fails if credentials env is missing.
 *
 * Usage (from ecommerce/frontend):
 *   npm run test:admin
 *   npm run test:admin:live
 */

import { requireLiveEnv } from './lib/loadEnv.mjs'
import { createClient } from './lib/client.mjs'
import { assert, assertEqual, assertShape, assertStatus } from './lib/assert.mjs'
import { withDb, assertProductRow, assertProductGone } from './lib/db.mjs'

const results = []

function pass(name) {
  results.push({ name, ok: true })
  console.log(`  ✓ ${name}`)
}

function fail(name, err) {
  results.push({ name, ok: false, error: err?.message || String(err) })
  console.error(`  ✗ ${name}`)
  console.error(`    ${err?.message || err}`)
}

async function run(name, fn) {
  try {
    await fn()
    pass(name)
  } catch (err) {
    fail(name, err)
  }
}

function defaultHours() {
  return Array.from({ length: 7 }, (_, day_of_week) => ({
    day_of_week,
    is_open: true,
    intervals: [{ opens_at: '09:00', closes_at: '18:00' }],
  }))
}

async function main() {
  let env
  try {
    env = requireLiveEnv()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  console.log('Admin live suite')
  console.log(`  API: ${env.baseUrl}`)
  console.log(`  tenant: ${env.tenant}`)
  console.log(`  email: ${env.email.replace(/(^.).*(@.*$)/, '$1***$2')}`)
  console.log(`  runId: ${env.runId}`)
  console.log(`  DB asserts: ${env.databaseUrl ? 'yes' : 'no'}`)
  console.log(`  PDV cash sale: ${env.allowPdvSale ? 'enabled' : 'skipped (set ADMIN_TEST_ALLOW_PDV_SALE=1)'}`)
  console.log(`  PDV Pix: always on (fails on 405 / missing QR)`)
  console.log(`  WA phone: ${env.waPhone ? `set (…${env.waPhone.slice(-4)})` : 'skipped (ADMIN_TEST_WA_PHONE)'}`)
  console.log('')

  const anon = createClient(env.baseUrl)
  let api
  let createdProductId = null
  let createdCategoryId = null
  let originalHours = null
  const barcode = `T${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 90 + 10)}`
  const productName = `${env.runId}_Cherry`
  const categoryName = `${env.runId}_Cat`

  // ---- Auth / Login ----
  await run('login: POST /api/auth/admin/login returns JWT', async () => {
    const res = await anon.post('/api/auth/admin/login', {
      email: env.email,
      password: env.password,
      tenant_slug: env.tenant,
    })
    assertStatus(res, 200, 'login')
    assertShape(res.data, ['token', 'name'], 'login body')
    assert(typeof res.data.token === 'string' && res.data.token.length > 20, 'token too short')
    api = anon.withToken(res.data.token)
  })

  if (!api) {
    console.error('\nAborting — login failed; cannot exercise authenticated routes.')
    process.exit(1)
  }

  // ---- Categories ----
  await run('categories: create TEST category', async () => {
    const res = await api.post('/api/admin/categories', { name: categoryName })
    assertStatus(res, [200, 201], 'create category')
    assertShape(res.data, ['id', 'name'])
    assertEqual(res.data.name, categoryName, 'category name')
    createdCategoryId = res.data.id
  })

  await run('categories: list includes created', async () => {
    const res = await api.get('/api/admin/categories')
    assertStatus(res, 200)
    assert(Array.isArray(res.data), 'categories list')
    assert(
      res.data.some((c) => c.id === createdCategoryId),
      'created category missing from list',
    )
  })

  // ---- Products CRUD ----
  await run('products: create TEST product with barcode', async () => {
    const res = await api.post('/api/admin/products', {
      name: productName,
      description: 'admin-live suite',
      price: 35.5,
      quantity: 8,
      image_url: null,
      category_id: createdCategoryId,
      active: true,
      cost_price: 12,
      low_stock_threshold: 3,
      barcode,
    })
    assertStatus(res, [200, 201], 'create product')
    assertShape(res.data, ['id', 'name', 'price', 'quantity', 'barcode'])
    assertEqual(res.data.name, productName, 'product name')
    assertEqual(res.data.barcode, barcode, 'barcode')
    createdProductId = res.data.id
  })

  await run('products: list includes created', async () => {
    const res = await api.get('/api/admin/products')
    assertStatus(res, 200)
    assert(Array.isArray(res.data), 'products list')
    const found = res.data.find((p) => p.id === createdProductId)
    assert(found, 'created product missing from admin list')
    assertEqual(found.barcode, barcode, 'list barcode')
  })

  await run('products: get by id', async () => {
    const res = await api.get(`/api/admin/products/${createdProductId}`)
    assertStatus(res, 200)
    assertEqual(res.data.id, createdProductId, 'get id')
  })

  await run('products: update price/qty', async () => {
    const res = await api.put(`/api/admin/products/${createdProductId}`, {
      name: productName,
      description: 'admin-live suite updated',
      price: 39.9,
      quantity: 10,
      image_url: null,
      category_id: createdCategoryId,
      active: true,
      cost_price: 12,
      low_stock_threshold: 3,
      barcode,
    })
    assertStatus(res, 200)
    assertEqual(res.data.price, 39.9, 'updated price')
    assertEqual(res.data.quantity, 10, 'updated qty')
  })

  if (env.databaseUrl) {
    await run('products: DB row matches after create/update', async () => {
      await withDb(env.databaseUrl, async (client) => {
        await assertProductRow(client, createdProductId, { name: productName, barcode })
      })
    })
  }

  // ---- Produtos → PDV (critical path) ----
  await run('pdv: listProducts includes admin-created product', async () => {
    const res = await api.get('/api/pdv/products')
    assertStatus(res, 200)
    assert(Array.isArray(res.data), 'pdv products')
    const found = res.data.find((p) => p.id === createdProductId)
    assert(found, 'product missing from /api/pdv/products after admin create')
    assertEqual(found.barcode, barcode, 'pdv barcode')
    assert(
      String(found.name).includes(env.runId) || found.name === productName,
      'pdv name mismatch',
    )
  })

  // ---- Pedidos ----
  await run('orders: list returns array', async () => {
    const res = await api.get('/api/admin/orders')
    assertStatus(res, 200)
    assert(Array.isArray(res.data), 'orders list')
  })

  // ---- Relatórios ----
  await run('financeiro: GET summary shape', async () => {
    const res = await api.get('/api/admin/financeiro')
    assertStatus(res, 200)
    assertShape(res.data, ['total_revenue', 'total_orders'], 'financeiro')
  })

  await run('financeiro: lucro current month', async () => {
    const now = new Date()
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const res = await api.get(`/api/admin/financeiro/lucro?from=${from}&to=${to}`)
    assertStatus(res, 200)
    assertShape(res.data, ['receita', 'custo', 'lucro'], 'lucro')
  })

  // ---- Conta / store hours ----
  await run('store-status: GET', async () => {
    const res = await api.get('/api/admin/store-status')
    assertStatus(res, 200)
    assertShape(res.data, ['hours', 'manually_closed'], 'store-status')
    originalHours = Array.isArray(res.data.hours) && res.data.hours.length ? res.data.hours : defaultHours()
  })

  await run('store-hours: PUT save (then restore later)', async () => {
    const hours = (originalHours || defaultHours()).map((d) => ({
      day_of_week: d.day_of_week,
      is_open: d.is_open !== false,
      intervals: (d.intervals && d.intervals.length
        ? d.intervals
        : [{ opens_at: '09:00', closes_at: '18:00' }]
      ).map((iv) => ({
        opens_at: String(iv.opens_at).slice(0, 5),
        closes_at: String(iv.closes_at).slice(0, 5),
      })),
    }))
    const res = await api.put('/api/admin/store-hours', { hours })
    assertStatus(res, [200, 204], 'set hours')
  })

  await run('onboarding-gate: GET', async () => {
    const res = await api.get('/api/admin/onboarding-gate')
    assertStatus(res, 200)
    assert('onboarding_hours_done' in (res.data || {}), 'onboarding_hours_done')
  })

  // ---- WhatsApp (no QR scan) ----
  await run('whatsapp: status endpoint responds', async () => {
    const res = await api.get('/api/admin/whatsapp/status', { expectStatus: [200, 400, 403, 404, 502, 503] })
    assertStatus(res, [200, 400, 403, 404, 502, 503], 'wa status')
    // 200 with state is ideal; plan/gateway gaps still count as reachable API
  })

  await run('whatsapp: connection-events list (history)', async () => {
    const res = await api.get('/api/admin/whatsapp/connection-events', {
      expectStatus: [200, 404, 501, 503],
    })
    if (res.status === 200) {
      assert(Array.isArray(res.data), 'events array')
      for (const ev of res.data.slice(0, 5)) {
        assertShape(ev, ['id', 'event_type', 'created_at'], 'wa event')
        assert(typeof ev.created_at === 'string' && ev.created_at.length > 4, 'event timestamp')
      }
    }
  })

  // ---- Optional cash PDV sale (mutating) ----
  if (env.allowPdvSale && createdProductId) {
    await run('pdv: create cash sale (ADMIN_TEST_ALLOW_PDV_SALE=1)', async () => {
      const res = await api.post('/api/pdv/sales', {
        items: [{ product_id: createdProductId, quantity: 1 }],
        payment_method: 'dinheiro',
        customer_name: `${env.runId}_Cliente`,
        discount_type: 'percent',
        discount_value: 0,
      })
      assertStatus(res, [200, 201], 'pdv sale')
      assertShape(res.data, ['id', 'total', 'status'], 'sale')
    })
  } else {
    console.log('  · pdv cash sale skipped (set ADMIN_TEST_ALLOW_PDV_SALE=1 to enable)')
  }

  // ---- PDV Pix (must catch 405 / missing QR) ----
  // Always runs when we still have stock on the test product. Restores qty
  // after so cleanup delete still works. Fails hard on wrong method/path or
  // empty pix_copia_cola.
  if (createdProductId) {
    let pixOrderId = null
    await run('pdv: Pix sale + create-pix-payment returns QR payload', async () => {
      // Ensure stock for the Pix sale (cash sale above may have consumed 1).
      const bump = await api.put(`/api/admin/products/${createdProductId}`, {
        name: productName,
        description: 'admin-live suite pix',
        price: 39.9,
        quantity: 10,
        image_url: null,
        category_id: createdCategoryId,
        active: true,
        cost_price: 12,
        low_stock_threshold: 3,
        barcode,
      })
      assertStatus(bump, 200)

      const salePayload = {
        items: [{ product_id: createdProductId, quantity: 1 }],
        payment_method: 'pix',
        customer_name: `${env.runId}_Pix`,
        discount_type: 'percent',
        discount_value: 0,
      }
      if (env.waPhone) {
        salePayload.customer_whatsapp = env.waPhone.startsWith('55')
          ? env.waPhone
          : `55${env.waPhone}`
      }

      const sale = await api.post('/api/pdv/sales', salePayload)
      assertStatus(sale, [200, 201], 'pdv pix sale')
      assert(sale.status !== 405, 'pdv/sales must not return 405')
      assertShape(sale.data, ['id', 'total', 'payment_method'], 'pix sale')
      assertEqual(sale.data.payment_method, 'pix', 'payment_method')
      pixOrderId = sale.data.id

      const pix = await api.post(`/api/orders/${pixOrderId}/create-pix-payment`, {}, {
        expectStatus: [200, 201, 400, 404, 405, 500, 502],
      })
      assert(
        pix.status !== 405,
        `create-pix-payment returned 405 (wrong method/path). body=${JSON.stringify(pix.data).slice(0, 200)}`,
      )
      assertStatus(pix, [200, 201], 'create-pix-payment')
      assert(
        typeof pix.data?.pix_copia_cola === 'string' && pix.data.pix_copia_cola.length > 20,
        `missing pix_copia_cola / QR payload: ${JSON.stringify(pix.data).slice(0, 300)}`,
      )
      assert(
        typeof pix.data?.pix_payment_id === 'string' && pix.data.pix_payment_id.length > 3,
        'missing pix_payment_id',
      )

      // Regenerate must also return a real payload (force=1).
      const again = await api.post(`/api/orders/${pixOrderId}/create-pix-payment?force=1`, {}, {
        expectStatus: [200, 201, 400, 404, 405, 500, 502],
      })
      assert(again.status !== 405, 'force create-pix-payment must not 405')
      assertStatus(again, [200, 201], 'create-pix-payment force')
      assert(
        typeof again.data?.pix_copia_cola === 'string' && again.data.pix_copia_cola.length > 20,
        'force regenerate missing pix_copia_cola',
      )
    })

    if (env.waPhone && pixOrderId) {
      await run('pdv: notify-pix-charge accepts WA number (no QR-login)', async () => {
        const res = await api.post('/api/pdv/notify-pix-charge', { order_id: pixOrderId }, {
          expectStatus: [200, 204, 502, 503],
        })
        assert(
          res.status !== 405,
          'notify-pix-charge must not return 405',
        )
        // 502/503 = Evolution down — still proves our route+payload; 200/204 = sent/queued
        assertStatus(res, [200, 204, 502, 503], 'notify-pix-charge')
      })

      await run('pdv: notify-sale (confirmation) after Pix', async () => {
        const res = await api.post('/api/pdv/notify-sale', { order_id: pixOrderId }, {
          expectStatus: [200, 204, 502, 503],
        })
        assert(res.status !== 405, 'notify-sale must not return 405')
        assertStatus(res, [200, 204, 502, 503], 'notify-sale')
      })
    } else {
      console.log('  · pdv WA notify skipped (set ADMIN_TEST_WA_PHONE to exercise Evolution send)')
      if (pixOrderId) {
        await run('pdv: notify-sale marks Pix paid (no WA)', async () => {
          const res = await api.post('/api/pdv/notify-sale', { order_id: pixOrderId }, {
            expectStatus: [200, 204],
          })
          assertStatus(res, [200, 204], 'notify-sale')
        })
      }
    }
  }

  // ---- Cleanup ----
  await run('cleanup: delete TEST product', async () => {
    if (!createdProductId) return
    const res = await api.delete(`/api/admin/products/${createdProductId}`, {
      expectStatus: [200, 204],
    })
    assertStatus(res, [200, 204], 'delete product')
    const list = await api.get('/api/admin/products')
    assert(!list.data.some((p) => p.id === createdProductId), 'product still listed after delete')
  })

  if (env.databaseUrl && createdProductId) {
    await run('cleanup: DB product gone', async () => {
      await withDb(env.databaseUrl, async (client) => {
        await assertProductGone(client, createdProductId)
      })
    })
  }

  await run('cleanup: delete TEST category', async () => {
    if (!createdCategoryId) return
    const res = await api.delete(`/api/admin/categories/${createdCategoryId}`, {
      expectStatus: [200, 204],
    })
    assertStatus(res, [200, 204], 'delete category')
  })

  // Best-effort orphan cleanup from prior interrupted runs
  await run('cleanup: sweep leftover TEST_* products for this tenant', async () => {
    const list = await api.get('/api/admin/products')
    const leftovers = (list.data || []).filter((p) => String(p.name || '').startsWith('TEST_'))
    for (const p of leftovers) {
      await api.delete(`/api/admin/products/${p.id}`, { expectStatus: [200, 204, 404] })
    }
    const cats = await api.get('/api/admin/categories')
    const leftoverCats = (cats.data || []).filter((c) => String(c.name || '').startsWith('TEST_'))
    for (const c of leftoverCats) {
      await api.delete(`/api/admin/categories/${c.id}`, { expectStatus: [200, 204, 404] })
    }
  })

  const failed = results.filter((r) => !r.ok)
  console.log('')
  console.log(`Done: ${results.filter((r) => r.ok).length}/${results.length} passed`)
  if (failed.length) {
    console.error('Failed:')
    for (const f of failed) console.error(`  - ${f.name}: ${f.error}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
