#!/usr/bin/env node
/**
 * Smoke test das camadas críticas de auth + assinatura da Rodoletas.
 *
 * Camadas cobertas:
 *  1. Frontend env (Vercel): bundle não usa placeholder.supabase.co
 *  2. Supabase Auth (signUp / signIn / JWT)
 *  3. ufersin-api /health + CORS
 *  4. Bootstrap (POST /api/auth/bootstrap com JWT)
 *  5. Assinatura (POST /api/assinaturas mensal e semestral)
 *
 * Uso:
 *   node scripts/test-auth.mjs
 *
 * Env opcionais:
 *   FRONTEND_URL, API_URL, SUPABASE_URL, SUPABASE_ANON_KEY
 */

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://resolutoo.com').replace(/\/$/, '')
const API_URL = (process.env.API_URL || 'https://ufersin-api-production.up.railway.app').replace(/\/$/, '')
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://migkkrwzykpztrakbfij.supabase.co').replace(/\/$/, '')
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pZ2trcnd6eWtwenRyYWtiZmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NjI2OTQsImV4cCI6MjA5MTUzODY5NH0.0bEy_WikqnfPU9eV7wusSb757dhiTiK5D2KeDSWyJTo'

const stamp = Date.now()
const email = `auth-test-${stamp}@rodoletas.test`
const password = `TestAuth!${stamp}Aa`
const results = []

function ok(name, detail = '') {
  results.push({ name, pass: true, detail })
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, detail) {
  results.push({ name, pass: false, detail })
  console.error(`✗ ${name} — ${detail}`)
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { res, body, text }
}

