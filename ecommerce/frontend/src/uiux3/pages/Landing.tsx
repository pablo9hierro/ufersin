import { useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { MapPin, ShoppingBag, Wrench } from 'lucide-react'
import { useStoreStatus } from '../../hooks/useStoreStatus'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { tenantFullAddress, tenantMapsHref, tenantShareLinks } from '../../lib/tenantConfig'
import { closedStoreMessage, getStoreOpenState } from '../../lib/storeHours'
import { useCustomerAuth } from '../../store/customerAuth'
import { brandName, isEssentialStorefront } from '../../lib/demoMode'
import Shell from '../components/Shell'
import AuthModal from '../components/AuthModal'
import PromoCarousel from '../components/PromoCarousel'
import EssentialHeroCard from '../../components/landing/EssentialHeroCard'
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
  const defaultSub =
    tenantConfig?.vertical === 'eletronicos'
      ? 'Reparo e manutenção de celulares e eletrônicos, com peça e garantia. Peça pelo site ou chama a gente no WhatsApp.'
      : 'Lanches, bebidas e sobremesas feitos com carinho. Peça pelo site ou chama a gente no WhatsApp.'
  const headline = tenantConfig?.landing_headline?.trim() || name
  const sub = tenantConfig?.landing_sub?.trim() || defaultSub
  const essential = isEssentialStorefront(tenantConfig?.plano)

  return (
    <Shell>
      {closed && (
        <div className="bg-zinc-700/80 text-zinc-100 text-sm text-center px-4 py-3 font-semibold tracking-wide">
          {closedMsg}
        </div>
      )}
      <div className={closed ? 'grayscale opacity-80' : undefined}>
        {essential ? (
          <EssentialHeroCard
            imageUrl={tenantConfig?.landing_hero_image_url}
            variant="u3"
            alt={tenantConfig?.landing_badge?.trim() || name}
          />
        ) : (
          <PromoCarousel />
        )}

        <div className="u3-onboard-photo px-4 sm:px-8 pt-8 pb-10 text-center">
          <p
            data-cms-editable="badge"
            data-cms-default=""
            className="text-xs font-bold uppercase tracking-wide mb-2 empty:mb-0 empty:h-0"
            style={{ color: 'var(--u3-orange)' }}
          >
            {tenantConfig?.landing_badge?.trim() ?? ''}
          </p>
          <p data-cms-editable="headline" data-cms-default={name} className="u3-wordmark text-3xl sm:text-4xl mb-2">
            {headline}
          </p>
          <p data-cms-editable="sub" data-cms-default={defaultSub} className="u3-dim mb-7 max-w-sm mx-auto">
            {sub}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-sm sm:max-w-none mx-auto">
            <button onClick={() => navigate('/catalogo')} className="u3-pill-primary px-6 py-3 flex items-center justify-center gap-2">
              <ShoppingBag className="w-4 h-4" />{' '}
              <span data-cms-editable="text:btn-produtos" data-cms-label="Botão — Ver produtos" data-cms-default="Ver produtos">
                {tenantConfig?.landing_texts?.['btn-produtos']?.trim() || 'Ver produtos'}
              </span>
            </button>
            {tenantConfig?.oferece_servicos && (
              <button onClick={() => navigate('/servicos')} className="u3-pill-secondary px-6 py-3 flex items-center justify-center gap-2">
                <Wrench className="w-4 h-4" />{' '}
                <span data-cms-editable="text:btn-servicos" data-cms-label="Botão — Ver serviços" data-cms-default="Ver serviços">
                  {tenantConfig?.landing_texts?.['btn-servicos']?.trim() || 'Ver serviços'}
                </span>
              </button>
            )}
            <button onClick={() => (customerAuth.token ? navigate('/consultar') : setShowAuthModal(true))} className="u3-pill-secondary px-6 py-3 flex items-center justify-center gap-2">
              <span data-cms-editable="text:btn-acompanhar" data-cms-label="Botão — Acompanhar entrega" data-cms-default="Acompanhar entrega">
                {tenantConfig?.landing_texts?.['btn-acompanhar']?.trim() || 'Acompanhar entrega'}
              </span>
            </button>
          </div>
        </div>

        <div className="px-4 sm:px-8 pb-16 max-w-xl mx-auto">
          <p
            data-cms-editable="text:secao-destaques-titulo"
            data-cms-label="Título — Por que pedir com a gente"
            data-cms-default="Por que pedir com a gente"
            className="font-black text-sm uppercase tracking-wide u3-dim mb-3"
          >
            {tenantConfig?.landing_texts?.['secao-destaques-titulo']?.trim() || 'Por que pedir com a gente'}
          </p>
          <div className="grid sm:grid-cols-3 gap-3 mb-8">
            {[
              { title: 'Entrega rápida', desc: 'Pronto em até 20 min' },
              { title: 'Pague com Pix', desc: 'Aprovação na hora' },
              { title: 'Feito na hora', desc: 'Sempre fresquinho' },
            ].map((defaults, i) => {
              const h = tenantConfig?.landing_highlights?.[i]
              const title = h?.title?.trim() || defaults.title
              const desc = h?.desc?.trim() || defaults.desc
              return (
                <div key={i} className="rounded-3xl p-4 text-left" style={{ background: 'var(--u3-surface)' }}>
                  <p data-cms-editable={`highlight:${i}:title`} data-cms-default={defaults.title} className="font-bold text-sm mb-0.5">
                    {title}
                  </p>
                  <p data-cms-editable={`highlight:${i}:desc`} data-cms-default={defaults.desc} className="text-xs u3-dim">
                    {desc}
                  </p>
                </div>
              )
            })}
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
