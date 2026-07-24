import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AdminLogin from '../../src/pages/admin/AdminLogin'
import FuncionarioLogin from '../../src/pages/admin/FuncionarioLogin'
import { useAdminAuth } from '../../src/store/adminAuth'
import { useVendedorAuth } from '../../src/store/vendedorAuth'
import { useMotoboyAuth } from '../../src/store/motoboyAuth'

// Teste "end2end" de frontend (renderiza a tela real, preenche formulário,
// clica em Entrar — não chama as stores direto como o teste unitário faz)
// pra pegar exatamente o tipo de bug relatado como crítico: um componente
// que por engano grava a sessão na store errada (ex: FuncionarioLogin
// chamando useAdminAuth().login() em vez de useVendedorAuth().login()).
// Isso não é pego pelo teste unitário de tests/unit/auth-isolation.test.ts,
// que testa as stores isoladas — aqui é o fluxo completo tela→store.
//
// A classe ApiError é declarada DENTRO da factory (não importada de fora)
// porque vi.mock é hoisted pro topo do arquivo — referenciar uma variável
// importada no nível do módulo aqui dispara "Cannot access before
// initialization".
vi.mock('../../src/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return {
    ApiError,
    api: {
      auth: {
        adminLogin: vi.fn(async (email: string, password: string) => {
          if (email === 'admin@sunset.com' && password === 'senha-admin') {
            return { token: 'tok-admin-real', name: 'Admin Real' }
          }
          throw new ApiError(401, 'Credenciais inválidas')
        }),
        vendedorLogin: vi.fn(async (email: string, password: string) => {
          if (email === 'vendedor@sunset.com' && password === 'senha-vendedor') {
            return { token: 'tok-vendedor-real', name: 'Vendedor Real' }
          }
          throw new ApiError(401, 'Credenciais inválidas')
        }),
        motoboyLogin: vi.fn(async (email: string, password: string) => {
          if (email === 'motoboy@sunset.com' && password === 'senha-motoboy') {
            return { token: 'tok-motoboy-real', name: 'Motoboy Real' }
          }
          throw new ApiError(401, 'Credenciais inválidas')
        }),
      },
    },
  }
})

function resetAll() {
  localStorage.clear()
  useAdminAuth.setState({ token: null, name: null })
  useVendedorAuth.setState({ token: null, name: null })
  useMotoboyAuth.setState({ token: null, name: null })
}

// Os campos de e-mail/senha não têm <label htmlFor> associado ao <input>
// (label solto ao lado, sem "for"/id) — getByLabelText não os enxerga.
// Consulta direta por type é o jeito confiável de achar cada campo aqui.
async function submitLogin(email: string, password: string) {
  const emailInput = document.querySelector<HTMLInputElement>('input[type="email"]')!
  const passwordInput = document.querySelector<HTMLInputElement>('input[type="password"]')!
  fireEvent.change(emailInput, { target: { value: email } })
  fireEvent.change(passwordInput, { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /^entrar$/i }))
}

describe('fluxo completo de login (tela → API mockada → store) não cruza sessões', () => {
  beforeEach(resetAll)

  it('logar como admin pela tela grava só em useAdminAuth', async () => {
    render(
      <MemoryRouter>
        <AdminLogin />
      </MemoryRouter>
    )

    await submitLogin('admin@sunset.com', 'senha-admin')

    await waitFor(() => expect(useAdminAuth.getState().token).toBe('tok-admin-real'))
    expect(useAdminAuth.getState().name).toBe('Admin Real')
    expect(useVendedorAuth.getState().token).toBeNull()
    expect(useMotoboyAuth.getState().token).toBeNull()
  })

  it('logar como vendedor pela tela grava só em useVendedorAuth e preserva sessão admin já ativa', async () => {
    // Admin já logado em outra aba (mesmo localStorage) antes do vendedor logar.
    useAdminAuth.getState().login('tok-admin-real', 'Admin Real')

    render(
      <MemoryRouter>
        <FuncionarioLogin />
      </MemoryRouter>
    )
    // aba "Vendedor" já vem selecionada por padrão
    await submitLogin('vendedor@sunset.com', 'senha-vendedor')

    await waitFor(() => expect(useVendedorAuth.getState().token).toBe('tok-vendedor-real'))
    expect(useVendedorAuth.getState().name).toBe('Vendedor Real')
    // sessão do admin, já ativa antes, continua intacta
    expect(useAdminAuth.getState().token).toBe('tok-admin-real')
    expect(useMotoboyAuth.getState().token).toBeNull()
  })

  it('logar como motoboy pela tela grava só em useMotoboyAuth, sem afetar admin já logado', async () => {
    // Não pré-loga vendedor aqui: FuncionarioLogin faz
    // `if (vendedorToken) return <Navigate .../>` logo no topo, então com
    // sessão de vendedor já ativa o formulário nem chegaria a renderizar.
    useAdminAuth.getState().login('tok-admin-real', 'Admin Real')

    render(
      <MemoryRouter>
        <FuncionarioLogin />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: /^motoboy$/i }))
    await submitLogin('motoboy@sunset.com', 'senha-motoboy')

    await waitFor(() => expect(useMotoboyAuth.getState().token).toBe('tok-motoboy-real'))
    expect(useAdminAuth.getState().token).toBe('tok-admin-real')
    expect(useVendedorAuth.getState().token).toBeNull()
  })

  it('credenciais erradas não gravam token em nenhuma store', async () => {
    render(
      <MemoryRouter>
        <AdminLogin />
      </MemoryRouter>
    )
    await submitLogin('admin@sunset.com', 'senha-errada')

    await waitFor(() => expect(screen.getByText(/credenciais inválidas/i)).toBeInTheDocument())
    expect(useAdminAuth.getState().token).toBeNull()
  })
})
