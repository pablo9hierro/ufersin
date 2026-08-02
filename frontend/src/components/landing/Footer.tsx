import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="border-t border-white/5 py-16 px-5">
      <div className="uf-container flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link to="/" className="text-lg font-black uf-text">
          Resolutoo
        </Link>
        <p className="text-xs text-uf-silver-dim text-center">
          © {new Date().getFullYear()} Resolutoo. A plataforma que coloca sua loja online em dias.
        </p>
        <div className="flex items-center gap-5 text-xs text-uf-silver-dim">
          <a href="#planos" className="hover:text-uf-silver transition-colors">
            Planos
          </a>
          <a href="#faq" className="hover:text-uf-silver transition-colors">
            FAQ
          </a>
          <Link to="/login" className="hover:text-uf-silver transition-colors">
            Entrar
          </Link>
        </div>
      </div>
    </footer>
  )
}
