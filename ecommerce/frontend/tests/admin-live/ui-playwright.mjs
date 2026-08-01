/**
 * Optional Playwright smoke against a real admin UI URL.
 * Skips QR WhatsApp connect (cannot automate). Requires:
 *   ADMIN_TEST_UI_URL  e.g. https://…/loja  or http://localhost:5173/loja
 *   + same auth env as run.mjs
 *   + playwright installed: npx playwright install chromium
 *
 * Usage: npm run test:admin:live:ui
 */
import { requireLiveEnv } from './lib/loadEnv.mjs'

async function main() {
  let env
  try {
    env = requireLiveEnv()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  if (!env.uiUrl) {
    console.error(
      'ADMIN_TEST_UI_URL is required for UI live tests (e.g. https://your-store.example/loja).\n' +
        'See tests/admin-live/README.md',
    )
    process.exit(1)
  }

  let playwright
  try {
    playwright = await import('playwright')
  } catch {
    console.error('Install playwright: npm i -D playwright && npx playwright install chromium')
    process.exit(1)
  }

  const base = env.uiUrl.replace(/\/$/, '')
  const loginUrl = `${base}/admin/login?tenant=${encodeURIComponent(env.tenant)}&email=${encodeURIComponent(env.email)}`
  console.log(`UI live: ${base}`)
  console.log(`tenant: ${env.tenant}`)

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
    }
  }

  try {
    await step('login page loads', async () => {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.waitForSelector('input[type="password"]', { timeout: 30_000 })
    })

    await step('login with real credentials', async () => {
      // Tenant vem de ?tenant= na URL (campo "Identificador da loja" removido).
      const email = page.locator('input[type="email"]')
      if (await email.count()) {
        await email.fill(env.email)
      }
      await page.locator('input[type="password"]').fill(env.password)
      await page.getByRole('button', { name: /^entrar$/i }).click()
      await page.waitForURL(/\/admin\//, { timeout: 60_000 })
    })

    await step('Produtos: open, Novo produto visible', async () => {
      await page.goto(`${base}/admin/produtos`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.getByRole('heading', { name: /produtos/i }).waitFor({ timeout: 30_000 })
      await page.getByRole('button', { name: /novo produto/i }).waitFor({ timeout: 30_000 })
      await page.getByRole('button', { name: /baixo estoque/i }).waitFor()
      await page.getByRole('button', { name: /em falta/i }).waitFor()
    })

    await step('PDV: open search field', async () => {
      await page.goto(`${base}/admin/pdv`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.getByRole('heading', { name: /pdv/i }).waitFor({ timeout: 30_000 })
      await page.getByPlaceholder(/2 letras|pelo menos 2/i).waitFor({ timeout: 30_000 })
    })

    await step('Pedidos: filters render', async () => {
      await page.goto(`${base}/admin/pedidos`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.getByRole('heading', { name: /pedidos/i }).waitFor({ timeout: 30_000 })
      await page.getByRole('button', { name: /pendentes/i }).waitFor()
    })

    await step('Relatórios: heading', async () => {
      await page.goto(`${base}/admin/relatorios`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.getByRole('heading', { name: /relatórios/i }).waitFor({ timeout: 30_000 })
    })

    await step('Conta: hours + WA history section (no QR scan)', async () => {
      await page.goto(`${base}/admin/conta`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      // route may be /admin/senha or /admin/conta depending on deploy
      const heading = page.getByRole('heading', { name: /trocar senha|conta|horário/i }).first()
      try {
        await heading.waitFor({ timeout: 15_000 })
      } catch {
        await page.goto(`${base}/admin/senha`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.getByRole('heading', { name: /trocar senha|horário/i }).first().waitFor({ timeout: 30_000 })
      }
      // If WA enabled, history label should exist; do NOT click Conectar/QR
      const hist = page.getByText(/histórico de conexões/i)
      if (await hist.count()) {
        await hist.waitFor()
      }
    })
  } finally {
    await browser.close()
  }

  if (failures.length) {
    console.error(`\nUI live failed: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('\nUI live passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
