import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activateDemoMode, isDemoModeActive } from '../../../lib/demoMode'

const SLUG_KEY = 'resolutoo_tenant_slug'

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

  it('stays in demo even when localStorage had a real tenant slug', () => {
    localStorage.setItem(SLUG_KEY, 'loja-real')
    activateDemoMode('essential')
    expect(isDemoModeActive()).toBe(true)
    expect(localStorage.getItem(SLUG_KEY)).toBeNull()
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
})
