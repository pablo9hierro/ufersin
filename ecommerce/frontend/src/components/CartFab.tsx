import { useEffect, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { useLocation } from '../lib/tenantRouter'
import { useCart } from '../store/cart'
import { useCartDrawer } from '../store/cartDrawer'
import { useTenantConfig } from '../hooks/useTenantConfig'
import { pageDecorationService } from '../services/pageDecorationService'
import type { PageDecorationElement } from '../types'
import SunsetCartIcon from './SunsetCartIcon'
import SmokeDecor from './decor/SmokeDecor'
import FireDecor from './decor/FireDecor'
import CartDrawer from './CartDrawer'

// FAB flutuante do carrinho — canto inferior DIREITO, em todas as páginas
// de cliente exceto a Landing (`/`). Estilo (sacola vs #cart-icon) e
// animação vêm de tenant_config.cart_fab_* (/meu-plano/layout). Clique
// abre o CartDrawer (não navega pra /carrinho; a aba Finalizar vai pro
// /checkout). Sempre monta o drawer pra openDrawer de "Ver sacola" etc.
export default function CartFab() {
  const location = useLocation()
  const isLanding = location.pathname === '/'
  const count = useCart((s) => s.items.reduce((sum, i) => sum + i.quantity, 0))
  const openDrawer = useCartDrawer((s) => s.openDrawer)
  const tenantConfig = useTenantConfig()
  const style = tenantConfig?.cart_fab_style === 'cart_icon' ? 'cart_icon' : 'sacola'
  const animate = !!tenantConfig?.cart_fab_animate && style === 'cart_icon'
  const [elements, setElements] = useState<PageDecorationElement[]>([])

  useEffect(() => {
    if (style !== 'cart_icon') return
    pageDecorationService
      .list()
      .then((all) => setElements(all.find((d) => d.page_key === 'cart_icon')?.elements ?? []))
      .catch(() => {})
  }, [style])

  return (
    <>
      {!isLanding && (
        <div className="fixed bottom-20 sm:bottom-6 right-6 z-40 w-16 h-16">
          {style === 'cart_icon' && (
            <div className="sunset-carticon-decor-wrap" aria-hidden="true">
              {elements.map((el) =>
                el.type === 'smoke' ? <SmokeDecor key={el.id} el={el} /> : <FireDecor key={el.id} el={el} />,
              )}
            </div>
          )}
          <button
            type="button"
            onClick={openDrawer}
            className={`absolute inset-0 flex items-center justify-center ${animate ? 'animate-bounce' : ''}`}
            aria-label="Abrir sacola"
            id={style === 'cart_icon' ? undefined : 'cart-fab-sacola'}
          >
            {style === 'cart_icon' ? (
              <SunsetCartIcon scale={0.42} />
            ) : (
              <span className="w-14 h-14 rounded-full bg-black/80 border border-white/15 flex items-center justify-center shadow-lg shadow-black/40">
                <ShoppingBag className="w-6 h-6 text-white" />
              </span>
            )}
            {count > 0 && (
              <span className="absolute top-2 right-0 z-10 w-6 h-6 flex items-center justify-center text-xs font-bold sunset-bg text-white rounded-full shadow-md shadow-black/40">
                {count}
              </span>
            )}
          </button>
        </div>
      )}
      <CartDrawer />
    </>
  )
}
