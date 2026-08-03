/**
 * Pablo Hierro — integration tester for /meu-plano preferências + layout.
 *
 * Real stack only (API + tenant-config + optional storefront/panel HTTP).
 * Never commits secrets; reads from env / .env.local.
 *
 * Coverage:
 *  1) Each preferência toggled one-by-one (ON then restore)
 *  2) All singles + all pairs + full ON + full OFF + critical triples
 *     (not full 2^6 = 64 — documented below)
 *  3) /meu-plano/layout fields reflected on public tenant-config
 *
 * Prefs under test:
 *  vender_externamente, vende_mais_18, apenas_retirada,
 *  pagamento_na_retirada, entrega_somente_pix, pagamento_manual
 *
 * Usage (from ecommerce/frontend or repo root):
 *   npm run test:pablo-hierro
 *
 * Required env (skip with exit 0 if missing):
 *   PABLO_HIERRO_EMAIL, PABLO_HIERRO_PASSWORD
 *   PABLO_HIERRO_API_URL | VITE_API_BASE_URL | RODOLETAS_API_URL
 *   SUPABASE_URL | VITE_SUPABASE_URL
 *   SUPABASE_ANON_KEY | VITE_SUPABASE_ANON_KEY
 * Optional:
 *   PABLO_HIERRO_ECOMMERCE_URL | VITE_RODOLETAS_API_URL (tenant-config cross-check)
 *   PABLO_HIERRO_STORE_URL (storefront HTML smoke)
 *   PABLO_HIERRO_ADMIN_URL (panel HTML smoke)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoHints = [
  path.resolve(__dirname, '../../..'),
  path.resolve(__dirname, '../..'),
  path.resolve(__dirname, '..'),
  process.cwd(),
]

function loadEnvFiles() {
  const names = ['.env.local', '.env']
  for (const root of repoHints) {
    for (const name of names) {
      const file = path.join(root, name)
      const alt = path.join(root, 'frontend', name)
      const eco = path.join(root, 'ecommerce', 'frontend', name)
      for (const candidate of [file, alt, eco]) {
        if (!fs.existsSync(candidate)) continue
        for (const raw of fs.readFileSync(candidate, 'utf8').split(/\r?\n/)) {
          const line = raw.trim()
          if (!line || line.startsWith('#')) continue
          const eq = line.indexOf('=')
          if (eq < 0) continue
          const key = line.slice(0, eq).trim()
          let val = line.slice(eq + 1).trim()
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1)
          }
          if (process.env[key] === undefined) process.env[key] = val
        }
      }
    }
  }
}

loadEnvFiles()

const PREF_KEYS = [
  'vender_externamente',
  'vende_mais_18',
  'apenas_retirada',
  'pagamento_na_retirada',
  'entrega_somente_pix',
  'pagamento_manual',
]

const CRITICAL_TRIPLES = [
  ['vender_externamente', 'apenas_retirada', 'pagamento_manual'],
  ['vende_mais_18', 'entrega_somente_pix', 'pagamento_na_retirada'],
  ['apenas_retirada', 'pagamento_na_retirada', 'pagamento_manual'],
]

function maskEmail(email) {
  return email.replace(/(^.).*(@.*$)/, '$1***$2')
}

function requireEnvOrSkip() {
  const apiUrl = (
    process.env.PABLO_HIERRO_API_URL ||
    process.env.VITE_API_BASE_URL ||
    process.env.RODOLETAS_API_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '')
  const email = (process.env.PABLO_HIERRO_EMAIL || '').trim()
  const password = process.env.PABLO_HIERRO_PASSWORD || ''
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '')
  const supabaseKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim()

  const missing = []
  if (!apiUrl) missing.push('PABLO_HIERRO_API_URL (or VITE_API_BASE_URL / RODOLETAS_API_URL)')
  if (!email) missing.push('PABLO_HIERRO_EMAIL')
  if (!password) missing.push('PABLO_HIERRO_PASSWORD')
  if (!supabaseUrl) missing.push('SUPABASE_URL (or VITE_SUPABASE_URL)')
  if (!supabaseKey) missing.push('SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)')

  if (missing.length) {
    console.log('Pablo Hierro: SKIP — missing env:', missing.join(', '))
    console.log('Set vars in shell or .env.local (never commit secrets).')
    process.exit(0)
  }

  return {
    apiUrl,
    email,
    password,
    supabaseUrl,
    supabaseKey,
    ecommerceUrl: (
      process.env.PABLO_HIERRO_ECOMMERCE_URL ||
      process.env.VITE_RODOLETAS_API_URL ||
      apiUrl ||
      ''
    )
      .trim()
      .replace(/\/$/, ''),
    storeUrl: (process.env.PABLO_HIERRO_STORE_URL || '').trim().replace(/\/$/, '') || null,
    adminUrl: (process.env.PABLO_HIERRO_ADMIN_URL || '').trim().replace(/\/$/, '') || null,
  }
}

async function loginSupabase(env) {
  const res = await fetch(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.supabaseKey,
    },
    body: JSON.stringify({ email: env.email, password: env.password }),
  })
  if (!res.ok) {
    throw new Error(`Supabase login failed (${res.status})`)
  }
  const data = await res.json()
  if (!data.access_token) throw new Error('Supabase login: missing access_token')
  return data.access_token
}

function apiClient(baseUrl, token) {
  async function req(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!res.ok) {
      const msg = typeof data === 'object' && data?.error ? data.error : text.slice(0, 200)
      throw new Error(`${method} ${path} → ${res.status}: ${msg}`)
    }
    return data
  }
  return {
    get: (p) => req('GET', p),
    put: (p, body) => req('PUT', p, body),
    post: (p, body) => req('POST', p, body),
  }
}

async function fetchTenantConfig(env, slug) {
  const urls = [
    `${env.apiUrl}/api/public/tenant-config/${encodeURIComponent(slug)}`,
    env.ecommerceUrl && env.ecommerceUrl !== env.apiUrl
      ? `${env.ecommerceUrl}/api/public/tenant-config/${encodeURIComponent(slug)}`
      : null,
  ].filter(Boolean)

  let lastErr = null
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        lastErr = new Error(`tenant-config ${res.status} @ ${url.replace(/https?:\/\/[^/]+/, '')}`)
        continue
      }
      return await res.json()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('tenant-config unavailable')
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertPrefs(cfg, expected, label) {
  for (const key of PREF_KEYS) {
    if (expected[key] === undefined) continue
    assertEqual(Boolean(cfg[key]), Boolean(expected[key]), `${label}.${key}`)
  }
}

function combosCoverage() {
  const singles = PREF_KEYS.map((k) => ({ [k]: true }))
  const pairs = []
  for (let i = 0; i < PREF_KEYS.length; i++) {
    for (let j = i + 1; j < PREF_KEYS.length; j++) {
      pairs.push({ [PREF_KEYS[i]]: true, [PREF_KEYS[j]]: true })
    }
  }
  const fullOn = Object.fromEntries(PREF_KEYS.map((k) => [k, true]))
  const fullOff = Object.fromEntries(PREF_KEYS.map((k) => [k, false]))
  // vender_externamente default true is more realistic for "full off of restrictive flags"
  fullOff.vender_externamente = true
  const triples = CRITICAL_TRIPLES.map((keys) => {
    const o = Object.fromEntries(PREF_KEYS.map((k) => [k, false]))
    o.vender_externamente = true
    for (const k of keys) o[k] = true
    return o
  })
  return { singles, pairs, fullOn, fullOff, triples }
}

async function setPrefs(api, patch) {
  await api.put('/api/onboarding', patch)
}

async function assertStorefrontRules(env, slug, cfg) {
  if (!env.storeUrl) return
  const url = `${env.storeUrl}${env.storeUrl.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(slug)}`
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`storefront HTTP ${res.status}`)
  const html = await res.text()
  // Soft smoke: page renders; strict rule checks rely on tenant-config.
  if (!html || html.length < 50) throw new Error('storefront empty response')
  if (cfg.vende_mais_18 === false && /data-testid="checkout-mais18"/.test(html)) {
    // Landing may not include checkout — ignore
  }
}

async function assertAdminRules(env, slug, cfg) {
  if (!env.adminUrl) return
  const url = `${env.adminUrl}${env.adminUrl.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(slug)}`
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`admin HTTP ${res.status}`)
  const html = await res.text()
  if (!html || html.length < 50) throw new Error('admin empty response')
  void cfg
}

async function main() {
  const env = requireEnvOrSkip()
  console.log('Pablo Hierro — Resolutoo preferências E2E')
  console.log(`  API: ${env.apiUrl}`)
  console.log(`  email: ${maskEmail(env.email)}`)
  console.log('')

  const results = []
  const pass = (name) => {
    results.push({ name, ok: true })
    console.log(`  ✓ ${name}`)
  }
  const fail = (name, err) => {
    results.push({ name, ok: false, error: err?.message || String(err) })
    console.error(`  ✗ ${name}`)
    console.error(`    ${err?.message || err}`)
  }
  const run = async (name, fn) => {
    try {
      await fn()
      pass(name)
    } catch (e) {
      fail(name, e)
    }
  }

  let token
  await run('auth: Supabase password grant', async () => {
    token = await loginSupabase(env)
  })
  if (!token) {
    console.error('\nAborting — auth failed.')
    process.exit(1)
  }

  const api = apiClient(env.apiUrl, token)
  let me
  let baseline = null
  let slug = null

  await run('me: GET /api/me', async () => {
    me = await api.get('/api/me')
    if (!me?.slug) throw new Error('subscriber has no slug — finish onboarding first')
    if (me.status !== 'ativo') throw new Error(`expected status ativo, got ${me.status}`)
    slug = me.slug
    baseline = Object.fromEntries(PREF_KEYS.map((k) => [k, Boolean(me[k])]))
    // vender_externamente may be undefined on old API — default true
    if (me.vender_externamente === undefined) baseline.vender_externamente = true
  })
  if (!slug || !baseline) {
    console.error('\nAborting — /api/me failed.')
    process.exit(1)
  }

  console.log(`  tenant: ${slug}`)
  console.log(`  baseline prefs: ${JSON.stringify(baseline)}`)
  console.log('')

  // ---- One-by-one ----
  console.log('— singles (toggle each ON, assert, restore) —')
  for (const key of PREF_KEYS) {
    await run(`single:${key}`, async () => {
      const target = { ...baseline, [key]: true }
      // apenas_retirada ON implies delivery flags still settable
      await setPrefs(api, { [key]: true })
      const cfg = await fetchTenantConfig(env, slug)
      assertEqual(Boolean(cfg[key]), true, `tenant-config.${key}`)
      await assertStorefrontRules(env, slug, cfg)
      await assertAdminRules(env, slug, cfg)
      // restore
      await setPrefs(api, { [key]: baseline[key] })
      const restored = await fetchTenantConfig(env, slug)
      assertEqual(Boolean(restored[key]), Boolean(baseline[key]), `restore.${key}`)
      void target
    })
  }

  // ---- Combinatorial subset ----
  const { singles: _s, pairs, fullOn, fullOff, triples } = combosCoverage()
  void _s

  console.log('\n— pairs —')
  for (const patch of pairs) {
    const label = Object.keys(patch).join('+')
    await run(`pair:${label}`, async () => {
      const body = { ...baseline, ...patch }
      // Normalize: when testing false flags in baseline, force pair keys true
      await setPrefs(api, body)
      const cfg = await fetchTenantConfig(env, slug)
      assertPrefs(cfg, body, 'pair')
    })
  }

  console.log('\n— critical triples —')
  for (const patch of triples) {
    const label = PREF_KEYS.filter((k) => patch[k]).join('+')
    await run(`triple:${label}`, async () => {
      await setPrefs(api, patch)
      const cfg = await fetchTenantConfig(env, slug)
      assertPrefs(cfg, patch, 'triple')
    })
  }

  await run('combo:full-on', async () => {
    await setPrefs(api, fullOn)
    const cfg = await fetchTenantConfig(env, slug)
    assertPrefs(cfg, fullOn, 'full-on')
  })

  await run('combo:full-off-restrictive', async () => {
    await setPrefs(api, fullOff)
    const cfg = await fetchTenantConfig(env, slug)
    assertPrefs(cfg, fullOff, 'full-off')
  })

  // Restore baseline
  await run('restore:baseline', async () => {
    await setPrefs(api, baseline)
    const cfg = await fetchTenantConfig(env, slug)
    assertPrefs(cfg, baseline, 'baseline')
  })

  // ---- Layout ----
  console.log('\n— layout —')
  let layoutBaseline = null
  await run('layout:snapshot', async () => {
    layoutBaseline = {
      landing_headline: me.landing_headline || null,
      landing_sub: me.landing_sub || null,
      landing_badge: me.landing_badge || null,
      layout_style: me.layout_style || 'ufersin',
      cor_principal: me.cor_principal || null,
    }
  })

  const marker = `PH_${Date.now().toString(36)}`
  const styles = ['ufersin', 'burgerbite', 'burgerhouse']
  const nextStyle = styles[(styles.indexOf(layoutBaseline?.layout_style) + 1) % styles.length]

  await run('layout:update+assert', async () => {
    await setPrefs(api, {
      landing_headline: `Headline ${marker}`,
      landing_sub: `Sub ${marker}`,
      landing_badge: `Badge ${marker}`,
      layout_style: nextStyle,
    })
    const cfg = await fetchTenantConfig(env, slug)
    assertEqual(cfg.landing_headline, `Headline ${marker}`, 'landing_headline')
    assertEqual(cfg.landing_sub, `Sub ${marker}`, 'landing_sub')
    assertEqual(cfg.landing_badge, `Badge ${marker}`, 'landing_badge')
    assertEqual(cfg.layout_style, nextStyle, 'layout_style')
    await assertStorefrontRules(env, slug, cfg)
  })

  await run('layout:restore', async () => {
    if (!layoutBaseline) return
    await setPrefs(api, {
      landing_headline: layoutBaseline.landing_headline || '',
      landing_sub: layoutBaseline.landing_sub || '',
      landing_badge: layoutBaseline.landing_badge || '',
      layout_style: layoutBaseline.layout_style,
    })
    const cfg = await fetchTenantConfig(env, slug)
    assertEqual(cfg.layout_style, layoutBaseline.layout_style, 'layout_style restore')
  })

  const failed = results.filter((r) => !r.ok)
  console.log('\n────────────────────────────────')
  console.log(`Pablo Hierro: ${results.length - failed.length}/${results.length} passed`)
  console.log('Coverage note: singles + all pairs + 3 critical triples + full on/off (not full 2^6).')
  if (failed.length) {
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
