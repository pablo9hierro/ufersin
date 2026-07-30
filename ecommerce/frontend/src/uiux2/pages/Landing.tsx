import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, MapPin, MessageCircle, ShoppingBag, Star, Truck, Wallet } from 'lucide-react'
import { useStoreStatus } from '../../hooks/useStoreStatus'
import { getStoreOpenState } from '../../lib/storeHours'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import AuthModal from '../components/AuthModal'
import PromoCarousel from '../components/PromoCarousel'

const DESTAQUES = [
  { icon: Truck, title: 'Entrega rápida', desc: 'Pedido pronto em até 20 minutos' },
  { icon: Wallet, title: 'Pague com Pix', desc: 'Aprovação na hora, sem complicação' },
  { icon: Star, title: '4,9 de avaliação', desc: 'O point mais pedido da cidade' },
]

// Home nativa da Ufersin -- mesma ação (ver catálogo / acompanhar pedido)
// da Landing.tsx do Sunset, layout próprio (sem cenário de fundo, sem
// glow -- ver uiux2/theme.css).
export default function Uiux2Landing() {
  const navigate = useNavigate()
  const customerAuth = useCustomerAuth()
  const { data: storeStatus } = useStoreStatus()
  const [showAuthModal, setShowAuthModal] = useState(false)

  const openState = storeStatus ? getStoreOpenState(storeStatus) : null
  const closed = !!openState && !openState.open

  return (
    <Shell>
      {closed && <div className="bg-red-500/10 text-red-600 text-sm text-center px-4 py-3">Loja fechada no momento. {openState?.reason || 'Volte mais tarde!'}</div>}
      <PromoCarousel />
      <div className="relative overflow-hidden">
        {/* Mesh de fundo do hero -- mesmo recurso decorativo do site real
            da Ufersin (uf-mesh), só aqui, não na página inteira. */}
        <div className="u2-mesh" aria-hidden="true">
          <span className="u2-mesh-blob u2-mesh-blob-a" />
          <span className="u2-mesh-blob u2-mesh-blob-b" />
          <span className="u2-mesh-blob u2-mesh-blob-c" />
        </div>
        <div className="relative z-[1] px-4 sm:px-8 pt-8 pb-16 text-center max-w-2xl mx-auto">
          <span className="u2-badge inline-flex px-3 py-1.5 text-xs font-bold mb-4">🍔 Feito na hora, todo dia</span>
          <h1 className="u2-oncanvas text-3xl sm:text-4xl font-black leading-tight mb-3">
            Fome? <span className="u2-gradient-text">A gente entrega</span> em minutos
          </h1>
          <p className="u2-oncanvas-dim mb-7">Lanches, bebidas e sobremesas feitos com carinho. Peça pelo site ou chama a gente no WhatsApp.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
            <button onClick={() => navigate('/catalogo')} className="u2-btn-primary px-6 py-3 flex items-center justify-center gap-2">
              <ShoppingBag className="w-4 h-4" /> Ver catálogo
            </button>
            <button onClick={() => (customerAuth.token ? navigate('/consultar') : setShowAuthModal(true))} className="u2-btn-secondary px-6 py-3 flex items-center justify-center gap-2">
              Acompanhar entrega
            </button>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 text-left mb-8">
            {DESTAQUES.map((d) => (
              <div key={d.title} className="u2-card p-4 flex items-center gap-3">
                <span className="u2-badge w-10 h-10 flex items-center justify-center shrink-0 !rounded-xl">
                  <d.icon className="w-4 h-4" />
                </span>
                <div>
                  <p className="font-bold text-sm">{d.title}</p>
                  <p className="text-xs u2-dim">{d.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 text-sm u2-oncanvas-dim">
            <a
              href="https://www.google.com/maps/search/?api=1&query=Avenida+Central,+500+-+Centro,+João+Pessoa+-+PB"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 hover:opacity-80 transition-opacity"
            >
              <MapPin className="w-4 h-4 shrink-0" /> Avenida Central, 500 - Centro, João Pessoa - PB
            </a>
            <p className="flex items-center justify-center gap-1.5">
              <Clock className="w-4 h-4 shrink-0" /> Todos os dias, 18h às 23h
            </p>
            <a href="#" className="u2-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 mx-auto mt-1">
              <MessageCircle className="w-4 h-4" /> Falar no WhatsApp
            </a>
          </div>
        </div>
      </div>

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false)
            navigate('/consultar')
          }}
        />
      )}
    </Shell>
  )
}
