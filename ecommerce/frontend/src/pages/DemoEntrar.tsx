import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAdminAuth } from '../store/adminAuth'
import { useMotoboyAuth } from '../store/motoboyAuth'
import { useVendedorAuth } from '../store/vendedorAuth'
import { activateDemoMode, type PlanoCode } from '../lib/demoMode'
import { ADMIN_CREDENTIALS, FAKE_MOTOBOY_ID } from '../lib/localData'

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
 * `?role=admin&token=<jwt>` continua aceito por compatibilidade (era o
 * modo anterior, com um backend + tenant demo reais) mas não é mais usado
 * pelo fluxo atual do Rodoletas.
 */
export default function DemoEntrar() {
  const [searchParams] = useSearchParams()
  const role = searchParams.get('role')
  const token = searchParams.get('token')
  const planoParam = searchParams.get('plano') as PlanoCode | null
  const plano = planoParam === 'essential' || planoParam === 'management' || planoParam === 'premium' ? planoParam : null
  const adminAuth = useAdminAuth()
  const motoboyAuth = useMotoboyAuth()
  const vendedorAuth = useVendedorAuth()
  // Não navegar com token pré-existente (JWT real em localStorage) antes
  // de ativar demo + trocar pelo token mock — senão AdminLayout batia na
  // API real e o 401 mandava pra /admin/login.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (plano) {
      activateDemoMode(plano)
      if (role === 'admin') adminAuth.login('local-admin-token', ADMIN_CREDENTIALS.name, null)
      if (role === 'motoboy') motoboyAuth.login(`local-motoboy:${FAKE_MOTOBOY_ID}`, 'Motoboy Teste')
      if (role === 'vendedor') vendedorAuth.login('local-vendedor-token', 'Vendedor Teste')
      setReady(true)
      return
    }
    if (!token) {
      setReady(true)
      return
    }
    if (role === 'admin') adminAuth.login(token, 'Admin (demo)', null)
    if (role === 'motoboy') motoboyAuth.login(token, 'Motoboy (demo)')
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, token, plano])

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
  if (role === 'vendedor') return <Navigate to="/funcionarios/vendedor/pedidos" replace />

  return (
    <main className="min-h-screen bg-son-black flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
    </main>
  )
}
