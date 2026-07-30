import { useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAdminAuth } from '../store/adminAuth'
import { useMotoboyAuth } from '../store/motoboyAuth'
import { useVendedorAuth } from '../store/vendedorAuth'
import { activateDemoMode, type PlanoCode } from '../lib/demoMode'
import { ADMIN_CREDENTIALS, FAKE_MOTOBOY_ID } from '../lib/localData'

/**
 * Ponte da demo pública da Rodoletas (/demo lá) pra esse app — sem
 * backend nenhum envolvido. `?role=vitrine|admin|motoboy|vendedor&plano=essential`
 * ativa o modo demonstração desta aba (demoMode.ts — faz api.ts inteiro
 * passar a resolver pro localApi/localStorage, o mesmo modo que o site já
 * usa quando sobe sem Supabase configurado, só que seedado com dado fake
 * dedicado à demo) e, se for admin/motoboy/vendedor, já loga sozinho com o
 * token fixo que o próprio modo local usa (vitrine não precisa de login).
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

  useEffect(() => {
    if (plano) {
      activateDemoMode(plano)
      if (role === 'admin') adminAuth.login('local-admin-token', ADMIN_CREDENTIALS.name)
      if (role === 'motoboy') motoboyAuth.login(`local-motoboy:${FAKE_MOTOBOY_ID}`, 'Motoboy Teste')
      if (role === 'vendedor') vendedorAuth.login('local-vendedor-token', 'Vendedor Teste')
      return
    }
    if (!token) return
    if (role === 'admin') adminAuth.login(token, 'Admin (demo)')
    if (role === 'motoboy') motoboyAuth.login(token, 'Motoboy (demo)')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, token, plano])

  if ((!token && !plano) || (role !== 'admin' && role !== 'motoboy' && role !== 'vitrine' && role !== 'vendedor')) {
    return <Navigate to="/" replace />
  }

  if (role === 'vitrine' && plano) return <Navigate to="/" replace />
  if (role === 'admin' && adminAuth.token) return <Navigate to="/admin/pedidos" replace />
  if (role === 'motoboy' && motoboyAuth.token) return <Navigate to="/funcionarios/motoboy" replace />
  if (role === 'vendedor' && vendedorAuth.token) return <Navigate to="/funcionarios/vendedor/pedidos" replace />

  return (
    <main className="min-h-screen bg-son-black flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
    </main>
  )
}
