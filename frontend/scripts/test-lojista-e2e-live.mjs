/**
 * E2E "pablo hierro" — usuário testador que navega o app Resolutoo de
 * verdade (browser real via Playwright, botões reais, API real) pra
 * validar os 3 casos de uso reportados como quebrados:
 *
 *   1. /meu-plano não pode mostrar "database error".
 *   2. Lojista com onboarding incompleto fica travado em /onboarding até
 *      preencher os campos obrigatórios (não escapa pro hub).
 *   3. Clicar em "Sair" realmente desloga (não fica preso na mesma tela).
 *
 * NUNCA hardcodeie credencial real neste arquivo — email/senha vêm de env
 * var, lidos uma vez na hora de rodar, nunca commitados.
 *
 * Uso (de dentro de frontend/):
 *   LOJISTA_TEST_EMAIL=... LOJISTA_TEST_PASSWORD=... node scripts/test-lojista-e2e-live.mjs
 *   (opcional) LOJISTA_TEST_BASE_URL=https://resolutoo.com  (default)
 *
 * Requer (uma vez): npm i -D playwright && npx playwright install chromium
 */
const BASE = (process.env.LOJISTA_TEST_BASE_URL || 'https://resolutoo.com').replace(/\/$/, '')
const EMAIL = process.env.LOJISTA_TEST_EMAIL
const PASSWORD = process.env.LOJISTA_TEST_PASSWORD
const LOGOUT_TIMEOUT_MS = 10_000

if (!EMAIL || !PASSWORD) {
  console.error('Defina LOJISTA_TEST_EMAIL e LOJISTA_TEST_PASSWORD (não hardcoded) antes de rodar.')
  process.exit(1)
}

async function main() {
  let playwright
  try {
    playwright = await import('playwright')
  } catch {
    console.error('Instale playwright: npm i -D playwright && npx playwright install chromium')
    process.exit(1)
  }

  console.log(`pablo hierro (testador) navegando ${BASE} — ${EMAIL}\n`)

  const browser = await playwright.chromium.launch({ headless: true })
  const page = await browser.newPage()
  const failures = []

  async function step(name, fn) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`)
      failures.push(name)
      try {
        await page.screenshot({ path: `scripts/.e2e-fail-${name.replace(/[^a-z0-9]+/gi, '-')}.png` })
      } catch {
        /* ignore */
      }
    }
  }

  function bodyHasDatabaseError() {
    return page.locator('text=/database error/i').count().then((n) => n > 0)
  }

  try {
    await step('tela de login carrega', async () => {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForSelector('input[type="email"]', { timeout: 15_000 })
    })

    await step('login com credenciais reais', async () => {
      await page.locator('input[type="email"]').fill(EMAIL)
      await page.locator('input[type="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: /entrar/i }).click()
      await page.waitForURL(/\/(meu-plano|onboarding|dashboard)/, { timeout: 30_000 })
    })

    let landedOnOnboarding = false

    await step('pós-login sem "database error" na tela', async () => {
      await page.waitForTimeout(1500) // deixa os fetches da tela assentarem
      landedOnOnboarding = /\/onboarding/.test(page.url())
      if (await bodyHasDatabaseError()) {
        throw new Error(`"database error" visível em ${page.url()}`)
      }
    })

    await step('onboarding incompleto trava em /onboarding (não escapa pro hub)', async () => {
      if (!landedOnOnboarding) {
        console.log('    (conta já provisionada — onboarding_status=provisionado, lock não se aplica a este teste)')
        return
      }
      await page.goto(`${BASE}/meu-plano`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(1000)
      if (!/\/onboarding/.test(page.url())) {
        throw new Error(`tentou acessar /meu-plano direto e NÃO foi barrado de volta pro /onboarding — foi parar em ${page.url()}`)
      }
    })

    if (!landedOnOnboarding) {
      await step('/meu-plano sem "database error" (revisita direta)', async () => {
        await page.goto(`${BASE}/meu-plano`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await page.waitForTimeout(1500)
        if (await bodyHasDatabaseError()) {
          throw new Error(`"database error" visível em ${page.url()}`)
        }
      })
    }

    await step('clicar em "Sair" realmente desloga', async () => {
      const beforeUrl = page.url()
      await page.getByRole('button', { name: /^sair$/i }).click()
      // Bug reportado: clique não faz nada e a página fica presa na mesma
      // URL logada — por isso o timeout curto e explícito aqui, em vez de
      // confiar em waitForURL (que ficaria pendurado até seu próprio
      // timeout padrão sem dizer qual sintoma bateu).
      const left = await page
        .waitForURL((url) => url.toString() !== beforeUrl, { timeout: LOGOUT_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false)
      if (!left) {
        throw new Error(`depois de ${LOGOUT_TIMEOUT_MS}ms clicando em Sair, a URL continua ${page.url()} (logout não navegou pra fora)`)
      }
    })

    await step('sessão realmente encerrada (revisitar /meu-plano exige login)', async () => {
      await page.goto(`${BASE}/meu-plano`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(1000)
      if (!/\/login/.test(page.url())) {
        throw new Error(`depois do logout, /meu-plano não redirecionou pro /login — foi parar em ${page.url()} (sessão pode ainda estar válida)`)
      }
    })
  } finally {
    await browser.close()
  }

  console.log('')
  if (failures.length) {
    console.error(`pablo hierro: ${failures.length} caso(s) falharam — ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('pablo hierro: todos os casos de uso passaram.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
