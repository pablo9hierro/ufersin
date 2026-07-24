import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useIsAuthenticated } from '../../lib/authStore'

const LINKS = [
  { href: '#recursos', label: 'Recursos' },
  { href: '#planos', label: 'Planos' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#faq', label: 'FAQ' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
        scrolled ? 'uf-glass border-b border-white/5' : 'bg-transparent'
      }`}
    >
      <nav className="uf-container flex items-center justify-between px-5 py-4">
        <Link to="/" className="text-xl font-black tracking-tight">
          <span className="uf-text">Rodoletas</span>
        </Link>

        <div className="hidden md:flex items-center gap-7">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm text-uf-silver-dim hover:text-uf-silver transition-colors">
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Link to="/dashboard" className="btn-secondary px-4 py-2 text-sm">
              Meu painel
            </Link>
          ) : (
            <Link to="/login" className="btn-ghost text-sm hidden sm:inline-flex">
              Entrar
            </Link>
          )}
          <a href="#planos" className="btn-primary px-4 py-2.5 text-sm">
            Assinar agora
          </a>
        </div>
      </nav>
    </motion.header>
  )
}