async function layerFrontendBundle() {
  const page = await fetch(FRONTEND_URL + '/login')
  if (!page.ok) return fail('frontend /login', `HTTP ${page.status}`)
  const html = await page.text()
  const match = html.match(/\/assets\/index-[^"]+\.js/)
  if (!match) return fail('frontend bundle', 'não achou index-*.js no HTML')
  const jsUrl = FRONTEND_URL + match[0]
  const js = await (await fetch(jsUrl)).text()
  if (js.includes('placeholder.supabase.co')) {
    return fail('frontend env Supabase', 'bundle ainda usa placeholder — redeploy Vercel com VITE_SUPABASE_*')
  }
  if (!js.includes(SUPABASE_URL.replace('https://', '')) && !js.includes('migkkrwzykpztrakbfij')) {
    return fail('frontend env Supabase', 'URL do projeto Supabase não aparece no bundle')
  }
  if (js.includes('localhost:8080') && !js.includes('ufersin-api-production')) {
    return fail('frontend env API', 'VITE_API_BASE_URL parece apontar pra localhost')
  }
  ok('frontend env', `bundle ${match[0]} com Supabase real`)
}

async function layerApiHealth() {
  const { res, text } = await fetchJson(API_URL + '/health')
  if (!res.ok) return fail('api /health', `HTTP ${res.status} ${text}`)
  ok('api /health', text.slice(0, 80))

  const opt = await fetch(API_URL + '/api/me', {
    method: 'OPTIONS',
    headers: {
      Origin: FRONTEND_URL,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  })
  const allow = opt.headers.get('access-control-allow-origin')
  if (!allow || (allow !== '*' && allow !== FRONTEND_URL)) {
    return fail('api CORS', `Access-Control-Allow-Origin=${allow}`)
  }
  ok('api CORS', `Allow-Origin=${allow}`)
}

async function layerSupabaseAuth() {
  const signup = await fetchJson(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  if (!signup.res.ok) {
    return fail('supabase signUp', `${signup.res.status} ${JSON.stringify(signup.body)}`)
  }

  // Alguns projetos exigem confirm email — aí session vem null.
  let accessToken = signup.body?.access_token || signup.body?.session?.access_token
  if (!accessToken) {
    const signin = await fetchJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    })
    if (!signin.res.ok) {
      // Confirm email obrigatório — não é erro crítico se o signup criou o user.
      if (signup.body?.user?.id) {
        ok('supabase signUp', `user=${signup.body.user.id} (confirm email ligado — signIn bloqueado até confirmar)`)
        return { accessToken: null, userId: signup.body.user.id, emailConfirmRequired: true }
      }
      return fail('supabase signIn', `${signin.res.status} ${JSON.stringify(signin.body)}`)
    }
    accessToken = signin.body.access_token
  }

  if (!accessToken) return fail('supabase JWT', 'sem access_token')
  ok('supabase auth', `JWT ok para ${email}`)
  const userId = signup.body?.user?.id || signup.body?.id
  return { accessToken, userId, emailConfirmRequired: false }
}

async function layerBootstrapAndAssinatura(accessToken) {
  if (!accessToken) {
    fail('bootstrap', 'pulado — confirme e-mail no Supabase Auth Settings (desligar Confirm email em sandbox) ou confirme o user')
    fail('assinatura', 'pulado — depende do bootstrap')
    return
  }

  const boot = await fetchJson(API_URL + '/api/auth/bootstrap', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Origin: FRONTEND_URL,
    },
    body: JSON.stringify({
      loja_nome: 'Loja Teste Auth',
      responsavel_nome: 'Teste Auth',
      whatsapp: '5583999999999',
      senha: password,
    }),
  })
  if (!boot.res.ok) {
    return fail('bootstrap', `${boot.res.status} ${JSON.stringify(boot.body)}`)
  }
  ok('bootstrap', `id=${boot.body?.id} ja_existia=${boot.body?.ja_existia}`)

  const mensal = await fetchJson(API_URL + '/api/assinaturas', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Origin: FRONTEND_URL,
    },
    body: JSON.stringify({ plano: 'essential', metodo: 'pix', ciclo: 'mensal' }),
  })
  if (!mensal.res.ok) {
    return fail('assinatura mensal', `${mensal.res.status} ${JSON.stringify(mensal.body)}`)
  }
  if (!mensal.body?.pix_qr_code && !mensal.body?.checkout_url) {
    return fail('assinatura mensal', 'sem pix_qr_code nem checkout_url')
  }
  ok('assinatura mensal', `id=${mensal.body.id} pix=${Boolean(mensal.body.pix_qr_code)}`)

  // Segunda assinatura deve falhar (já pendente) — valida a camada de negócio.
  const again = await fetchJson(API_URL + '/api/assinaturas', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ plano: 'essential', metodo: 'pix', ciclo: 'semestral' }),
  })
  if (again.res.status === 400) {
    ok('assinatura bloqueia duplicata', again.body?.error || '400')
  } else {
    fail('assinatura bloqueia duplicata', `esperado 400, veio ${again.res.status}`)
  }

  const me = await fetchJson(API_URL + '/api/me', {
    headers: { Authorization: `Bearer ${accessToken}`, Origin: FRONTEND_URL },
  })
  if (!me.res.ok) return fail('api /me', `${me.res.status} ${JSON.stringify(me.body)}`)
  if (me.body?.plano !== 'essential') return fail('api /me plano', JSON.stringify(me.body))
  ok('api /me', `plano=${me.body.plano} status=${me.body.status} ciclo=${me.body.billing_cycle}`)
}

async function main() {
  console.log('=== Rodoletas auth smoke test ===')
  console.log(`frontend=${FRONTEND_URL}`)
  console.log(`api=${API_URL}`)
  console.log(`supabase=${SUPABASE_URL}`)
  console.log(`email=${email}`)
  console.log('')

  await layerFrontendBundle()
  await layerApiHealth()
  const auth = await layerSupabaseAuth()
  if (auth?.accessToken !== undefined) {
    await layerBootstrapAndAssinatura(auth.accessToken)
  }

  const failed = results.filter((r) => !r.pass)
  console.log('')
  console.log(`Resultado: ${results.length - failed.length}/${results.length} ok`)
  if (failed.length) {
    console.error('Falhas críticas:')
    for (const f of failed) console.error(` - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
