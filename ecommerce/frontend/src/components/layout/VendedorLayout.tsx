import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ClipboardList, LogOut, ShoppingCart, Wallet } from 'lucide-react'
import Logo from '../ui/Logo'
import { useVendedorAuth } from '../../store/vendedorAuth'

// Layout 100% próprio do vendedor — nada compartilhado com AdminLayout
// (nem componente, nem rota /admin/*). Antes vendedor logava e caía
// dentro de /admin/pdv usando o MESMO layout/sidebar do admin (só
// filtrando os itens de menu por role) — mesmo com sessões isoladas de
// verdade (useVendedorAuth, chave própria), a URL/visual "/admin/..."
// para o vendedor lia como "entrou na conta do admin" e foi reportado
// como sessão se confundindo. Cada papel agora tem sua própria URL e seu
// próprio componente de guarda, sem overlap nenhum.
const NAV_ITEMS = [
  { href: '/funcionarios/vendedor/pedidos', label: 'Pedidos', icon: ClipboardList },
  { href: '/funcionarios/vendedor/pdv', label: 'PDV', icon: ShoppingCart },
  { href: '/funcionarios/vendedor/financeiro', label: 'Financeiro', icon: Wallet },
] as const

export default function VendedorLayout() {
  const { token, name, logout } = useVendedorAuth()
  const location = useLocation()
  const navigate = useNavigate()

  if (!token) return <Navigate to="/funcionarios/login" state={{ from: location }} replace />

  const handleLogout = () => {
    logout()
    navigate('/funcionarios/login')
  }

  return (
    <div className="min-h-screen bg-son-black text-white flex">
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 bg-son-surface border-r border-white/5 min-h-screen sticky top-0">
        <div className="px-5 py-5 border-b border-white/5">
          <Logo size="sm" />
          <p className="text-xs text-son-silver-dim mt-1">Olá, {name}</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = location.pathname === href
            return (
              <Link
                key={href}
                to={href}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active ? 'sunset-bg text-white' : 'text-son-silver-dim hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="px-3 py-4 border-t border-white/5">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-son-silver-dim hover:text-son-pink transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="md:hidden bg-son-surface border-b border-white/5 px-4 py-4 flex items-center justify-between sticky top-0 z-10">
          <Logo size="sm" />
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-son-silver-dim hover:text-son-pink text-sm">
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </header>
        <nav className="md:hidden flex gap-2 overflow-x-auto px-4 py-3 bg-son-black border-b border-white/5 scrollbar-hide sticky top-[65px] z-10">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = location.pathname === href
            return (
              <Link
                key={href}
                to={href}
                className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  active ? 'sunset-bg text-white' : 'bg-son-surface border border-white/5 text-son-silver hover:bg-son-surface-light'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </Link>
            )
          })}
        </nav>
        <main className="p-5 sm:p-8 max-w-6xl mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
