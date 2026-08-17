/**
 * Testes de regressão pra bugs documentados em docs/bugs/registry.yaml —
 * real HTTP, sem mock, mesmo padrão de tests/admin-live/run.mjs (reusa o
 * mesmo lib/). Cada teste é nomeado `run('BUG-XXX: descrição', ...)` — é
 * esse prefixo que scripts/check-bug-coverage.mjs procura pra confirmar
 * que um bug crítico documentado tem cobertura de verdade.
 *
 * Usage (from ecommerce/frontend):
 *   npm run test:bug-regressions
 *
 * Precisa das mesmas env vars de tests/admin-live (ver README.md lá) —
 * usa o mesmo requireLiveEnv().
 */

import { requireLiveEnv } from '../admin-live/lib/loadEnv.mjs'
import { createClient, HttpError } from '../admin-live/lib/client.mjs'
import { assert, assertStatus } from '../admin-live/lib/assert.mjs'

const ASSISTANT_IA_URL = process.env.ASSISTANT_IA_URL || 'https://assistant-ia-production.up.railway.app'

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  let env
  try {
    env = requireLiveEnv()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  console.log('Bug regression suite')
  console.log(`  API: ${env.baseUrl}`)
  console.log(`  assistant-ia: ${ASSISTANT_IA_URL}`)
  console.log(`  tenant: ${env.tenant}`)
  console.log('')

  const anon = createClient(env.baseUrl)

  // ---- Login (necessário pros testes que usam os proxies de admin) ----
  let api
  await run('login: POST /api/auth/admin/login returns JWT', async () => {
    const res = await anon.post('/api/auth/admin/login', {
      email: env.email,
      password: env.password,
      tenant_slug: env.tenant,
    })
    assertStatus(res, 200, 'login')
    assert(res.data?.token, 'login response missing token')
    api = anon.withToken(res.data.token)
  })

  if (!api) {
    console.error('Login falhou — abortando o resto da suíte (todos os outros testes dependem de auth).')
    printSummaryAndExit()
    return
  }

  // ---- BUG-004: assistant-ia sem autenticação (vazamento de config/chave) ----
  await run('BUG-004: assistant-ia config rejeita chamada sem autenticação', async () => {
    const res = await fetch(`${ASSISTANT_IA_URL}/api/tenants/${env.tenant}/config`)
    assert(res.status === 401, `esperava 401 sem auth, recebeu ${res.status} — rota pode estar aberta de novo`)
  })

  await run('BUG-004: assistant-ia rag/documents rejeita chamada sem autenticação', async () => {
    const res = await fetch(`${ASSISTANT_IA_URL}/api/tenants/${env.tenant}/rag/documents`)
    assert(res.status === 401, `esperava 401 sem auth, recebeu ${res.status}`)
  })

  await run('BUG-004: assistant-ia conversations rejeita chamada sem autenticação', async () => {
    const res = await fetch(`${ASSISTANT_IA_URL}/api/tenants/${env.tenant}/conversations`)
    assert(res.status === 401, `esperava 401 sem auth, recebeu ${res.status}`)
  })

  await run('BUG-004: proxy autenticado (ecommerce-api) continua funcionando', async () => {
    const res = await api.get('/api/admin/assistant-ia/conversations')
    assertStatus(res, 200, 'conversations via proxy')
    assert(Array.isArray(res.data), 'esperava array de conversas')
  })

  // ---- BUG-001: whatsapp connect/logout nunca devolvem erro cru do Evolution API ----
  await run('BUG-001: whatsapp status não quebra com erro cru do Evolution API', async () => {
    let res
    try {
      res = await api.get('/api/admin/whatsapp/status')
    } catch (err) {
      if (err instanceof HttpError) {
        assert(
          !/evolution api returned 500/i.test(JSON.stringify(err.body)),
          `status vazou erro cru do Evolution API: ${err.message}`,
        )
        return // outro tipo de erro (ex: feature desabilitada) não é o que este teste guarda
      }
      throw err
    }
    assert(res.status === 200, `esperava 200, recebeu ${res.status}`)
  })

  // ---- BUG-013: "Novo Chat" (simulate-message) cria conversa com mensagem natural, sem keyword especial ----
  let testConversationId = null
  const testPhone = `5500${Date.now().toString().slice(-9)}`
  await run('BUG-013: simulate-message com mensagem natural cria conversa (sem precisar de keyword mágica)', async () => {
    const sendRes = await api.post('/api/admin/assistant-ia/simulate-message', {
      phone: testPhone,
      text: 'oi, bom dia',
      customer_name: 'Bug Regression Test',
    })
    assertStatus(sendRes, 204, 'simulate-message')

    // O pipeline do assistant-ia é assíncrono (debounce + chamada de IA) —
    // poll com timeout generoso em vez de um sleep fixo único.
    let found = null
    for (let i = 0; i < 10 && !found; i++) {
      await sleep(3000)
      const listRes = await api.get('/api/admin/assistant-ia/conversations')
      found = (listRes.data || []).find((c) => c.phone === testPhone)
    }
    assert(found, `conversa com phone=${testPhone} nunca apareceu — "Novo Chat" pode estar bloqueado de novo por start_keywords`)
    testConversationId = found.id
  })

  if (testConversationId) {
    await run('BUG-013: cleanup — apaga a conversa de teste', async () => {
      const res = await api.delete(`/api/admin/assistant-ia/conversations/${testConversationId}`)
      assertStatus(res, 204, 'delete test conversation')
    })
  }

  // ---- BUG-014: cálculo de frete (OSRM público) não pode voltar a devolver 403/"osrm route failed" ----
  await run('BUG-014: estimate-delivery calcula frete real (OSRM não bloqueia por falta de User-Agent)', async () => {
    const res = await fetch(`${env.baseUrl}/api/public/catalog/${env.tenant}/estimate-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: -7.1974421, lng: -34.855651 }),
    })
    const body = await res.json().catch(() => ({}))
    assert(res.status === 200, `esperava 200, recebeu ${res.status} — body: ${JSON.stringify(body)} (OSRM pode estar bloqueando de novo)`)
    assert(typeof body.price === 'number' && body.price > 0, `price inválido: ${JSON.stringify(body)}`)
    assert(typeof body.eta_minutes === 'number', `eta_minutes ausente: ${JSON.stringify(body)}`)
  })

  printSummaryAndExit()
}

function printSummaryAndExit() {
  const failed = results.filter((r) => !r.ok)
  console.log('')
  console.log(`${results.length - failed.length}/${results.length} passaram`)
  if (failed.length > 0) {
    console.log('Falhas:')
    for (const f of failed) console.log(`  - ${f.name}: ${f.error}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Erro fatal na suíte:', err)
  process.exit(1)
})
