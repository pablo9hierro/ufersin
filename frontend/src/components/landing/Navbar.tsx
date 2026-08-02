import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { useIsAuthenticated } from '../../lib/authStore'

const LINKS = [
  { href: '#recursos', label: 'Recursos' },
  { href: '#planos', label: 'Planos' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#faq', label: 'FAQ' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Trava o scroll do body com o menu mobile aberto, e fecha sozinho se a
  // tela crescer pra desktop enquanto ele tá aberto (ex: girar o celular).
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
        scrolled || menuOpen ? 'uf-glass border-b border-white/5' : 'bg-transparent'
      }`}
    >
      <nav className="uf-container flex items-center justify-between px-5 py-4">
        <Link to="/" className="text-xl font-black tracking-tight" onClick={() => setMenuOpen(false)}>
          <span className="uf-text">Resolutoo</span>
        </Link>

        <div className="hidden md:flex items-center gap-7">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm text-uf-silver-dim hover:text-uf-silver transition-colors">
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {isAuthenticated ? (
            <Link to="/meu-plano" className="btn-secondary px-3 sm:px-4 py-2 text-sm">
              Meu painel
            </Link>
          ) : (
            <Link to="/login" className="btn-ghost text-sm hidden sm:inline-flex">
              Entrar
            </Link>
          )}
          <a href="#planos" className="btn-primary px-3 sm:px-4 py-2.5 text-xs sm:text-sm whitespace-nowrap">
            Assinar agora
          </a>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="md:hidden w-9 h-9 -mr-1 flex items-center justify-center text-uf-silver-dim"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="md:hidden overflow-hidden uf-glass border-t border-white/5"
          >
            <div className="px-5 py-4 flex flex-col gap-1">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  className="py-3 text-sm text-uf-silver-dim hover:text-uf-silver border-b border-white/5 last:border-b-0"
                >
                  {l.label}
                </a>
              ))}
              {!isAuthenticated && (
                <Link to="/login" onClick={() => setMenuOpen(false)} className="py-3 text-sm text-uf-silver-dim hover:text-uf-silver">
                  Entrar
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}
