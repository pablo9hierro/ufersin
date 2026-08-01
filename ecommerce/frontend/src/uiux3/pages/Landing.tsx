import { useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { Clock, MapPin, MessageCircle, ShoppingBag } from 'lucide-react'
import { useStoreStatus } from '../../hooks/useStoreStatus'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { tenantWhatsAppHref } from '../../lib/tenantConfig'
import { getStoreOpenState } from '../../lib/storeHours'
import { useCustomerAuth } from '../../store/customerAuth'
import { brandName } from '../../lib/demoMode'
import Shell from '../components/Shell'
import AuthModal from '../components/AuthModal'
import PromoCarousel from '../components/PromoCarousel'

// Home do estilo BurgerBite -- hero com fundo radial (mesma peça visual
// do AuthModal), wordmark grande em degradê, pílulas de ação em vez de
// botões retangulares, cartões de destaque em vez da grade uniforme do
// Ufersin nativo.
export default function Uiux3Landing() {
  const navigate = useNavigate()
  const customerAuth = useCustomerAuth()
  const { data: storeStatus } = useStoreStatus()
  const tenantConfig = useTenantConfig()
  const whatsappHref = tenantWhatsAppHref(tenantConfig)
  const name = brandName(tenantConfig?.loja_nome)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const openState = storeStatus ? getStoreOpenState(storeStatus) : null
  const closed = !!openState && !openState.open

  return (
    <Shell>
      {closed && <div className="bg-red-500/10 text-red-400 text-sm text-center px-4 py-3">Loja fechada no momento. {openState?.reason || 'Volte mais tarde!'}</div>}
      <PromoCarousel />

      <div className="u3-onboard-photo px-4 sm:px-8 pt-8 pb-10 text-center">
        <p className="u3-wordmark text-3xl sm:text-4xl mb-2">{name}</p>
        <p className="u3-dim mb-7 max-w-sm mx-auto">Lanches, bebidas e sobremesas feitos com carinho. Peça pelo site ou chama a gente no WhatsApp.</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-sm sm:max-w-none mx-auto">
          <button onClick={() => navigate('/catalogo')} className="u3-pill-primary px-6 py-3 flex items-center justify-center gap-2">
            <ShoppingBag className="w-4 h-4" /> Ver cardápio
          </button>
          <button onClick={() => (customerAuth.token ? navigate('/consultar') : setShowAuthModal(true))} className="u3-pill-secondary px-6 py-3 flex items-center justify-center gap-2">
            Acompanhar entrega
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-8 pb-16 max-w-xl mx-auto">
        <p className="font-black text-sm uppercase tracking-wide u3-dim mb-3">Por que pedir com a gente</p>
        <div className="grid sm:grid-cols-3 gap-3 mb-8">
          {[
            { title: 'Entrega rápida', desc: 'Pronto em até 20 min' },
            { title: 'Pague com Pix', desc: 'Aprovação na hora' },
            { title: 'Feito na hora', desc: 'Sempre fresquinho' },
          ].map((d) => (
            <div key={d.title} className="rounded-3xl p-4 text-left" style={{ background: 'var(--u3-surface)' }}>
              <p className="font-bold text-sm mb-0.5">{d.title}</p>
              <p className="text-xs u3-dim">{d.desc}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 text-sm u3-dim">
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
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="u3-pill-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 mx-auto mt-1"
            >
              <MessageCircle className="w-4 h-4" /> Falar no WhatsApp
            </a>
          )}
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
