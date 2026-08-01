import { describe, expect, it } from 'vitest'
import { canAccessAdminRoute, onboardingBlocksRoute } from '../../../lib/adminPlanGating'
import { validateAdminLoginFields, validatePasswordChange } from '../../../lib/adminValidators'

describe('plan gating', () => {
  it('essential: PDV/Produtos/Pedidos/Relatórios/Conta liberados; Motoboys/CRM não', () => {
    expect(canAccessAdminRoute('/admin/pdv', 'essential')).toBe(true)
    expect(canAccessAdminRoute('/admin/produtos', 'essential')).toBe(true)
    expect(canAccessAdminRoute('/admin/motoboys', 'essential')).toBe(false)
    expect(canAccessAdminRoute('/admin/crm', 'essential')).toBe(false)
    expect(canAccessAdminRoute('/admin/promocoes', 'essential')).toBe(false)
  })

  it('management libera Motoboys/Promoções; CRM só premium', () => {
    expect(canAccessAdminRoute('/admin/motoboys', 'management')).toBe(true)
    expect(canAccessAdminRoute('/admin/crm', 'management')).toBe(false)
    expect(canAccessAdminRoute('/admin/crm', 'premium')).toBe(true)
  })

  it('pedidos pode ser bloqueado por flag de plano/feature', () => {
    expect(canAccessAdminRoute('/admin/pedidos', 'essential', { pedidosLiberado: false })).toBe(false)
    expect(canAccessAdminRoute('/admin/pedidos', 'essential', { pedidosLiberado: true })).toBe(true)
  })

  it('onboarding: sem horários só Conta fica aberta', () => {
    expect(onboardingBlocksRoute('/admin/conta', false)).toBe(false)
    expect(onboardingBlocksRoute('/admin/pdv', false)).toBe(true)
    expect(onboardingBlocksRoute('/admin/pdv', true)).toBe(false)
  })
})

describe('admin validators', () => {
  it('login fields', () => {
    expect(validateAdminLoginFields('', 'x')).toMatch(/e-mail/i)
    expect(validateAdminLoginFields('a@b.com', '')).toMatch(/senha/i)
    expect(validateAdminLoginFields('a@b.com', 'secret')).toBeNull()
  })

  it('password change', () => {
    expect(validatePasswordChange('123456', '123457')).toMatch(/confirmação/i)
    expect(validatePasswordChange('123', '123')).toMatch(/6 caracteres/i)
    expect(validatePasswordChange('123456', '123456')).toBeNull()
  })
})
