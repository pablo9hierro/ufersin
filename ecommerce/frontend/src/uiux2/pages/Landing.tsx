import { useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { MapPin, ShoppingBag, Star, Truck, Wallet, Wrench } from 'lucide-react'
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

// Os 3 temas de layout hoje (ufersin/burgerbite/burgerhouse) nasceram pra
// food-delivery — sem tema dedicado pro ramo eletrônicos ainda, então o
// copy padrão (usado só quando o lojista não personalizou landing_*) tem
// que pelo menos não falar de comida numa loja de assistência técnica.
const DESTAQUES_ECOMMERCE = [
  { icon: Truck, title: 'Entrega rápida', desc: 'Pedido pronto em até 20 minutos' },
  { icon: Wallet, title: 'Pague com Pix', desc: 'Aprovação na hora, sem complicação' },
  { icon: Star, title: '4,9 de avaliação', desc: 'O point mais pedido da cidade' },
]
const DESTAQUES_ELETRONICOS = [
  { icon: Wrench, title: 'Assistência rápida', desc: 'Diagnóstico e orçamento na hora' },
  { icon: Wallet, title: 'Pague com Pix', desc: 'Aprovação na hora, sem complicação' },
  { icon: Star, title: '4,9 de avaliação', desc: 'Confiança de quem já foi atendido' },
]

export default function Uiux2Landing() {
  const navigate = useNavigate()
  const customerAuth = useCustomerAuth()
  const { data: storeStatus } = useStoreStatus()
  const tenantConfig = useTenantConfig()
  const [showAuthModal, setShowAuthModal] = useState(false)

  const openState = storeStatus ? getStoreOpenState(storeStatus) : null
  const closed = !!openState && !openState.open
  const closedMsg = storeStatus && closed ? closedStoreMessage(storeStatus) : ''
  const isEletronicos = tenantConfig?.vertical === 'eletronicos'
  const defaultBadge = isEletronicos ? 'Assistência técnica de confiança' : 'Feito na hora, todo dia'
  const defaultHeadline = isEletronicos ? 'Seu aparelho no melhor cuidado' : 'Fome? A gente entrega em minutos'
  const defaultSub = isEletronicos
    ? 'Reparo e manutenção de celulares e eletrônicos, com peça e garantia. Peça pelo site ou chama a gente no WhatsApp.'
    : 'Lanches, bebidas e sobremesas feitos com carinho. Peça pelo site ou chama a gente no WhatsApp.'
  const badge = tenantConfig?.landing_badge?.trim() || defaultBadge
  const headline = tenantConfig?.landing_headline?.trim() || defaultHeadline
  const sub = tenantConfig?.landing_sub?.trim() || defaultSub
  const DESTAQUES = isEletronicos ? DESTAQUES_ELETRONICOS : DESTAQUES_ECOMMERCE
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
          <EssentialHeroCard imageUrl={tenantConfig?.landing_hero_image_url} variant="u2" alt={badge} />
        ) : (
          <PromoCarousel />
        )}
        <div className="relative overflow-hidden">
          <div className="u2-mesh" aria-hidden="true">
            <span className="u2-mesh-blob u2-mesh-blob-a" />
            <span className="u2-mesh-blob u2-mesh-blob-b" />
            <span className="u2-mesh-blob u2-mesh-blob-c" />
          </div>
          <div className="relative z-[1] px-4 sm:px-8 pt-8 pb-16 text-center max-w-2xl mx-auto">
            <span
              data-cms-editable="badge"
              data-cms-default={defaultBadge}
              className="u2-badge inline-flex px-3 py-1.5 text-xs font-bold mb-4"
            >
              {badge}
            </span>
            <h1
              data-cms-editable="headline"
              data-cms-default={defaultHeadline}
              className="u2-oncanvas text-3xl sm:text-4xl font-black leading-tight mb-3"
            >
              {headline.includes('A gente entrega') ? (
                <>
                  {headline.split('A gente entrega')[0]}
                  <span className="u2-gradient-text">A gente entrega</span>
                  {headline.split('A gente entrega')[1] ?? ''}
                </>
              ) : (
                headline
              )}
            </h1>
            <p data-cms-editable="sub" data-cms-default={defaultSub} className="u2-oncanvas-dim mb-7">
              {sub}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
              <button onClick={() => navigate('/catalogo')} className="u2-btn-primary px-6 py-3 flex items-center justify-center gap-2">
                <ShoppingBag className="w-4 h-4" /> Ver catálogo
              </button>
              <button onClick={() => navigate('/servicos')} className="u2-btn-secondary px-6 py-3 flex items-center justify-center gap-2">
                <Wrench className="w-4 h-4" /> Ver serviços
              </button>
              <button onClick={() => (customerAuth.token ? navigate('/consultar') : setShowAuthModal(true))} className="u2-btn-secondary px-6 py-3 flex items-center justify-center gap-2">
                Acompanhar entrega
              </button>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 text-left mb-8">
              {DESTAQUES.map((d, i) => {
                const h = tenantConfig?.landing_highlights?.[i]
                const title = h?.title?.trim() || d.title
                const desc = h?.desc?.trim() || d.desc
                return (
                  <div key={i} className="u2-card p-4 flex items-center gap-3">
                    <span className="u2-badge w-10 h-10 flex items-center justify-center shrink-0 !rounded-xl">
                      <d.icon className="w-4 h-4" />
                    </span>
                    <div>
                      <p data-cms-editable={`highlight:${i}:title`} data-cms-default={d.title} className="font-bold text-sm">
                        {title}
                      </p>
                      <p data-cms-editable={`highlight:${i}:desc`} data-cms-default={d.desc} className="text-xs u2-dim">
                        {desc}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-col gap-3 text-sm u2-oncanvas-dim">
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
              <StoreHoursToggle hours={storeStatus?.hours} variant="u2" />
              <ShareButton links={tenantShareLinks(tenantConfig)} variant="u2" />
            </div>
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
