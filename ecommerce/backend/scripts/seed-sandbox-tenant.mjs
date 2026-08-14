#!/usr/bin/env node
/**
 * Provisiona uma loja de teste do ramo eletrônicos com uma conta Mercado Pago
 * SIMULADA, para validar o fluxo de pagamento ponta a ponta sem conta real e
 * sem dinheiro envolvido.
 *
 * Usa só os endpoints internos que a plataforma já usa em produção
 * (`/internal/provision-tenant` e `/internal/sync-payment-credentials`) — sem
 * escrever direto no banco e sem dependência de driver, então o que se testa
 * depois é o caminho real, não um atalho de seed.
 *
 * A credencial simulada é reconhecida pelo prefixo `TEST-SANDBOX-` (ver
 * `src/mp_sandbox.rs`). Loja com token real (`APP_USR-`, ou `TEST-` do próprio
 * Mercado Pago) nunca entra em modo simulado: a checagem é por prefixo exato.
 *
 * Uso (com o ecommerce-api rodando):
 *   node scripts/seed-sandbox-tenant.mjs
 *   node scripts/seed-sandbox-tenant.mjs --slug=minha-loja --vertical=ecommerce
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}

/** Lê uma chave do .env sem depender de dotenv. */
function fromEnvFile(key) {
  try {
    const line = readFileSync(join(ROOT, '.env'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`))
    return line ? line.slice(key.length + 1).trim() : undefined
  } catch {
    return undefined
  }
}

const API = arg('api', process.env.ECOMMERCE_API_URL ?? 'http://localhost:8080')
const SLUG = arg('slug', 'vrtech-sandbox')
const VERTICAL = arg('vertical', 'eletronicos')
const ADMIN_EMAIL = arg('email', `admin@${SLUG}.test`)
const ADMIN_PASSWORD = arg('password', '123456')

const internalKey = process.env.INTERNAL_API_KEY ?? fromEnvFile('INTERNAL_API_KEY')
if (!internalKey) {
  console.error('INTERNAL_API_KEY não encontrada (nem no ambiente nem no .env).')
  process.exit(1)
}

// Hash Argon2 de "123456". O endpoint recebe o hash pronto, igual à
// plataforma faz — senha de loja de teste, ambiente local.
const ARGON2_123456 =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FuZGJveHNhbHR2YWx1ZQ$Ck5eR6bMFGKzFHKZQEQCF6cVJhI5AqLTBIkK9zVQZUE'

const sandboxToken = `TEST-SANDBOX-${SLUG}-${'0'.repeat(24)}`
const sandboxPublicKey = `TEST-SANDBOX-PUB-${SLUG}`
const sandboxUserId = `SANDBOX-${SLUG.toUpperCase()}`

const post = (path, body) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify(body),
  })

console.log(`Provisionando loja de teste "${SLUG}" (ramo: ${VERTICAL}) em ${API}\n`)

// ---------------------------------------------------------------------------
// 1. Provisiona pelo endpoint real da plataforma
// ---------------------------------------------------------------------------
{
  const res = await post('/internal/provision-tenant', {
    organization_name: `Org ${SLUG}`,
    organization_email: ADMIN_EMAIL,
    tenant_name: SLUG === 'vrtech-sandbox' ? 'VR Tech (sandbox)' : SLUG,
    tenant_slug: SLUG,
    whatsapp_instance: SLUG,
    admin_email: ADMIN_EMAIL,
    admin_password_hash: ARGON2_123456,
    admin_name: 'Admin Sandbox',
    plan_code: 'essential',
    vertical: VERTICAL,
  })
  const text = await res.text()

  if (res.ok) {
    console.log('  1/2  loja provisionada.')
  } else if (/already exists|duplicate|unique|já existe/i.test(text)) {
    console.log('  1/2  loja já existia — seguindo.')
  } else {
    console.error(`  1/2  falha ao provisionar (${res.status}): ${text}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 2. Vincula a conta Mercado Pago simulada
// ---------------------------------------------------------------------------
{
  const res = await post('/internal/sync-payment-credentials', {
    tenant_slug: SLUG,
    forma_pagamento: 'plataforma',
    plataforma_pagamento: 'mercado_pago',
    plataforma_credenciais: {
      token: sandboxToken,
      public_key: sandboxPublicKey,
      user_id: sandboxUserId,
      sandbox: true,
    },
  })
  if (!res.ok) {
    console.error(`  2/2  falha ao vincular credenciais (${res.status}): ${await res.text()}`)
    process.exit(1)
  }
  console.log('  2/2  conta Mercado Pago simulada vinculada.\n')
}

console.log('Loja pronta:')
console.log(`  slug       : ${SLUG}`)
console.log(`  ramo       : ${VERTICAL}`)
console.log(`  admin      : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
console.log(`  mp user_id : ${sandboxUserId}`)
console.log(`
Como testar um pagamento (local, sem dinheiro):

  1. Criar pedido:
     POST ${API}/api/public/catalog/${SLUG}/assistant-order

  2. Gerar cobrança Pix (QR simulado, nasce pendente como o real):
     POST ${API}/api/orders/{order_id}/create-pix-payment

  3. Ver os pagamentos simulados do pedido:
     GET  ${API}/api/sandbox/orders/{order_id}/payments

  4. "Pagar" — dispara o handler REAL do webhook (baixa de estoque,
     status do pedido, notificação no WhatsApp):
     POST ${API}/api/sandbox/payments/{payment_id}/approve

  5. Conferir: o pedido deve estar com payment_status = 'pago'.

  Para o caminho de falha, use /reject no lugar de /approve.
`)
