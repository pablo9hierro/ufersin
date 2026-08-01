#!/usr/bin/env node
/**
 * Smoke-test Mercado Pago credentials for Resolutoo plan subscriptions.
 *
 * Reads secrets from the environment only — never hardcode tokens here.
 *
 * Usage (PowerShell):
 *   $env:MP_ACCESS_TOKEN="TEST-..."
 *   $env:BACK_URL="https://resolutoo.com/obrigado"
 *   node scripts/test-mp-subscription.mjs
 *
 * Optional:
 *   MP_TEST_EMAIL=buyer@testuser.com
 *   MP_SKIP_PREAPPROVAL=1   (only validate /users/me)
 *
 * Checks:
 *   1. GET /users/me
 *   2. POST /preapproval (pending) — may 500 on some TEST accounts
 *   3. POST /preapproval_plan — fallback used by backend when (2) fails
 *   4. GET /preapproval/search?preapproval_plan_id=…
 *   5. Cleanup: cancel plan when created
 */

const token = (process.env.MP_ACCESS_TOKEN || '').trim()
const backUrl = (process.env.BACK_URL || 'https://resolutoo.com/obrigado').trim()
const payerEmail = (process.env.MP_TEST_EMAIL || 'test_user_mp@testuser.com').trim()
const skipPreapproval = process.env.MP_SKIP_PREAPPROVAL === '1'

if (!token) {
  console.error('Missing MP_ACCESS_TOKEN. Set it in the env (Railway / local .env), then re-run.')
  console.error('Example: MP_ACCESS_TOKEN=TEST-... node scripts/test-mp-subscription.mjs')
  process.exit(1)
}

const isTest = token.startsWith('TEST-')
const mask = (s) => (s.length <= 12 ? '***' : `${s.slice(0, 8)}…${s.slice(-4)}`)

console.log('=== Mercado Pago subscription smoke test ===')
console.log(`token: ${mask(token)} (${isTest ? 'TEST' : 'prod-looking'})`)
console.log(`back_url: ${backUrl}`)
console.log(`payer_email: ${payerEmail}`)
console.log('')

async function mp(method, path, body) {
  const resp = await fetch(`https://api.mercadopago.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await resp.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 400) }
  }
  return { ok: resp.ok, status: resp.status, json }
}

let failed = 0
let warnings = 0

// 1) Validate token
{
  const r = await mp('GET', '/users/me')
  if (!r.ok) {
    console.error(`[FAIL] GET /users/me → HTTP ${r.status}`, r.json?.message || r.json)
    failed++
  } else {
    console.log(`[OK]   GET /users/me → id=${r.json?.id} site=${r.json?.site_id}`)
  }
}

if (skipPreapproval) {
  process.exit(failed ? 1 : 0)
}

const externalRef = `mp-smoke-${Date.now()}`
const completion = backUrl.includes('?')
  ? `${backUrl}&id=${externalRef}`
  : `${backUrl}?id=${externalRef}`

let preapprovalOk = false
let planId = null

// 2) Direct pending preapproval (backend primary path)
{
  const body = {
    reason: 'Resolutoo smoke test — Essential mensal',
    external_reference: externalRef,
    payer_email: payerEmail,
    back_url: completion,
    status: 'pending',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: 60,
      currency_id: 'BRL',
    },
  }
  const r = await mp('POST', '/preapproval', body)
  if (!r.ok) {
    console.warn(`[WARN] POST /preapproval → HTTP ${r.status} (${r.json?.message || 'no message'})`)
    console.warn('       Backend will fall back to /preapproval_plan (expected on some TEST accounts).')
    warnings++
  } else {
    const init = r.json?.init_point || r.json?.sandbox_init_point
    console.log(`[OK]   POST /preapproval → id=${r.json?.id} init_point=${init ? 'yes' : 'MISSING'}`)
    preapprovalOk = Boolean(init)
    if (r.json?.id) {
      await mp('PUT', `/preapproval/${r.json.id}`, { status: 'cancelled' })
      console.log(`[OK]   cleaned up preapproval ${r.json.id}`)
    }
    if (!init) {
      console.error('[FAIL] preapproval sem init_point')
      failed++
    }
  }
}

// 3) preapproval_plan fallback (required if step 2 failed)
{
  const body = {
    reason: `Resolutoo smoke plan [${externalRef}]`,
    back_url: completion,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: 60,
      currency_id: 'BRL',
    },
  }
  const r = await mp('POST', '/preapproval_plan', body)
  if (!r.ok) {
    console.error(`[FAIL] POST /preapproval_plan → HTTP ${r.status}`)
    console.error(JSON.stringify(r.json, null, 2).slice(0, 800))
    failed++
  } else {
    planId = r.json?.id
    const init = r.json?.init_point || r.json?.sandbox_init_point
    console.log(`[OK]   POST /preapproval_plan → id=${planId}`)
    console.log(`       status=${r.json?.status} init_point=${init ? 'yes' : 'MISSING'}`)
    if (!init) {
      console.error('[FAIL] plan sem init_point')
      failed++
    }
  }
}

// 4) Search by plan (status polling path)
if (planId) {
  const r = await mp('GET', `/preapproval/search?preapproval_plan_id=${planId}`)
  if (!r.ok) {
    console.error(`[FAIL] GET /preapproval/search → HTTP ${r.status}`, r.json)
    failed++
  } else {
    const n = r.json?.results?.length ?? 0
    console.log(`[OK]   GET /preapproval/search → ${n} result(s) (0 expected before checkout)`)
  }

  const c = await mp('PUT', `/preapproval_plan/${planId}`, { status: 'cancelled' })
  if (!c.ok) {
    console.warn(`[WARN] PUT cancel plan → HTTP ${c.status}`, c.json?.message || '')
    warnings++
  } else {
    console.log(`[OK]   PUT /preapproval_plan/{id} cancelled`)
  }
}

console.log('')
if (!preapprovalOk && planId) {
  console.log('Note: /preapproval pending failed; /preapproval_plan works — matches backend fallback.')
}
if (failed) {
  console.error(`Done with ${failed} failure(s), ${warnings} warning(s).`)
  process.exit(1)
}
console.log(`All required checks passed (${warnings} warning(s)).`)
process.exit(0)
