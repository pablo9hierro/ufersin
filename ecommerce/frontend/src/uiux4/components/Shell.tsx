import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from '../../lib/tenantRouter'
import { ArrowLeft, Heart, History, LogIn, LogOut, Menu, Package, ShoppingBag, Store, Tag, UserPlus, X } from 'lucide-react'
import { useCart } from '../../store/cart'
import { useCartDrawer } from '../../store/cartDrawer'
import { useCustomerAuth } from '../../store/customerAuth'
import CartDrawer from '../../components/CartDrawer'
import AuthModal from './AuthModal'
import { brandName } from '../../lib/demoMode'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { persistTenantSlug, resolveTenantSlug } from '../../lib/tenantConfig'

// Layout do estilo Burger House -- minimalista, quase monocromático.
// Barra superior com ícones PLANOS (sem fundo circular como o
// BurgerBite), wordmark em versalete puro (sem degradê). Navegação
// principal é uma FAIXA DE ABAS fina no rodapé (texto + traço superior
// laranja no item ativo), nunca um dock flutuante nem barra ícone+label
// cheia. Nenhuma classe/estrutura compartilhada com uiux2 ou uiux3.
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
      <div className="u4-panel fixed bottom-0 left-0 right-0 sm:absolute sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-64 z-50 p-2 rounded-b-none sm:rounded-b-2xl">
        {auth.token ? (
          <ul className="divide-y divide-white/5">
            <li>
              <button onClick={() => go('/cliente/favoritos')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <Heart className="w-4 h-4 u4-accent" /> Favoritos
              </button>
            </li>
            <li>
              <button onClick={() => go('/cliente/cupons')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <Tag className="w-4 h-4 u4-accent" /> Cupons
              </button>
            </li>
            <li>
              <button onClick={() => go('/cliente/historico')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <History className="w-4 h-4 u4-accent" /> Histórico de pedidos
              </button>
            </li>
            <li>
              <button
                onClick={() => {
                  onClose()
                  auth.logout()
                }}
                className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium u4-dim"
              >
                <LogOut className="w-4 h-4" /> Sair
              </button>
            </li>
          </ul>
        ) : (
          <ul className="divide-y divide-white/5">
            <li>
              <button onClick={() => setAuthMode('login')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <LogIn className="w-4 h-4 u4-accent" /> Entrar
              </button>
            </li>
            <li>
              <button onClick={() => setAuthMode('register')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium">
                <UserPlus className="w-4 h-4 u4-accent" /> Criar conta
              </button>
            </li>
            <li>
              <button onClick={() => go('/recuperar-senha')} className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium u4-dim">
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
  const openDrawer = useCartDrawer((s) => s.openDrawer)
  const [menuOpen, setMenuOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const isLanding = location.pathname === '/'
  const name = brandName(tenantConfig?.loja_nome)

  useEffect(() => {
    const slug = resolveTenantSlug()
    if (slug) persistTenantSlug(slug)
  }, [])

  return (
    <div className="u4-page pb-16 sm:pb-0">
      <header className="u4-topbar sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-3 min-h-[3.75rem] relative">
          <div className="flex items-center gap-2 shrink-0 z-10 min-w-0">
            {!isLanding && (
              <button onClick={() => navigate(-1)} className="u4-icon-btn" aria-label="Voltar">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            {isLanding && (
              <Link
                to="/"
                className="text-sm font-black uppercase tracking-[0.15em] flex flex-col items-center justify-center gap-0.5 self-start w-max max-w-[9.5rem] sm:max-w-[11rem] text-center"
                aria-label="Página inicial"
              >
                {tenantConfig?.logo_url ? (
                  <img src={tenantConfig.logo_url} alt="" className="w-8 h-8 rounded object-cover shrink-0 mx-auto" />
                ) : null}
                <span className="block w-full text-center leading-tight text-[11px] sm:text-sm line-clamp-2 break-words">{name}</span>
              </Link>
            )}
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)} className="u4-icon-btn" aria-label="Menu da conta" aria-expanded={menuOpen}>
                {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
              {menuOpen && <AccountMenu onClose={() => setMenuOpen(false)} />}
            </div>
          </div>

          {!isLanding && (
            <Link
              to="/"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm font-black uppercase tracking-[0.15em] flex flex-col items-center gap-0.5 max-w-[46%] min-w-0 text-center"
              aria-label="Página inicial"
            >
              {tenantConfig?.logo_url ? (
                <img src={tenantConfig.logo_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              ) : null}
              <span className="truncate max-w-full text-center leading-tight text-[11px] sm:text-sm">{name}</span>
            </Link>
          )}

          <div className="flex items-center gap-2 shrink-0 z-10">
            <div className="hidden sm:flex items-center gap-1 mr-1">
              {TABS.map((t) => {
                const active = location.pathname === t.href
                return (
                  <Link key={t.key} to={t.href} className={`u4-tab px-3.5 py-1.5 text-xs flex items-center gap-1.5 ${active ? 'is-active' : ''}`}>
                    {t.label}
                  </Link>
                )
              })}
            </div>
            {auth.token ? (
              <Link to="/cliente/favoritos" className="u4-icon-btn" aria-label="Favoritos">
                <Heart className="w-4 h-4" />
              </Link>
            ) : (
              <button type="button" onClick={() => setAuthOpen(true)} className="u4-icon-btn" aria-label="Favoritos">
                <Heart className="w-4 h-4" />
              </button>
            )}
            {!isLanding && (
              <button type="button" onClick={openDrawer} className="u4-icon-btn relative" aria-label="Ver sacola">
                <ShoppingBag className="w-4 h-4" />
                {cartCount > 0 && <span className="absolute -top-1 -right-1 u4-tag w-4 h-4 !rounded-full text-[9px] flex items-center justify-center">{cartCount}</span>}
              </button>
            )}
          </div>
        </div>
      </header>

      <CartDrawer />

      <div className="max-w-5xl mx-auto">{children}</div>

      <nav className="u4-navstrip sm:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch">
        {TABS.map((t) => {
          const active = location.pathname === t.href
          return (
            <Link key={t.key} to={t.href} className={`u4-navstrip-item flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${active ? 'is-active' : ''}`}>
              <span className="relative">
                <t.icon className="w-5 h-5" />
                {t.key === 'checkout' && cartCount > 0 && <span className="absolute -top-1.5 -right-2 u4-tag w-4 h-4 !rounded-full text-[8px] flex items-center justify-center">{cartCount}</span>}
              </span>
              {t.label}
            </Link>
          )
        })}
        <button onClick={() => setMenuOpen((o) => !o)} className={`u4-navstrip-item flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${menuOpen ? 'is-active' : ''}`}>
          <Menu className="w-5 h-5" />
          Conta
        </button>
      </nav>
      {authOpen && <AuthModal initialMode="login" onClose={() => setAuthOpen(false)} onSuccess={() => setAuthOpen(false)} />}
    </div>
  )
}
