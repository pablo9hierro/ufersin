import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, MessageCircle, Moon, Navigation, Sun, Truck, Wallet } from 'lucide-react'
import Logo from '../ui/Logo'
import { api } from '../../lib/api'
import { useMotoboyAuth } from '../../store/motoboyAuth'
import { useMotoboyTheme } from '../../store/motoboyTheme'

const NAV_ITEMS = [
  { href: '/funcionarios/motoboy', label: 'Fila', icon: Truck },
  { href: '/funcionarios/motoboy/conta', label: 'Conta', icon: MessageCircle },
  { href: '/funcionarios/motoboy/financeiro', label: 'Financeiro', icon: Wallet },
]

const ACTIVE_RUN_POLL_MS = 20000

export default function MotoboyLayout() {
  const { token, name, logout } = useMotoboyAuth()
  const { theme, toggle: toggleTheme } = useMotoboyTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const [hasActiveRun, setHasActiveRun] = useState(false)

  // Lembrete persistente de corrida ativa, visível em qualquer página do
  // dashboard — a corrida em si mora no banco (não aqui), isso é só um
  // atalho pra ele não esquecer de voltar pro mapa.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    const check = () => api.motoboy.runs.active().then((r) => !cancelled && setHasActiveRun(!!r))
    check()
    const interval = setInterval(check, ACTIVE_RUN_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [token])

  if (!token) return <Navigate to="/funcionarios/login" state={{ from: location }} replace />

  const handleLogout = () => {
    logout()
    navigate('/funcionarios/login')
  }

  return (
    <div data-theme={theme} className="min-h-screen bg-son-black text-son-silver">
      <header className="bg-son-surface border-b border-white/5 px-4 sm:px-8 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <Logo size="sm" />
          <p className="text-xs text-son-silver-dim mt-0.5">Olá, {name}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-son-surface-light text-son-silver-dim hover:text-son-pink"
            aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-son-silver-dim hover:text-son-pink text-sm">
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </header>
      <nav className="flex gap-2 overflow-x-auto px-4 sm:px-8 py-3 bg-son-black border-b border-white/5 scrollbar-hide sticky top-[65px] z-10">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = location.pathname === href
          return (
            <Link
              key={href}
              to={href}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                active ? 'sunset-bg text-son-silver' : 'bg-son-surface border border-white/5 text-son-silver hover:bg-son-surface-light'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Link>
          )
        })}
      </nav>
      {hasActiveRun && location.pathname !== '/funcionarios/motoboy/corrida' && (
        <button
          onClick={() => navigate('/funcionarios/motoboy/corrida')}
          className="sunset-bg w-full flex items-center justify-center gap-2 text-son-silver text-sm font-semibold py-2.5"
        >
          <Navigation className="w-4 h-4" />
          Corrida em andamento — toque pra voltar ao mapa
        </button>
      )}
      <main className="p-4 sm:p-8 max-w-4xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
