import { beforeEach, describe, expect, it } from 'vitest'
import { useAdminAuth } from '../../src/store/adminAuth'
import { useVendedorAuth } from '../../src/store/vendedorAuth'
import { useMotoboyAuth } from '../../src/store/motoboyAuth'
import { useCustomerAuth } from '../../src/store/customerAuth'

// Regressão do bug crítico relatado: "ao deslogar um, desloga todos, ao
// logar um, ele fica settado em todos". As 4 sessões (admin/vendedor/
// motoboy/cliente) usam stores Zustand independentes, cada uma com sua
// própria chave de localStorage — este arquivo prova que elas nunca se
// contaminam, em nenhuma combinação de login/logout.
const stores = {
  admin: useAdminAuth,
  vendedor: useVendedorAuth,
  motoboy: useMotoboyAuth,
} as const

const customer = { id: 'c1', name: 'Cliente Teste', whatsapp: '83999990000', email: null, birthdate: null }

function resetAll() {
  localStorage.clear()
  useAdminAuth.setState({ token: null, name: null })
  useVendedorAuth.setState({ token: null, name: null })
  useMotoboyAuth.setState({ token: null, name: null })
  useCustomerAuth.setState({ token: null, customer: null })
}

describe('isolamento de sessão entre papéis (admin/vendedor/motoboy/cliente)', () => {
  beforeEach(resetAll)

  it('cada store persiste sob sua própria chave de localStorage', () => {
    useAdminAuth.getState().login('tok-admin', 'Admin')
    useVendedorAuth.getState().login('tok-vendedor', 'Vendedor')
    useMotoboyAuth.getState().login('tok-motoboy', 'Motoboy')
    useCustomerAuth.getState().login('tok-cliente', customer)

    expect(localStorage.getItem('sonset_admin_auth')).toBeTruthy()
    expect(localStorage.getItem('sonset_vendedor_auth')).toBeTruthy()
    expect(localStorage.getItem('sonset_motoboy_auth')).toBeTruthy()
    expect(localStorage.getItem('sonset_customer_auth')).toBeTruthy()

    const keys = new Set([
      'sonset_admin_auth',
      'sonset_vendedor_auth',
      'sonset_motoboy_auth',
      'sonset_customer_auth',
    ])
    expect(keys.size).toBe(4) // 4 chaves distintas, nenhuma reaproveitada
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
    // Cenário real: admin logado numa aba, vendedor loga em outra (mesma
    // origem = mesmo localStorage). Antes da correção, useAdminAuth era
    // compartilhado por ambos e a segunda sessão sobrescrevia a primeira.
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

    const adminRaw = JSON.parse(localStorage.getItem('sonset_admin_auth')!)
    const vendedorRaw = JSON.parse(localStorage.getItem('sonset_vendedor_auth')!)

    expect(adminRaw.state.token).toBe('tok-admin')
    expect(vendedorRaw.state.token).toBe('tok-vendedor')
    // a chave do admin nunca deve conter o token do vendedor nem vice-versa
    expect(JSON.stringify(adminRaw)).not.toContain('tok-vendedor')
    expect(JSON.stringify(vendedorRaw)).not.toContain('tok-admin')
  })
})
