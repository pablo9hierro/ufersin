import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(__dirname, '../../..')

/** Load KEY=VALUE files without overriding already-set process.env. Never logs values. */
export function loadEnvFiles() {
  const candidates = [
    path.join(frontendRoot, '.env.local'),
    path.join(frontendRoot, '.env'),
    path.join(frontendRoot, '..', 'backend', '.env.local'),
    path.join(frontendRoot, '..', 'backend', '.env'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const raw of text.split(/\r?\n/)) {
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

/**
 * Required live-admin credentials. Fails hard (no silent skip).
 * Secrets are never returned in error text beyond which keys are missing.
 */
export function requireLiveEnv() {
  loadEnvFiles()

  const baseUrl = (
    process.env.ADMIN_TEST_BASE_URL ||
    process.env.ECOMMERCE_API_URL ||
    process.env.VITE_API_BASE_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '')

  const email = (process.env.ADMIN_TEST_EMAIL || '').trim()
  const password = process.env.ADMIN_TEST_PASSWORD || ''
  const tenant = (process.env.ADMIN_TEST_TENANT || process.env.VITE_TENANT_SLUG || '').trim()

  const missing = []
  if (!baseUrl) missing.push('ADMIN_TEST_BASE_URL (or ECOMMERCE_API_URL / VITE_API_BASE_URL)')
  if (!email) missing.push('ADMIN_TEST_EMAIL')
  if (!password) missing.push('ADMIN_TEST_PASSWORD')
  if (!tenant) missing.push('ADMIN_TEST_TENANT (or VITE_TENANT_SLUG)')

  if (missing.length) {
    const err = new Error(
      `Admin live tests require env credentials. Missing: ${missing.join(', ')}.\n` +
        `See tests/admin-live/README.md — set vars in the shell or ecommerce/frontend/.env.local (never commit secrets).`,
    )
    err.code = 'MISSING_ENV'
    throw err
  }

  return {
    baseUrl,
    email,
    password,
    tenant,
    databaseUrl: (process.env.ADMIN_TEST_DATABASE_URL || process.env.DATABASE_URL || '').trim() || null,
    uiUrl: (process.env.ADMIN_TEST_UI_URL || '').trim().replace(/\/$/, '') || null,
    allowPdvSale: process.env.ADMIN_TEST_ALLOW_PDV_SALE === '1',
    /** When set, assert PDV Pix charge notify API accepts the number (no QR-login). */
    waPhone: (process.env.ADMIN_TEST_WA_PHONE || '').replace(/\D/g, '') || null,
    runId: `TEST_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
  }
}
