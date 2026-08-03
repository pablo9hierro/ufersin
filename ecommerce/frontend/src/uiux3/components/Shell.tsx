import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from '../../lib/tenantRouter'
import { ArrowLeft, Heart, History, LogIn, LogOut, Menu, Package, ShoppingBag, Store, Tag, UserPlus, X } from 'lucide-react'
import { useCart } from '../../store/cart'
import { useCustomerAuth } from '../../store/customerAuth'
import CartFab from '../../components/CartFab'
import AuthModal from './AuthModal'
import { brandName } from '../../lib/demoMode'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { persistTenantSlug, resolveTenantSlug } from '../../lib/tenantConfig'

// Layout do estilo BurgerBite -- ao contrário do Ufersin nativo (header
// com fileira de abas + barra inferior de ponta a ponta), aqui a
// navegação é por ÍCONES CIRCULARES soltos no topo e um DOCK flutuante
// em pílula no rodapé (mobile). Nenhuma classe/estrutura compartilhada
// com uiux2/components/Shell.tsx.
function AccountMenu({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const auth = useCustomerAuth()
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="u3-topbar fixed bottom-0 left-0 right-0 sm:absolute sm:bottom-auto sm:right-0 sm:left-auto sm:top-full sm:mt-2 sm:w-64 z-50 p-2 rounded-t-3xl sm:rounded-3xl">
        {auth.token ? (
          <ul className="divide-y divide-white/5">
            <li>
              <button onClick={() => go('/cliente/favoritos')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <Heart className="w-4 h-4 u3-accent" /> Favoritos
              </button>
            </li>
            <li>
              <button onClick={() => go('/cliente/cupons')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <Tag className="w-4 h-4 u3-accent" /> Cupons
              </button>
            </li>
            <li>
              <button onClick={() => go('/cliente/historico')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <History className="w-4 h-4 u3-accent" /> Histórico de pedidos
              </button>
            </li>
            <li>
              <button
                onClick={() => {
                  onClose()
                  auth.logout()
                }}
                className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium u3-dim"
              >
                <LogOut className="w-4 h-4" /> Sair
              </button>
            </li>
          </ul>
        ) : (
          <ul className="divide-y divide-white/5">
            <li>
              <button onClick={() => setAuthMode('login')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <LogIn className="w-4 h-4 u3-accent" /> Entrar
              </button>
            </li>
            <li>
              <button onClick={() => setAuthMode('register')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <UserPlus className="w-4 h-4 u3-accent" /> Criar conta
              </button>
            </li>
            <li>
              <button onClick={() => go('/recuperar-senha')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium u3-dim">
                Esqueci minha senha
              </button>
            </li>
          </ul>
        )}
      </div>
      {authMode && (
        <AuthModal
          initialMode={authMode}
          onClose={() => setAuthMode(null)}
          onSuccess={() => {
            setAuthMode(null)
            onClose()
          }}
        />
      )}
    </>
  )
}

const TABS = [
  { key: 'catalogo', href: '/catalogo', label: 'Cardápio', icon: Store },
  { key: 'checkout', href: '/checkout', label: 'Sacola', icon: ShoppingBag },
  { key: 'consultar', href: '/consultar', label: 'Pedidos', icon: Package },
]

export default function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const auth = useCustomerAuth()
  const tenantConfig = useTenantConfig()
  const cartCount = useCart((s) => s.items.reduce((sum, i) => sum + i.quantity, 0))
  const [menuOpen, setMenuOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const isLanding = location.pathname === '/'
  const name = brandName(tenantConfig?.loja_nome)

  useEffect(() => {
    const slug = resolveTenantSlug()
    if (slug) persistTenantSlug(slug)
  }, [])

  return (
    <div className="u3-page pb-24 sm:pb-0">
      <header className="u3-topbar sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-3 relative flex items-center justify-between gap-3 min-h-[3.75rem]">
          <div className="flex items-center gap-2 shrink-0 z-10 min-w-0">
            {!isLanding && (
              <button onClick={() => navigate(-1)} className="u3-icon-btn" aria-label="Voltar">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            {isLanding && (
              <Link
                to="/"
                className="u3-wordmark flex flex-col items-start gap-0.5 text-lg font-black tracking-tight max-w-[70%] min-w-0"
                aria-label="Página inicial"
              >
                {tenantConfig?.logo_url ? (
                  <img src={tenantConfig.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                ) : null}
                <span className="truncate max-w-full text-left leading-tight text-sm sm:text-base">{name}</span>
              </Link>
            )}
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)} className="u3-icon-btn" aria-label="Menu da conta" aria-expanded={menuOpen}>
                {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
              {menuOpen && <AccountMenu onClose={() => setMenuOpen(false)} />}
            </div>
          </div>

          {!isLanding && (
            <Link
              to="/"
              className="u3-wordmark absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg font-black tracking-tight flex flex-col items-center gap-0.5 max-w-[46%] min-w-0"
              aria-label="Página inicial"
            >
              {tenantConfig?.logo_url ? (
                <img src={tenantConfig.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
              ) : null}
              <span className="truncate max-w-full text-center leading-tight text-sm sm:text-base">{name}</span>
            </Link>
          )}

          <div className="flex items-center gap-2 shrink-0 z-10">
            <div className="hidden sm:flex items-center gap-2 mr-1">
              {TABS.map((t) => {
                const active = location.pathname === t.href
                return (
                  <Link key={t.key} to={t.href} className="u3-pill-secondary !border-0 px-4 py-2 text-sm flex items-center gap-1.5" style={active ? { color: 'var(--u3-orange)' } : undefined}>
                    <t.icon className="w-4 h-4" />
                    {t.label}
                  </Link>
                )
              })}
            </div>
            {auth.token ? (
              <Link to="/cliente/favoritos" className="u3-icon-btn" aria-label="Favoritos">
                <Heart className="w-4 h-4" />
              </Link>
            ) : (
              <button type="button" onClick={() => setAuthOpen(true)} className="u3-icon-btn" aria-label="Favoritos">
                <Heart className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <CartFab />

      <div className="max-w-5xl mx-auto">{children}</div>

      {/* Dock flutuante em pílula -- só mobile, nunca ocupa a largura
          inteira da tela (ao contrário da barra do Ufersin nativo). */}
      <nav className="u3-dock sm:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 px-2 py-2">
        {TABS.map((t) => {
          const active = location.pathname === t.href
          return (
            <Link key={t.key} to={t.href} className={`u3-dock-item w-12 h-12 rounded-full flex flex-col items-center justify-center gap-0.5 relative ${active ? 'is-active' : ''}`} aria-label={t.label}>
              <t.icon className="w-5 h-5" />
              {t.key === 'checkout' && cartCount > 0 && (
                <span className="absolute top-0.5 right-1.5 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white" style={{ background: 'var(--u3-red)' }}>
                  {cartCount}
                </span>
              )}
            </Link>
          )
        })}
        <button onClick={() => setMenuOpen((o) => !o)} className={`u3-dock-item w-12 h-12 rounded-full flex flex-col items-center justify-center ${menuOpen ? 'is-active' : ''}`} aria-label="Conta">
          <Menu className="w-5 h-5" />
        </button>
      </nav>
      {authOpen && <AuthModal initialMode="login" onClose={() => setAuthOpen(false)} onSuccess={() => setAuthOpen(false)} />}
    </div>
  )
}
