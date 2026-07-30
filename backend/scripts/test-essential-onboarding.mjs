// Teste de ponta a ponta do plano Essential: login/cadastro > assinar >
// onboarding > site funcionando de acordo com o onboarding.
//
// Roda contra os backends de verdade rodando localmente (ufersin/backend
// na porta 8081, ecommerce/backend na porta 8080) -- não é um teste
// unitário mockado, é o fluxo real batendo nos 2 serviços + banco.
//
// Um usuário por permutação de onboarding (vender_externamente x
// whatsapp_habilitado x forma_pagamento[+plataforma]) -- 16 no total.
// Pra cada um: cria a assinatura, confirma o pagamento (bypass direto no
// banco -- testar o gateway de pagamento em si é outro teste, não o
// escopo aqui), finaliza o onboarding com aquela combinação específica,
// e confirma que /api/public/tenant-config/:slug (o que o ecommerce/
// frontend consome pra aplicar o gating) reflete exatamente o que foi
// enviado. Também testa a edição via PUT /api/onboarding (o que
// /meu-plano usa) trocando um campo e conferindo que o tenant-config
// muda também.
//
// Uso: node scripts/test-essential-onboarding.mjs
// (precisa dos 2 backends + o Postgres do ufersin/backend já rodando)

import { execSync } from 'node:child_process'

const RODOLETAS_API = process.env.RODOLETAS_API_URL || 'http://localhost:8081'
const RUN_ID = Date.now().toString(36)

const PLATAFORMAS = ['mercado_pago', 'pagbank', 'abacate_pay']

/** 2 (vender_externamente) x 2 (whatsapp_habilitado) x 4 (manual + 3 plataformas) = 16 permutações. */
function buildPermutations() {
  const perms = []
  for (const vender_externamente of [true, false]) {
    for (const whatsapp_habilitado of [true, false]) {
      for (const forma_pagamento of ['manual', 'plataforma']) {
        if (forma_pagamento === 'manual') {
          perms.push({ vender_externamente, whatsapp_habilitado, forma_pagamento, plataforma_pagamento: null })
        } else {
          for (const plataforma_pagamento of PLATAFORMAS) {
            perms.push({ vender_externamente, whatsapp_habilitado, forma_pagamento, plataforma_pagamento })
          }
        }
      }
    }
  }
  return perms
}

function labelFor(perm, i) {
  const pag = perm.forma_pagamento === 'manual' ? 'manual' : `plataforma:${perm.plataforma_pagamento}`
  return `#${i + 1} vender_externamente=${perm.vender_externamente} whatsapp=${perm.whatsapp_habilitado} pagamento=${pag}`
}

async function req(method, path, body, token) {
  const res = await fetch(`${RODOLETAS_API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = text
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`)
  }
  return json
}

/** Bypass do gateway de pagamento -- confirma a assinatura direto no
 *  banco (mesma transição que status_assinatura faria ao ver o gateway
 *  confirmar). O gateway em si (Mercado Pago/AbacatePay) é integração
 *  separada, já teria seu próprio teste; aqui o alvo é o pipeline de
 *  onboarding, não a cobrança. */
function confirmarPagamentoNoBanco(subscriberId) {
  const sql = `UPDATE subscribers SET status='ativo', onboarding_status='aguardando_onboarding', updated_at=now() WHERE id='${subscriberId}';`
  execSync(`docker exec rodoletas-postgres-1 psql -U postgres -d postgres -c "${sql}"`, { stdio: 'pipe' })
}

