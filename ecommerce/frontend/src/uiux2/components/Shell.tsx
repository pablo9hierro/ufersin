import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from '../../lib/tenantRouter'
import { ArrowLeft, Heart, History, LogIn, LogOut, Menu, Package, ShoppingBag, Store, Tag, UserPlus, X } from 'lucide-react'
import { useCart } from '../../store/cart'
import { useCustomerAuth } from '../../store/customerAuth'
import UfersinMark from '../../components/ui/UfersinMark'
import CartFab from '../../components/CartFab'
import AuthModal from './AuthModal'
import { brandName, isDemoModeActive, storefrontAllowsCoupons } from '../../lib/demoMode'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { persistTenantSlug, resolveTenantSlug } from '../../lib/tenantConfig'

// Layout padrão de toda página de cliente no estilo Ufersin nativo --
// mesmas 9 páginas/rotas/ações do Sunset, só a apresentação muda (ver
// StyleAware em App.tsx, que escolhe entre esse Shell e o SiteHeader do
// Sunset conforme o estilo escolhido no seletor).
function AccountMenu({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const auth = useCustomerAuth()
  const tenantConfig = useTenantConfig()
  const couponsEnabled = storefrontAllowsCoupons(tenantConfig?.plano)
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="u2-surface fixed bottom-0 left-0 right-0 sm:absolute sm:bottom-auto sm:right-0 sm:left-auto sm:top-full sm:mt-2 sm:w-64 z-50 p-2 rounded-b-none sm:rounded-b-2xl">
        {auth.token ? (
          <ul className="divide-y divide-white/5">
            <li>
              <button onClick={() => go('/cliente/favoritos')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <Heart className="w-4 h-4 u2-accent" /> Favoritos
              </button>
            </li>
            {couponsEnabled && (
            <li>
              <button onClick={() => go('/cliente/cupons')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <Tag className="w-4 h-4 u2-accent" /> Cupons
              </button>
            </li>
            )}
            <li>
              <button onClick={() => go('/cliente/historico')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <History className="w-4 h-4 u2-accent" /> Histórico de pedidos
              </button>
            </li>
            <li>
              <button
                onClick={() => {
                  onClose()
                  auth.logout()
                }}
                className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium u2-dim"
              >
                <LogOut className="w-4 h-4" /> Sair
              </button>
            </li>
          </ul>
        ) : (
          <ul className="divide-y divide-white/5">
            <li>
              <button onClick={() => setAuthMode('login')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <LogIn className="w-4 h-4 u2-accent" /> Entrar
              </button>
            </li>
            <li>
              <button onClick={() => setAuthMode('register')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <UserPlus className="w-4 h-4 u2-accent" /> Criar conta
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
  { key: 'catalogo', href: '/catalogo', label: 'Catálogo', icon: Store },
  { key: 'checkout', href: '/checkout', label: 'Finalizar', icon: ShoppingBag },
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
  const showMark = isDemoModeActive()

  useEffect(() => {
    const slug = resolveTenantSlug()
    if (slug) persistTenantSlug(slug)
  }, [])

  return (
    <div className="u2-page pb-20 sm:pb-0">
      <header className="u2-surface sticky top-0 z-30 !rounded-none !border-x-0 !border-t-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-3 relative flex items-center justify-between gap-3 min-h-[3.75rem]">
          <div className="flex items-center gap-2 shrink-0 z-10 min-w-0">
            {!isLanding && (
              <button onClick={() => navigate(-1)} aria-label="Voltar" className="w-9 h-9 flex items-center justify-center u2-card !rounded-full shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            {isLanding && (
              <Link
                to="/"
                className="flex flex-col items-center justify-center gap-0.5 self-start w-max max-w-[9.5rem] sm:max-w-[11rem] font-black text-sm sm:text-base text-center"
                aria-label="Página inicial"
              >
                {tenantConfig?.logo_url ? (
                  <img src={tenantConfig.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0 mx-auto" />
                ) : (
                  showMark && <UfersinMark className="w-8 h-8 u2-accent mx-auto" />
                )}
                <span className="u2-gradient-text block w-full text-center leading-tight line-clamp-2 break-words">{name}</span>
              </Link>
            )}
          </div>

          {!isLanding && (
            <Link
              to="/"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-0.5 font-black text-sm sm:text-base max-w-[46%] min-w-0 text-center"
              aria-label="Página inicial"
            >
              {tenantConfig?.logo_url ? (
                <img src={tenantConfig.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
              ) : (
                showMark && <UfersinMark className="w-8 h-8 u2-accent" />
              )}
              <span className="u2-gradient-text truncate max-w-full text-center leading-tight">{name}</span>
            </Link>
          )}

          <div className="flex items-center gap-2 shrink-0 z-10">
            <div className="hidden sm:flex items-center gap-1 mr-1">
              {TABS.map((t) => {
                const active = location.pathname === t.href
                return (
                  <Link key={t.key} to={t.href} className={`u2-navitem px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${active ? 'is-active' : ''}`}>
                    <t.icon className="w-4 h-4" />
                    {t.label}
                    {t.key === 'checkout' && cartCount > 0 && <span className="u2-badge w-5 h-5 flex items-center justify-center text-[10px]">{cartCount}</span>}
                  </Link>
                )
              })}
            </div>
            {auth.token ? (
              <Link to="/cliente/favoritos" className="w-10 h-10 flex items-center justify-center u2-card !rounded-full" aria-label="Favoritos">
                <Heart className="w-4 h-4" />
              </Link>
            ) : (
              <button type="button" onClick={() => setAuthOpen(true)} className="w-10 h-10 flex items-center justify-center u2-card !rounded-full" aria-label="Favoritos">
                <Heart className="w-4 h-4" />
              </button>
            )}
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)} className="w-10 h-10 flex items-center justify-center u2-card !rounded-full" aria-label="Menu da conta" aria-expanded={menuOpen}>
                {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
              {menuOpen && <AccountMenu onClose={() => setMenuOpen(false)} />}
            </div>
          </div>
        </div>
      </header>

      <CartFab />

      <div className="max-w-5xl mx-auto">{children}</div>

      <nav className="u2-surface u2-surface-bottom-bar sm:hidden fixed bottom-0 left-0 right-0 z-30 !rounded-none !border-x-0 !border-b-0 flex items-stretch">
        {TABS.map((t) => {
          const active = location.pathname === t.href
          return (
            <Link key={t.key} to={t.href} className={`u2-navitem flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${active ? 'is-active' : ''}`}>
              <span className="relative">
                <t.icon className="w-5 h-5" />
                {t.key === 'checkout' && cartCount > 0 && <span className="u2-badge absolute -top-1.5 -right-2 w-4 h-4 text-[9px] flex items-center justify-center">{cartCount}</span>}
              </span>
              {t.label}
            </Link>
          )
        })}
        <button onClick={() => setMenuOpen((o) => !o)} className={`u2-navitem flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${menuOpen ? 'is-active' : ''}`}>
          <Menu className="w-5 h-5" />
          Conta
        </button>
      </nav>
      {authOpen && <AuthModal initialMode="login" onClose={() => setAuthOpen(false)} onSuccess={() => setAuthOpen(false)} />}
    </div>
  )
}
