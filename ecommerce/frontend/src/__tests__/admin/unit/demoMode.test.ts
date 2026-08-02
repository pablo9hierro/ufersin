import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  activateDemoMode,
  getDemoStaffSession,
  isDemoModeActive,
  setDemoStaffSession,
} from '../../../lib/demoMode'

const SLUG_KEY = 'resolutoo_tenant_slug'
const ADMIN_AUTH_KEY = 'sonset_admin_auth'

describe('demoMode vs leftover tenant slug', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    window.history.replaceState({}, '', '/loja/admin/pedidos')
  })

  afterEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('stays in demo even when localStorage had a real tenant slug (without wiping it)', () => {
    localStorage.setItem(SLUG_KEY, 'loja-real')
    activateDemoMode('essential')
    expect(isDemoModeActive()).toBe(true)
    // Must keep real slug — same-origin demo iframe must not brick /admin/login
    expect(localStorage.getItem(SLUG_KEY)).toBe('loja-real')
  })

  it('yields only to explicit ?tenant= in the URL', () => {
    activateDemoMode('premium')
    expect(isDemoModeActive()).toBe(true)
    window.history.replaceState({}, '', '/loja/?tenant=loja-real')
    expect(isDemoModeActive()).toBe(false)
  })

  it('is inactive without session flag', () => {
    localStorage.setItem(SLUG_KEY, 'loja-real')
    expect(isDemoModeActive()).toBe(false)
  })

  it('stores staff session only in sessionStorage — never touches admin JWT', () => {
    const realAuth = JSON.stringify({
      state: { token: 'real-jwt-abc', name: 'Lojista', tenantSlug: 'loja-real' },
      version: 0,
    })
    localStorage.setItem(ADMIN_AUTH_KEY, realAuth)
    localStorage.setItem(SLUG_KEY, 'loja-real')

    activateDemoMode('essential')
    setDemoStaffSession({ role: 'admin', token: 'local-admin-token', name: 'Admin Demo' })

    expect(getDemoStaffSession()?.token).toBe('local-admin-token')
    expect(localStorage.getItem(ADMIN_AUTH_KEY)).toBe(realAuth)
    expect(localStorage.getItem(SLUG_KEY)).toBe('loja-real')
  })
})
