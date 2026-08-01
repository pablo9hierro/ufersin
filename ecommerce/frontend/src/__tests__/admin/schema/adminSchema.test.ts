import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '../../../../../backend/migrations')

function readMigration(name: string): string {
  const path = resolve(migrationsDir, name)
  expect(existsSync(path), `missing migration ${name} under ${migrationsDir}`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('admin feature schema (migration assertions)', () => {
  it('migrations directory is reachable from test file', () => {
    expect(existsSync(migrationsDir), migrationsDir).toBe(true)
    const files = readdirSync(migrationsDir)
    expect(files.some((f) => f.startsWith('0008'))).toBe(true)
    expect(files.some((f) => f.startsWith('0009'))).toBe(true)
    expect(files.some((f) => f.startsWith('0010'))).toBe(true)
  })

  it('products: barcode + cost columns exist in migrations', () => {
    const cost = readMigration('0007_product_cost_price.sql')
    expect(cost).toMatch(/cost_price/)
    expect(cost).toMatch(/low_stock_threshold/)
    const pdv = readMigration('0009_pdv_barcode.sql')
    expect(pdv).toMatch(/barcode/)
    expect(pdv).toMatch(/balcao/)
    expect(pdv).toMatch(/discount_amount/)
    expect(pdv).toMatch(/sold_by/)
  })

  it('store hours + onboarding gate columns', () => {
    const hours = readMigration('0006_store_hours.sql')
    expect(hours).toMatch(/store_hours/)
    expect(hours).toMatch(/store_status/)
    const onboarding = readMigration('0008_onboarding_etapa2.sql')
    expect(onboarding).toMatch(/onboarding_hours_done/)
    expect(onboarding).toMatch(/whatsapp_connection_events/)
    expect(onboarding).toMatch(/created_at/)
  })

  it('whatsapp_connection_events hardened (RLS + event types + created_at)', () => {
    const harden = readMigration('0010_whatsapp_connection_events_harden.sql')
    expect(harden).toMatch(/whatsapp_connection_events/)
    expect(harden).toMatch(/created_at/)
    expect(harden).toMatch(/WITH CHECK/)
    expect(harden).toMatch(/'qr'/)
  })
})

describe('optional live DB hint', () => {
  it('documents ADMIN_TEST_DATABASE_URL for live checks (no pg import in Vitest)', () => {
    // Live column probes live in smoke/admin-smoke.mjs + ops runbooks —
    // Vitest must not statically import `pg` (not a frontend dependency).
    if (process.env.ADMIN_TEST_DATABASE_URL) {
      expect(process.env.ADMIN_TEST_DATABASE_URL).toMatch(/postgres/)
    } else {
      expect(process.env.ADMIN_TEST_DATABASE_URL).toBeFalsy()
    }
  })
})
