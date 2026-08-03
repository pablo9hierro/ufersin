import { useEffect, useState } from 'react'
import { Link, useNavigate } from '../../lib/tenantRouter'
import { Heart, LogIn, UserPlus } from 'lucide-react'
import WhatsAppFab from '../WhatsAppFab'
import CustomerAuthModal from '../CustomerAuthModal'
import CartFab from '../CartFab'
import { useCustomerAuth } from '../../store/customerAuth'
import { brandName } from '../../lib/demoMode'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { persistTenantSlug, resolveTenantSlug } from '../../lib/tenantConfig'

// Navbar de páginas de cliente (exceto Landing/BrandHeader): voltar |
// marca centralizada (logo+nome) | favoritos. Carrinho é o CartFab
// flutuante (canto inferior esquerdo), não no header.
export default function SiteHeader({
  showBack = true,
  showCart = true,
  showProfile = true,
  showWhatsApp = false,
}: {
  showBack?: boolean
  /** Mantido por compat — controla se o CartFab/drawer monta. */
  showCart?: boolean
  showProfile?: boolean
  showWhatsApp?: boolean
}) {
  const navigate = useNavigate()
  const customerAuth = useCustomerAuth()
  const tenantConfig = useTenantConfig()
  const [guestMenuOpen, setGuestMenuOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  useEffect(() => {
    const slug = resolveTenantSlug()
    if (slug) persistTenantSlug(slug)
  }, [])

  const name = brandName(tenantConfig?.loja_nome)

  return (
    <header className="px-5 sm:px-10 pt-5 max-w-6xl mx-auto">
      {/* Uiverse.io by Zain-Muhammad — moldura de 3 abas virou a moldura
          do navbar (voltar / marca / favoritos). */}
      <div className="sunset-nav-bar">
        <div className="sunset-nav-slot sunset-nav-slot-start">
          {showBack && (
            // Texto "Voltar" removido — com start/end de larguras diferentes
            // (ícone só vs ícone+texto), a coluna central (nome da página)
            // não ficava no centro de verdade da barra (reportado).
            <button type="button" onClick={() => navigate(-1)} className="flex items-center" aria-label="Voltar">
              {/* Uiverse.io by karthik092726122003 — botão de setas
                  deslizantes, era :hover, virou loop automático. */}
              <span className="sunset-back-wrap">
                <span className="sunset-back-btn2">
                  <span className="sunset-back-box">
                    <span className="sunset-back-elem">
                      <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
                        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                      </svg>
                    </span>
                    <span className="sunset-back-elem">
                      <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
                        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                      </svg>
                    </span>
                  </span>
                </span>
              </span>
            </button>
          )}
        </div>
        <div className="sunset-nav-slot sunset-nav-slot-center">
          <Link to="/" className="sunset-brand-btn flex flex-col items-center gap-0.5" aria-label="Página inicial">
            {tenantConfig?.logo_url ? (
              <img src={tenantConfig.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover" />
            ) : null}
            <span>{name}</span>
          </Link>
        </div>
        <div className="sunset-nav-slot sunset-nav-slot-end">
          {/* Logado: vai direto pros favoritos. Deslogado: abre o mesmo
              popup "Entrar"/"Criar conta" da landing (BrandHeader), em
              vez de navegar pra uma página que exige login. */}
          {showProfile && (
            <div className="relative">
              {guestMenuOpen && (
                <div className="fixed inset-0 z-20" onClick={() => setGuestMenuOpen(false)} aria-hidden="true" />
              )}
              <button
                type="button"
                onClick={() => (customerAuth.token ? navigate('/cliente/favoritos') : setGuestMenuOpen((o) => !o))}
                className="sunset-profile-btn w-11 h-11 flex items-center justify-center flex-shrink-0 relative z-30"
                aria-label="Favoritos"
                aria-expanded={customerAuth.token ? undefined : guestMenuOpen}
              >
                <Heart className="w-4 h-4" />
              </button>
              {!customerAuth.token && guestMenuOpen && (
                <div className="sunset-menu-card" style={{ left: 'auto', right: 0 }}>
                  <ul className="sunset-menu-list">
                    <li
                      className="sunset-menu-item"
                      onClick={() => {
                        setGuestMenuOpen(false)
                        setAuthMode('login')
                      }}
                    >
                      <LogIn />
                      <p className="sunset-menu-label">Entrar</p>
                    </li>
                    <li
                      className="sunset-menu-item"
                      onClick={() => {
                        setGuestMenuOpen(false)
                        setAuthMode('register')
                      }}
                    >
                      <UserPlus />
                      <p className="sunset-menu-label">Criar conta</p>
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}
          {showWhatsApp && <WhatsAppFab inline />}
        </div>
      </div>
      {showCart && <CartFab />}
      {authMode && <CustomerAuthModal initialMode={authMode} onClose={() => setAuthMode(null)} onSuccess={() => setAuthMode(null)} />}
    </header>
  )
}
