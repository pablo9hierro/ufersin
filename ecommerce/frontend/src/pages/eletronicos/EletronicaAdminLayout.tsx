import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CalendarDays, ClipboardList, LogOut, MessageCircle, MessageSquare, Package, ShoppingCart, Truck, UserCog, Wallet } from 'lucide-react'
import { useAdminAuth } from '../../store/adminAuth'
import { withTenantSearch } from '../../lib/tenantConfig'

// Port 1:1 de src/components/dashboard/DashboardSidebar.tsx do vrtech --
// mesmos 9 itens, mesmos ícones, mesma ordem. AdminLink (Next Link) vira
// NavLink do react-router; auth reaproveita o mesmo login/JWT de /admin
// (o backend não distingue vertical no JWT, já tenant-scoped).
const NAV_ITEMS = [
  { to: '', label: 'Solicitações', icon: ClipboardList },
  { to: 'chat', label: 'Chat', icon: MessageCircle },
  { to: 'pdv', label: 'PDV', icon: ShoppingCart },
  { to: 'agenda', label: 'Agenda', icon: CalendarDays },
  { to: 'produtos', label: 'Produtos/Serviços', icon: Package },
  { to: 'servicodeslocamento', label: 'Serviço de deslocamento', icon: Truck },
  { to: 'relatorios', label: 'Relatórios', icon: Wallet },
  { to: 'template-zap', label: 'Template Zap', icon: MessageSquare },
  { to: 'conta', label: 'Conta', icon: UserCog },
]

export default function EletronicaAdminLayout() {
  const { token, name, logout } = useAdminAuth()
  const navigate = useNavigate()

  if (!token) return <Navigate to={`/admin/login${withTenantSearch()}`} replace />

  function handleLogout() {
    logout()
    navigate('/admin/login')
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b] md:flex">
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 bg-[#161618] border-r border-white/5 min-h-screen sticky top-0">
        <div className="px-5 py-5 border-b border-white/5">
          <span className="font-black text-white">{name || 'VR Tech'}</span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={`/admin-eletronica${to ? `/${to}` : ''}${withTenantSearch()}`}
              end={to === ''}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive ? 'bg-[#e0211a] text-white' : 'text-[#d4d4d8]/70 hover:bg-[#232327] hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-white/5">
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-[#d4d4d8]/70 hover:text-[#e0211a] transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </aside>

      <header className="md:hidden bg-[#161618] border-b border-white/5 px-4 py-4 flex items-center justify-between sticky top-0 z-10">
        <span className="font-black text-white">{name || 'VR Tech'}</span>
        <button type="button" onClick={handleLogout} className="flex items-center gap-1.5 text-[#d4d4d8]/70 hover:text-[#e0211a] text-sm transition-colors">
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </header>
      <nav className="md:hidden flex gap-2 overflow-x-auto px-4 py-3 bg-[#0a0a0b] border-b border-white/5 sticky top-[65px] z-10">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={`/admin-eletronica${to ? `/${to}` : ''}${withTenantSearch()}`}
            end={to === ''}
            className={({ isActive }) =>
              `shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                isActive ? 'bg-[#e0211a] text-white' : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:bg-[#232327]'
              }`
            }
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1 min-w-0 p-5">
        <Outlet />
      </div>
    </div>
  )
}
