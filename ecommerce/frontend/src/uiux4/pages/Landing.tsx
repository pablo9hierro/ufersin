import { useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { MapPin } from 'lucide-react'
import { useStoreStatus } from '../../hooks/useStoreStatus'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { tenantFullAddress, tenantMapsHref, tenantShareLinks } from '../../lib/tenantConfig'
import { closedStoreMessage, getStoreOpenState } from '../../lib/storeHours'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import AuthModal from '../components/AuthModal'
import PromoCarousel from '../components/PromoCarousel'
import EssentialHeroCard from '../../components/landing/EssentialHeroCard'
import StoreHoursToggle from '../../components/landing/StoreHoursToggle'
import ShareButton from '../../components/landing/ShareButton'
import { isEssentialStorefront } from '../../lib/demoMode'

export default function Uiux4Landing() {
  const navigate = useNavigate()
  const customerAuth = useCustomerAuth()
  const { data: storeStatus } = useStoreStatus()
  const tenantConfig = useTenantConfig()
  const [showAuthModal, setShowAuthModal] = useState(false)

  const openState = storeStatus ? getStoreOpenState(storeStatus) : null
  const closed = !!openState && !openState.open
  const closedMsg = storeStatus && closed ? closedStoreMessage(storeStatus) : ''
  const isEletronicos = tenantConfig?.vertical === 'eletronicos'
  const badge = tenantConfig?.landing_badge?.trim() || (isEletronicos ? 'Assistência técnica de confiança' : 'Feito na hora, todo dia')
  const headline = tenantConfig?.landing_headline?.trim() || (isEletronicos ? 'Conserto\nrápido' : 'Fome\nagora')
  const sub =
    tenantConfig?.landing_sub?.trim() ||
    (isEletronicos
      ? 'Reparo e manutenção de celulares e eletrônicos, com peça e garantia. Peça pelo site ou chama a gente no WhatsApp.'
      : 'Lanches, bebidas e sobremesas prontos em minutos. Peça pelo site ou chama a gente no WhatsApp.')
  const headlineLines = headline.split(/\n|\\n/)
  const essential = isEssentialStorefront(tenantConfig?.plano)

  return (
    <Shell>
      {closed && (
        <div className="bg-zinc-700/80 text-zinc-100 text-sm text-center px-4 py-3 font-semibold tracking-wide">
          {closedMsg}
        </div>
      )}

      <div className={closed ? 'grayscale opacity-80' : undefined}>
        {essential && (
          <EssentialHeroCard imageUrl={tenantConfig?.landing_hero_image_url} variant="u4" alt={badge} />
        )}
        <div className="px-4 sm:px-8 pt-8 pb-10">
          <span className="u4-tag inline-block px-2.5 py-1 text-xs mb-4">{badge}</span>
          <h1 className="u4-display text-5xl sm:text-7xl mb-2">
            {headlineLines.length > 1 ? (
              <>
                {headlineLines[0]}
                <br />
                <span className="u4-display-accent">{headlineLines.slice(1).join(' ')}</span>
              </>
            ) : (
              headline
            )}
          </h1>
          <p className="u4-dim max-w-xs mb-6 text-sm">{sub}</p>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/catalogo')} className="u4-btn-primary px-6 py-3 text-sm">
              Ver produtos
            </button>
            <button onClick={() => navigate('/servicos')} className="u4-btn-secondary px-6 py-3 text-sm">
              Ver serviços
            </button>
            <button onClick={() => (customerAuth.token ? navigate('/consultar') : setShowAuthModal(true))} className="u4-btn-secondary px-6 py-3 text-sm">
              Acompanhar entrega
            </button>
          </div>
        </div>

        {!essential && <PromoCarousel />}

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

          <div className="flex flex-wrap items-center justify-center gap-2.5 text-sm u4-dim">
            {tenantMapsHref(tenantConfig) && (
              <a
                href={tenantMapsHref(tenantConfig)!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-white/15 hover:border-white/30 hover:bg-white/5 transition-colors"
              >
                <MapPin className="w-4 h-4 shrink-0" /> {tenantFullAddress(tenantConfig)}
              </a>
            )}
            <StoreHoursToggle hours={storeStatus?.hours} variant="u4" />
            <ShareButton links={tenantShareLinks(tenantConfig)} variant="u4" />
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