async function runPermutation(perm, index) {
  const label = labelFor(perm, index)
  const suffix = `${RUN_ID}-${index}`
  const email = `essential-test-${suffix}@teste.local`
  const slug = `essential-test-${suffix}`

  // 1. Cadastro (login >> a conta já nasce "logada", ver criar_assinatura).
  const assinatura = await req('POST', '/api/assinaturas', {
    loja_nome: `Loja Teste ${suffix}`,
    responsavel_nome: 'Responsável Teste',
    whatsapp: '5583999990000',
    email,
    senha: 'senha12345',
    plano: 'essential',
    metodo: 'pix',
  })

  // 2. Assinar >> confirmar pagamento (bypass do gateway, ver comentário acima).
  confirmarPagamentoNoBanco(assinatura.id)

  // 3. Onboarding com a combinação desta permutação.
  const credenciais = perm.forma_pagamento === 'plataforma' ? { token: `mock-cred-${suffix}` } : undefined
  const onboardingOut = await req(
    'POST',
    '/api/onboarding',
    {
      nome_loja: `Loja Teste ${suffix}`,
      categoria: 'Alimentação',
      whatsapp: perm.whatsapp_habilitado ? '5583999990000' : '',
      endereco: 'Rua Teste, 123',
      cor_principal: '#0f5132',
      slug,
      documento: '12345678000199',
      tipo_documento: 'cnpj',
      vender_externamente: perm.vender_externamente,
      whatsapp_habilitado: perm.whatsapp_habilitado,
      forma_pagamento: perm.forma_pagamento,
      plataforma_pagamento: perm.plataforma_pagamento ?? undefined,
      plataforma_credenciais: credenciais,
    },
    assinatura.token
  )
  if (!onboardingOut.tenant_id) throw new Error('onboarding não devolveu tenant_id (provision-tenant falhou?)')

  // 4. "Site funcionando de acordo com o onboarding" -- o que o
  //    ecommerce/frontend consulta pra aplicar o gating.
  const config = await req('GET', `/api/public/tenant-config/${slug}`)
  assertEqual(config.vender_externamente, perm.vender_externamente, `${label}: tenant-config.vender_externamente`)
  assertEqual(config.whatsapp_habilitado, perm.whatsapp_habilitado, `${label}: tenant-config.whatsapp_habilitado`)
  assertEqual(config.forma_pagamento, perm.forma_pagamento, `${label}: tenant-config.forma_pagamento`)
  assertEqual(config.plataforma_pagamento, perm.plataforma_pagamento, `${label}: tenant-config.plataforma_pagamento`)
  assertEqual(config.plano, 'essential', `${label}: tenant-config.plano`)

  // 5. Confere que o /api/me autenticado bate com o mesmo dado (dupla checagem,
  //    caminho usado por /meu-plano pra pré-preencher o formulário).
  const me = await req('GET', '/api/me', undefined, assinatura.token)
  assertEqual(me.vender_externamente, perm.vender_externamente, `${label}: me.vender_externamente`)
  assertEqual(me.whatsapp_habilitado, perm.whatsapp_habilitado, `${label}: me.whatsapp_habilitado`)
  assertEqual(me.forma_pagamento, perm.forma_pagamento, `${label}: me.forma_pagamento`)
  assertEqual(me.onboarding_status, 'provisionado', `${label}: me.onboarding_status`)

  // 6. Edição pós-onboarding (o que /meu-plano usa) -- inverte
  //    vender_externamente e confirma que o tenant-config muda também.
  await req('PUT', '/api/onboarding', { vender_externamente: !perm.vender_externamente }, assinatura.token)
  const configDepoisEdicao = await req('GET', `/api/public/tenant-config/${slug}`)
  assertEqual(configDepoisEdicao.vender_externamente, !perm.vender_externamente, `${label}: tenant-config após PUT (edição)`)
  // volta como estava, pra não confundir uma checagem futura no mesmo slug
  await req('PUT', '/api/onboarding', { vender_externamente: perm.vender_externamente }, assinatura.token)

  return { label, slug, tenant_id: onboardingOut.tenant_id }
}

function assertEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`)
  }
}

async function main() {
  const perms = buildPermutations()
  console.log(`Rodando ${perms.length} permutações contra ${RODOLETAS_API}...\n`)

  const results = []
  for (let i = 0; i < perms.length; i++) {
    const label = labelFor(perms[i], i)
    try {
      const r = await runPermutation(perms[i], i)
      console.log(`✅ ${label}  (slug=${r.slug}, tenant_id=${r.tenant_id})`)
      results.push({ ok: true, label })
    } catch (err) {
      console.log(`❌ ${label}`)
      console.log(`   ${err.message}`)
      results.push({ ok: false, label, error: err.message })
    }
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`\n${passed}/${results.length} permutações passaram.`)
  if (failed > 0) {
    console.log(`\nFalharam:`)
    for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.label}: ${r.error}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Erro fatal no script de teste:', err)
  process.exit(1)
})
