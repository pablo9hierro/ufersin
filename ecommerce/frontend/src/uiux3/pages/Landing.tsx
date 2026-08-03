import { useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { MapPin, ShoppingBag } from 'lucide-react'
import { useStoreStatus } from '../../hooks/useStoreStatus'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { tenantFullAddress, tenantMapsHref, tenantShareLinks } from '../../lib/tenantConfig'
import { closedStoreMessage, getStoreOpenState } from '../../lib/storeHours'
import { useCustomerAuth } from '../../store/customerAuth'
import { brandName } from '../../lib/demoMode'
import Shell from '../components/Shell'
import AuthModal from '../components/AuthModal'
import PromoCarousel from '../components/PromoCarousel'
import StoreHoursToggle from '../../components/landing/StoreHoursToggle'
import ShareButton from '../../components/landing/ShareButton'

export default function Uiux3Landing() {
  const navigate = useNavigate()
  const customerAuth = useCustomerAuth()
  const { data: storeStatus } = useStoreStatus()
  const tenantConfig = useTenantConfig()
  const name = brandName(tenantConfig?.loja_nome)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const openState = storeStatus ? getStoreOpenState(storeStatus) : null
  const closed = !!openState && !openState.open
  const closedMsg = storeStatus && closed ? closedStoreMessage(storeStatus) : ''
  const headline = tenantConfig?.landing_headline?.trim() || name
  const sub =
    tenantConfig?.landing_sub?.trim() ||
    'Lanches, bebidas e sobremesas feitos com carinho. Peça pelo site ou chama a gente no WhatsApp.'

  return (
    <Shell>
      {closed && (
        <div className="bg-zinc-700/80 text-zinc-100 text-sm text-center px-4 py-3 font-semibold tracking-wide">
          {closedMsg}
        </div>
      )}
      <div className={closed ? 'grayscale opacity-80' : undefined}>
        <PromoCarousel />

        <div className="u3-onboard-photo px-4 sm:px-8 pt-8 pb-10 text-center">
          {tenantConfig?.landing_badge?.trim() && (
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--u3-orange)' }}>
              {tenantConfig.landing_badge}
            </p>
          )}
          <p className="u3-wordmark text-3xl sm:text-4xl mb-2">{headline}</p>
          <p className="u3-dim mb-7 max-w-sm mx-auto">{sub}</p>
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
            {tenantMapsHref(tenantConfig) && (
              <a
                href={tenantMapsHref(tenantConfig)!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 hover:opacity-80 transition-opacity"
              >
                <MapPin className="w-4 h-4 shrink-0" /> {tenantFullAddress(tenantConfig)}
              </a>
            )}
            <StoreHoursToggle hours={storeStatus?.hours} variant="u3" />
            <ShareButton links={tenantShareLinks(tenantConfig)} variant="u3" />
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
