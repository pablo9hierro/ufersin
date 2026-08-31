import { Suspense } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChefHat, Loader2, LogOut } from 'lucide-react'
import Logo from '../ui/Logo'
import { clearDemoStaffSession, isDemoModeActive } from '../../lib/demoMode'
import { useCozinhaAuth } from '../../store/cozinhaAuth'

// Tela de cozinha: layout próprio, sem sidebar de admin (só o board de
// pedidos) — conta própria (cozinha_users), login em /funcionarios/login
// junto com vendedor/motoboy (identificação automática de role).
export default function CozinhaLayout() {
  const { token, name, logout } = useCozinhaAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const demo = isDemoModeActive()

  if (!token) {
    return <Navigate to="/funcionarios/login" state={{ from: location }} replace />
  }

  const handleLogout = () => {
    if (demo) {
      clearDemoStaffSession()
      navigate('/', { replace: true })
      return
    }
    logout()
    navigate('/funcionarios/login')
  }

  return (
    <div className="min-h-screen bg-son-black text-white">
      <header className="bg-son-surface border-b border-white/5 px-4 sm:px-8 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <Logo size="sm" />
          <span className="flex items-center gap-1.5 text-sm font-semibold text-son-gold">
            <ChefHat className="w-4 h-4" />
            Cozinha
          </span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-son-silver-dim hidden sm:block">Olá, {name}</p>
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-son-silver-dim hover:text-son-pink text-sm">
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </header>
      <main className="p-5 sm:p-8 max-w-6xl mx-auto">
        <Suspense
          fallback={
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
