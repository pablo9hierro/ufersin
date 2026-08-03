import { useEffect, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { Link } from '../lib/tenantRouter'
import { useCart } from '../store/cart'
import { useTenantConfig } from '../hooks/useTenantConfig'
import { pageDecorationService } from '../services/pageDecorationService'
import type { PageDecorationElement } from '../types'
import SunsetCartIcon from './SunsetCartIcon'
import SmokeDecor from './decor/SmokeDecor'
import FireDecor from './decor/FireDecor'

// Fumaça/fogo ao redor do ícone (cart_icon), editados em /admin/layout-cliente.
// Estilo (sacola vs #cart-icon) e animação vêm do tenant_config (/meu-plano/layout).
export default function CartFab() {
  const count = useCart((s) => s.items.reduce((sum, i) => sum + i.quantity, 0))
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
    <div className="fixed bottom-20 sm:bottom-6 right-6 z-40 w-16 h-16">
      {style === 'cart_icon' && (
        <div className="sunset-carticon-decor-wrap" aria-hidden="true">
          {elements.map((el) => (el.type === 'smoke' ? <SmokeDecor key={el.id} el={el} /> : <FireDecor key={el.id} el={el} />))}
        </div>
      )}
      <Link
        to="/carrinho"
        className={`absolute inset-0 flex items-center justify-center ${animate ? 'animate-bounce' : ''}`}
        aria-label="Ir para o carrinho"
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
      </Link>
    </div>
  )
}
