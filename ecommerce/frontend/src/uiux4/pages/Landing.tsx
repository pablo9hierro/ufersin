import { useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { MapPin } from 'lucide-react'
import { useStoreStatus } from '../../hooks/useStoreStatus'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { tenantFullAddress, tenantMapsHref, tenantShareLinks } from '../../lib/tenantConfig'
import { getStoreOpenState } from '../../lib/storeHours'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import AuthModal from '../components/AuthModal'
import PromoCarousel from '../components/PromoCarousel'
import StoreHoursToggle from '../../components/landing/StoreHoursToggle'
import ShareButton from '../../components/landing/ShareButton'

// Hero em tipografia CONDENSADA gigante (igual à referência: "BURGER" em
// caixa alta enorme + selo de preço/eyebrow pequeno + link de ação
// simples) -- bem diferente do hero centralizado do Ufersin nativo e do
// hero radial-com-wordmark do BurgerBite.
export default function Uiux4Landing() {
  const navigate = useNavigate()
  const customerAuth = useCustomerAuth()
  const { data: storeStatus } = useStoreStatus()
  const tenantConfig = useTenantConfig()
  const [showAuthModal, setShowAuthModal] = useState(false)

  const openState = storeStatus ? getStoreOpenState(storeStatus) : null
  const closed = !!openState && !openState.open

  return (
    <Shell>
      {closed && <div className="bg-red-500/10 text-red-400 text-sm text-center px-4 py-3">Loja fechada no momento. {openState?.reason || 'Volte mais tarde!'}</div>}

      <div className="px-4 sm:px-8 pt-8 pb-10">
        <span className="u4-tag inline-block px-2.5 py-1 text-xs mb-4">Feito na hora, todo dia</span>
        <h1 className="u4-display text-5xl sm:text-7xl mb-2">
          Fome
          <br />
          <span className="u4-display-accent">agora</span>
        </h1>
        <p className="u4-dim max-w-xs mb-6 text-sm">Lanches, bebidas e sobremesas prontos em minutos. Peça pelo site ou chama a gente no WhatsApp.</p>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/catalogo')} className="u4-btn-primary px-6 py-3 text-sm">
            Ver cardápio
          </button>
          <button onClick={() => (customerAuth.token ? navigate('/consultar') : setShowAuthModal(true))} className="u4-btn-secondary px-6 py-3 text-sm">
            Acompanhar entrega
          </button>
        </div>
      </div>

      <PromoCarousel />

      <div className="px-4 sm:px-8 py-10 max-w-xl mx-auto">
        <div className="grid sm:grid-cols-3 gap-3 mb-8">
          {[
            { title: 'Entrega rápida', desc: 'Pronto em até 20 min' },
            { title: 'Pague com Pix', desc: 'Aprovação na hora' },
            { title: 'Sempre fresco', desc: 'Feito na hora do pedido' },
          ].map((d) => (
            <div key={d.title} className="u4-panel p-4">
              <p className="font-bold text-sm mb-0.5">{d.title}</p>
              <p className="text-xs u4-dim">{d.desc}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 text-sm u4-dim">
          {tenantMapsHref(tenantConfig) && (
            <a href={tenantMapsHref(tenantConfig)!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
              <MapPin className="w-4 h-4 shrink-0" /> {tenantFullAddress(tenantConfig)}
            </a>
          )}
          <StoreHoursToggle hours={storeStatus?.hours} variant="u4" />
          <ShareButton links={tenantShareLinks(tenantConfig)} variant="u4" />
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
