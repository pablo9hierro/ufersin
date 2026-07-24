import { useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAdminAuth } from '../store/adminAuth'
import { useMotoboyAuth } from '../store/motoboyAuth'

/**
 * Ponte da demo pública da Rodoletas (/demo lá) pra esse app: recebe um
 * token já pronto (emitido por GET /demo/tokens no backend, pro tenant
 * fixo "loja-demo" — nunca uma loja real) e loga direto na sessão real de
 * admin ou motoboy, sem senha nenhuma. Só existe token pra abrir aqui
 * porque quem gerou já sabe que é a conta demo; esta página não valida
 * nada além do formato — a validação de verdade é o backend aceitar ou
 * não o JWT nas rotas normais.
 */
export default function DemoEntrar() {
  const [searchParams] = useSearchParams()
  const role = searchParams.get('role')
  const token = searchParams.get('token')
  const adminAuth = useAdminAuth()
  const motoboyAuth = useMotoboyAuth()

  useEffect(() => {
    if (!token) return
    if (role === 'admin') adminAuth.login(token, 'Admin (demo)')
    if (role === 'motoboy') motoboyAuth.login(token, 'Motoboy (demo)')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, token])

  if (!token || (role !== 'admin' && role !== 'motoboy')) {
    return <Navigate to="/" replace />
  }

  if (role === 'admin' && adminAuth.token) return <Navigate to="/admin/pedidos" replace />
  if (role === 'motoboy' && motoboyAuth.token) return <Navigate to="/funcionarios/motoboy" replace />

  return (
    <main className="min-h-screen bg-son-black flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
    </main>
  )
}
