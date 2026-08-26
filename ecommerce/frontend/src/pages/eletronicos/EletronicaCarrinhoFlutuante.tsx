import { Link } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { useCart } from '../../store/cart'
import { withTenantSearch } from '../../lib/tenantConfig'

// Port visual de src/components/CarrinhoFlutuante.tsx do vrtech (bolha
// vermelha flutuante, badge de contagem). O real abre um CarrinhoDrawer
// próprio (451 linhas, checkout embutido no drawer); esse motor não tem
// esse drawer -- aqui o botão navega pra /carrinho (real, funcional, já
// usa o checkout genérico do motor) em vez de abrir um drawer inline.
// Presente nas mesmas 3 páginas que o original (Home, Loja, CatalogoServico).

export default function EletronicaCarrinhoFlutuante() {
  const items = useCart((s) => s.items)
  const count = items.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <Link
      to={`/carrinho${withTenantSearch()}`}
      className="fixed bottom-6 right-6 z-30 w-14 h-14 bg-[#e0211a] rounded-full shadow-lg shadow-[#e0211a]/30 flex items-center justify-center hover:bg-[#a3140f] transition-colors"
      aria-label="Abrir sacola"
    >
      <ShoppingBag className="w-6 h-6 text-white" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-white text-[#e0211a] text-xs font-black rounded-full flex items-center justify-center leading-none">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  )
}
