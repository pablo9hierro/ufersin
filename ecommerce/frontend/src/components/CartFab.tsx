import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../store/cart'
import { api } from '../lib/api'
import type { PageDecorationElement } from '../lib/types'
import SunsetCartIcon from './SunsetCartIcon'
import SmokeDecor from './decor/SmokeDecor'
import FireDecor from './decor/FireDecor'

// Fumaça/fogo ao redor do ícone, editados globalmente em
// /admin/layout-cliente (aba "Ícone do carrinho") — decorativos, sem
// pointer-events, ficam fora do <Link> pra nunca interceptar/expandir a
// área clicável (o clique só funciona em cima do ícone de verdade).
export default function CartFab() {
  const count = useCart((s) => s.items.reduce((sum, i) => sum + i.quantity, 0))
  const [elements, setElements] = useState<PageDecorationElement[]>([])

  useEffect(() => {
    api.pageDecorations
      .list()
      .then((all) => setElements(all.find((d) => d.page_key === 'cart_icon')?.elements ?? []))
      .catch(() => {})
  }, [])

  return (
    <div className="fixed bottom-6 right-6 z-40 w-16 h-16">
      <div className="sunset-carticon-decor-wrap" aria-hidden="true">
        {elements.map((el) => (el.type === 'smoke' ? <SmokeDecor key={el.id} el={el} /> : <FireDecor key={el.id} el={el} />))}
      </div>
      <Link to="/carrinho" className="absolute inset-0 flex items-center justify-center" aria-label="Ir para o carrinho">
        <SunsetCartIcon scale={0.42} />
        {count > 0 && (
          <span className="absolute top-2 right-0 z-10 w-6 h-6 flex items-center justify-center text-xs font-bold sunset-bg text-white rounded-full shadow-md shadow-black/40">
            {count}
          </span>
        )}
      </Link>
    </div>
  )
}
