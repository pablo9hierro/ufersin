import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, History, LogIn, LogOut, Menu, Tag, UserPlus } from 'lucide-react'
import WhatsAppFab from '../WhatsAppFab'
import CustomerAuthModal from '../CustomerAuthModal'
import { useCustomerAuth } from '../../store/customerAuth'

// Mesmo navbar de /catalogo (moldura sunset-nav-bar), só que com
// conteúdo próprio da landing: menu / nome da marca no estilo
// Uiverse.io by Cornerstone-04 (glow em loop contínuo, como já era) /
// WhatsApp (movido do FAB fixo pra dentro do navbar).
export default function BrandHeader() {
  const navigate = useNavigate()
  const customerAuth = useCustomerAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  return (
    <header className="px-5 sm:px-10 pt-5 max-w-6xl mx-auto">
      <div className="sunset-nav-bar">
        <div className="sunset-nav-slot sunset-nav-slot-start">
          <div className="relative">
            {menuOpen && <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
            {customerAuth.token ? (
              <>
                {/* Uiverse.io by Na3ar-17 — cartão de menu com grupos
                    separados. Abre ao clicar, fecha clicando fora. Itens
                    sem ação por enquanto. */}
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  className="sunset-profile-btn w-11 h-11 flex items-center justify-center flex-shrink-0 relative z-30"
                  aria-label="Menu"
                  aria-expanded={menuOpen}
                >
                  <Menu className="w-4 h-4" />
                </button>
                {menuOpen && (
                  <div className="sunset-menu-card">
                    <ul className="sunset-menu-list">
                      <li
                        className="sunset-menu-item"
                        onClick={() => {
                          setMenuOpen(false)
                          navigate('/cliente/favoritos')
                        }}
                      >
                        <Heart />
                        <p className="sunset-menu-label">Favoritos</p>
                      </li>
                    </ul>
                    <div className="sunset-menu-separator" />
                    <ul className="sunset-menu-list">
                      <li
                        className="sunset-menu-item"
                        onClick={() => {
                          setMenuOpen(false)
                          navigate('/cliente/cupons')
                        }}
                      >
                        <Tag />
                        <p className="sunset-menu-label">Cupons</p>
                      </li>
                    </ul>
                    <div className="sunset-menu-separator" />
                    <ul className="sunset-menu-list">
                      <li
                        className="sunset-menu-item sunset-menu-item-accent"
                        onClick={() => {
                          setMenuOpen(false)
                          navigate('/cliente/historico')
                        }}
                      >
                        <History />
                        <p className="sunset-menu-label">Histórico</p>
                      </li>
                    </ul>
                    <div className="sunset-menu-separator" />
                    <ul className="sunset-menu-list">
                      <li
                        className="sunset-menu-item sunset-menu-item-danger"
                        onClick={() => {
                          setMenuOpen(false)
                          customerAuth.logout()
                        }}
                      >
                        <LogOut />
                        <p className="sunset-menu-label">Sair</p>
                      </li>
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Uiverse.io by devkatyall — visitante deslogado vê esse
                    botão no lugar do menu, com "Entrar"/"Criar conta" em
                    vez das opções de conta (que exigem login). */}
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  className="sunset-guest-burger w-11 h-11 flex-shrink-0 relative z-30"
                  aria-label="Entrar ou criar conta"
                  aria-expanded={menuOpen}
                >
                  <Menu className="w-5 h-5" />
                </button>
                {menuOpen && (
                  <div className="sunset-menu-card">
                    <ul className="sunset-menu-list">
                      <li
                        className="sunset-menu-item"
                        onClick={() => {
                          setMenuOpen(false)
                          setAuthMode('login')
                        }}
                      >
                        <LogIn />
                        <p className="sunset-menu-label">Entrar</p>
                      </li>
                      <li
                        className="sunset-menu-item"
                        onClick={() => {
                          setMenuOpen(false)
                          setAuthMode('register')
                        }}
                      >
                        <UserPlus />
                        <p className="sunset-menu-label">Criar conta</p>
                      </li>
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="sunset-nav-slot sunset-nav-slot-center">
          <div className="sunset-brand-btn">
            <span>Sunset Tabas</span>
          </div>
        </div>
        <div className="sunset-nav-slot sunset-nav-slot-end">
          <WhatsAppFab inline />
        </div>
      </div>
      {authMode && <CustomerAuthModal initialMode={authMode} onClose={() => setAuthMode(null)} onSuccess={() => setAuthMode(null)} />}
    </header>
  )
}
