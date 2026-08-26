import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { LogOut, Wrench } from 'lucide-react'
import { useAdminAuth } from '../../store/adminAuth'

// Painel admin nativo do ramo eletrônica -- identidade visual própria
// (slate/emerald), nunca a chrome de admin de ecommerce. Auth reaproveita
// o MESMO login/token de /admin (o backend não distingue vertical no JWT,
// só o tenant_id embutido nele já resolve tudo tenant-scoped).
export default function EletronicaAdminLayout() {
  const { token, name, logout } = useAdminAuth()
  const navigate = useNavigate()

  if (!token) return <Navigate to="/admin/login" replace />

  function handleLogout() {
    logout()
    navigate('/admin/login')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
            <Wrench className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sm">Painel — Assistência técnica</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span>{name}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </header>
      <main className="p-5">
        <Outlet />
      </main>
    </div>
  )
}
