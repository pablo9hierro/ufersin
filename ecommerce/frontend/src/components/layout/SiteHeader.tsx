import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Heart, LogIn, UserPlus } from 'lucide-react'
import SunsetCartIcon from '../SunsetCartIcon'
import WhatsAppFab from '../WhatsAppFab'
import CustomerAuthModal from '../CustomerAuthModal'
import { useCart } from '../../store/cart'
import { useCustomerAuth } from '../../store/customerAuth'

// O logo clicável (header > div > a > img) foi retirado de todas as
// páginas de cliente a pedido — só sobra o "Voltar" do lado esquerdo.
export default function SiteHeader({
  showBack = true,
  showCart = true,
  showProfile = true,
  showWhatsApp = false,
}: {
  showBack?: boolean
  showCart?: boolean
  showProfile?: boolean
  showWhatsApp?: boolean
}) {
  const navigate = useNavigate()
  const count = useCart((s) => s.items.reduce((sum, i) => sum + i.quantity, 0))
  const customerAuth = useCustomerAuth()
  const [guestMenuOpen, setGuestMenuOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  return (
    <header className="px-5 sm:px-10 pt-5 max-w-6xl mx-auto">
      {/* Uiverse.io by Zain-Muhammad — moldura de 3 abas virou a moldura
          do navbar (voltar / nome da página / favoritos). */}
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
          <Link to="/" className="sunset-brand-btn" aria-label="Página inicial">
            <span>Sunset Tabas</span>
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
          {/* Igual ao botão flutuante — só o #cart-icon puro, sem pílula/
              texto "Sacola" ao redor. overflow-hidden + flex centering é
              necessário: o #cart-icon tem 140x120 nativos, e sem conter isso
              ele "vaza" pra fora da área pequena do header (ficava enorme e
              desalinhado, como reportado). */}
          {showCart && (
            <Link
              to="/carrinho"
              className="relative w-11 h-11 flex items-center justify-center overflow-hidden flex-shrink-0"
              aria-label="Ver carrinho"
            >
              <SunsetCartIcon scale={0.32} />
              {count > 0 && (
                <span className="absolute top-0 right-0 z-10 w-5 h-5 flex items-center justify-center text-xs font-bold sunset-bg text-white rounded-full">
                  {count}
                </span>
              )}
            </Link>
          )}
        </div>
      </div>
      {authMode && <CustomerAuthModal initialMode={authMode} onClose={() => setAuthMode(null)} onSuccess={() => setAuthMode(null)} />}
    </header>
  )
}
