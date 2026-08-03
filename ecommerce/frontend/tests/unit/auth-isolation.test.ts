import { beforeEach, describe, expect, it } from 'vitest'
import { useAdminAuth, LOJA_ADMIN_AUTH_KEY } from '../../src/store/adminAuth'
import { useVendedorAuth, LOJA_VENDEDOR_AUTH_KEY } from '../../src/store/vendedorAuth'
import { useMotoboyAuth, LOJA_MOTOBOY_AUTH_KEY } from '../../src/store/motoboyAuth'
import { useCustomerAuth, LOJA_CUSTOMER_AUTH_KEY } from '../../src/store/customerAuth'

// Regressão: admin/vendedor/motoboy/cliente nunca se contaminam.
// Também garante namespace `resolutoo_loja_*` (isolado da plataforma).
const stores = {
  admin: useAdminAuth,
  vendedor: useVendedorAuth,
  motoboy: useMotoboyAuth,
} as const

const customer = { id: 'c1', name: 'Cliente Teste', whatsapp: '83999990000', email: null, birthdate: null }

const PLATFORM_KEYS = [
  'resolutoo_platform_auth_lojista',
  'resolutoo_platform_auth_superadmin',
  'resolutoo-auth-lojista',
  'resolutoo-auth-superadmin',
  'sb-migkkrwzykpztrakbfij-auth-token',
]

function resetAll() {
  localStorage.clear()
  useAdminAuth.setState({ token: null, name: null, tenantSlug: null })
  useVendedorAuth.setState({ token: null, name: null })
  useMotoboyAuth.setState({ token: null, name: null })
  useCustomerAuth.setState({ token: null, customer: null })
}

describe('isolamento de sessão entre papéis (admin/vendedor/motoboy/cliente)', () => {
  beforeEach(resetAll)

  it('cada store persiste sob chave resolutoo_loja_* distinta', () => {
    useAdminAuth.getState().login('tok-admin', 'Admin')
    useVendedorAuth.getState().login('tok-vendedor', 'Vendedor')
    useMotoboyAuth.getState().login('tok-motoboy', 'Motoboy')
    useCustomerAuth.getState().login('tok-cliente', customer)

    expect(localStorage.getItem(LOJA_ADMIN_AUTH_KEY)).toBeTruthy()
    expect(localStorage.getItem(LOJA_VENDEDOR_AUTH_KEY)).toBeTruthy()
    expect(localStorage.getItem(LOJA_MOTOBOY_AUTH_KEY)).toBeTruthy()
    expect(localStorage.getItem(LOJA_CUSTOMER_AUTH_KEY)).toBeTruthy()

    const keys = new Set([
      LOJA_ADMIN_AUTH_KEY,
      LOJA_VENDEDOR_AUTH_KEY,
      LOJA_MOTOBOY_AUTH_KEY,
      LOJA_CUSTOMER_AUTH_KEY,
    ])
    expect(keys.size).toBe(4)
  })

  it.each(Object.entries(stores))('logar como %s não seta token nos outros 3 papéis', (roleName, store) => {
    store.getState().login(`tok-${roleName}`, `Nome ${roleName}`)

    for (const [otherName, otherStore] of Object.entries(stores)) {
      if (otherName === roleName) continue
      expect(otherStore.getState().token).toBeNull()
    }
    expect(useCustomerAuth.getState().token).toBeNull()
    expect(store.getState().token).toBe(`tok-${roleName}`)
  })

  it.each(Object.entries(stores))('deslogar de %s não desloga os outros 3 papéis', (roleName, store) => {
    useAdminAuth.getState().login('tok-admin', 'Admin')
    useVendedorAuth.getState().login('tok-vendedor', 'Vendedor')
    useMotoboyAuth.getState().login('tok-motoboy', 'Motoboy')
    useCustomerAuth.getState().login('tok-cliente', customer)

    store.getState().logout()

    expect(store.getState().token).toBeNull()
    for (const [otherName, otherStore] of Object.entries(stores)) {
      if (otherName === roleName) continue
      expect(otherStore.getState().token).not.toBeNull()
    }
    expect(useCustomerAuth.getState().token).toBe('tok-cliente')
  })

  it('logar como admin e depois como vendedor mantém as duas sessões simultâneas e independentes', () => {
    useAdminAuth.getState().login('tok-admin', 'Admin')
    useVendedorAuth.getState().login('tok-vendedor', 'Vendedor')

    expect(useAdminAuth.getState().token).toBe('tok-admin')
    expect(useAdminAuth.getState().name).toBe('Admin')
    expect(useVendedorAuth.getState().token).toBe('tok-vendedor')
    expect(useVendedorAuth.getState().name).toBe('Vendedor')
  })

  it('recarregar o storage (nova instância lendo localStorage) preserva o isolamento', () => {
    useAdminAuth.getState().login('tok-admin', 'Admin')
    useVendedorAuth.getState().login('tok-vendedor', 'Vendedor')

    const adminRaw = JSON.parse(localStorage.getItem(LOJA_ADMIN_AUTH_KEY)!)
    const vendedorRaw = JSON.parse(localStorage.getItem(LOJA_VENDEDOR_AUTH_KEY)!)

    expect(adminRaw.state.token).toBe('tok-admin')
    expect(vendedorRaw.state.token).toBe('tok-vendedor')
    expect(JSON.stringify(adminRaw)).not.toContain('tok-vendedor')
    expect(JSON.stringify(vendedorRaw)).not.toContain('tok-admin')
  })

  it('logout do admin não apaga keys da plataforma Resolutoo', () => {
    for (const k of PLATFORM_KEYS) {
      localStorage.setItem(k, JSON.stringify({ keep: true, key: k }))
    }
    useAdminAuth.getState().login('tok-admin', 'Admin', 'loja-teste')
    useAdminAuth.getState().logout()

    expect(localStorage.getItem(LOJA_ADMIN_AUTH_KEY)).toBeNull()
    for (const k of PLATFORM_KEYS) {
      expect(localStorage.getItem(k)).toBeTruthy()
    }
  })
})
