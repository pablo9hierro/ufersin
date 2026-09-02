import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import {
  activateDemoMode,
  setDemoStaffSession,
  type PlanoCode,
} from '../lib/demoMode'
import { ADMIN_CREDENTIALS, FAKE_MOTOBOY_ID } from '../lib/localData'
import { useAdminAuth } from '../store/adminAuth'
import { persistTenantSlug, resetTenantConfigCache } from '../lib/tenantConfig'

const VALID_ROLES = new Set(['admin', 'motoboy', 'vitrine', 'vendedor'])

/**
 * Ponte da demo pública da Rodoletas (/demo lá) pra esse app — sem
 * backend nenhum envolvido. `?role=vitrine|admin|motoboy|vendedor&plano=essential`
 * ativa o modo demonstração desta aba (demoMode.ts — faz api.ts inteiro
 * passar a resolver pro localApi/localStorage, o mesmo modo que o site já
 * usa quando sobe sem Supabase configurado, só que seedado com dado fake
 * dedicado à demo) e, se for admin/motoboy/vendedor, já loga sozinho com o
 * token fixo que o próprio modo local usa (vitrine não precisa de login).
 *
 * Nunca redireciona pra /admin/login — a demo entra já autenticada.
 *
 * Staff demo vive só em sessionStorage (`setDemoStaffSession`) — NÃO
 * sobrescreve useAdminAuth / localStorage, senão a iframe same-origin
 * em /demo destrói a sessão real do lojista em /loja/admin.
 *
 * `?role=admin&token=<jwt>&tenantSlug=<slug>` é o fluxo REAL (usado pelo
 * botão "Área logada (admin)" da demo eletrônica em frontend/, via
 * GET /demo/tokens?vertical=eletronica): loga de verdade no useAdminAuth
 * (mesmo store que o form de senha usa), contra o tenant demo-eletronica/
 * demo-ecommerce seedado de verdade no Postgres — NÃO ativa o modo mock
 * local (isDemoModeActive), senão o app inteiro passaria a ignorar a API
 * real e mostrar dado fake do Rodoletas em vez do tenant seedado.
 *
 * `?role=admin&token=<jwt>` sem `tenantSlug` continua aceito por
 * compatibilidade (era o modo mock anterior) mas não é mais usado pelo
 * fluxo atual do Rodoletas — e só grava em sessionStorage.
 */
export default function DemoEntrar() {
  const [searchParams] = useSearchParams()
  const role = searchParams.get('role')
  const token = searchParams.get('token')
  const tenantSlug = searchParams.get('tenantSlug')
  const adminName = searchParams.get('name')
  const planoParam = searchParams.get('plano') as PlanoCode | null
  const plano = planoParam === 'essential' || planoParam === 'management' || planoParam === 'premium' ? planoParam : null
  // Não navegar antes de ativar demo + staff session — senão AdminLayout
  // via real API / sem token e o 401 mandava pra /admin/login.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Fluxo real: token emitido por /demo/tokens pra um tenant demo
    // seedado de verdade. Loga na sessão real (useAdminAuth), igual o
    // form de senha faria — nunca passa por activateDemoMode/mock.
    if (role === 'admin' && token && tenantSlug) {
      persistTenantSlug(tenantSlug)
      resetTenantConfigCache()
      useAdminAuth.getState().login(token, adminName || 'Admin (demo)', tenantSlug)
      setReady(true)
      return
    }
    if (plano) {
      activateDemoMode(plano)
      if (role === 'admin') {
        setDemoStaffSession({
          role: 'admin',
          token: 'local-admin-token',
          name: ADMIN_CREDENTIALS.name,
        })
      }
      if (role === 'motoboy') {
        setDemoStaffSession({
          role: 'motoboy',
          token: `local-motoboy:${FAKE_MOTOBOY_ID}`,
          name: 'Motoboy Teste',
        })
      }
      if (role === 'vendedor') {
        setDemoStaffSession({
          role: 'vendedor',
          token: 'local-vendedor-token',
          name: 'Vendedor Teste',
        })
      }
      setReady(true)
      return
    }
    if (!token) {
      setReady(true)
      return
    }
    // Legacy ?token= JWT path — still session-scoped, never touch zustand persist.
    if (role === 'admin') {
      setDemoStaffSession({ role: 'admin', token, name: 'Admin (demo)' })
      activateDemoMode('premium')
    }
    if (role === 'motoboy') {
      setDemoStaffSession({ role: 'motoboy', token, name: 'Motoboy (demo)' })
      activateDemoMode('premium')
    }
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, token, tenantSlug, adminName, plano])

  if ((!token && !plano) || !role || !VALID_ROLES.has(role)) {
    return <Navigate to="/" replace />
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-son-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
      </main>
    )
  }

  if (role === 'vitrine' && plano) return <Navigate to="/" replace />
  if (role === 'admin') return <Navigate to="/admin/pedidos" replace />
  if (role === 'motoboy') return <Navigate to="/funcionarios/motoboy" replace />
  if (role === 'vendedor') return <Navigate to="/funcionarios/vendedor/pdv" replace />

  return (
    <main className="min-h-screen bg-son-black flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
    </main>
  )
}
