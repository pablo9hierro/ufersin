import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2, Minus, Package, Plus, ShoppingBag } from 'lucide-react'
import { motion } from 'framer-motion'
import SiteHeader from '../components/layout/SiteHeader'
import { api } from '../lib/api'
import type { Product } from '../lib/types'
import { useCart } from '../store/cart'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

export default function ProdutoDetalhe() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const { items, addItem, changeQty } = useCart()

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api.products
      .get(id)
      .then(setProduct)
      .catch(() => setProduct(null))
      .finally(() => setLoading(false))
  }, [id])

  const qty = items.find((i) => i.productId === id)?.quantity ?? 0

  if (loading) {
    return (
      <main className="min-h-screen text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
      </main>
    )
  }

  if (!product) {
    return (
      <main className="min-h-screen text-white">
        <SiteHeader />
        <div className="text-center py-24 text-son-silver-dim">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Produto não encontrado.</p>
          <Link to="/catalogo" className="btn-secondary mt-6 inline-flex">
            Voltar ao catálogo
          </Link>
        </div>
      </main>
    )
  }

  const outOfStock = product.quantity <= 0

  return (
    <main className="min-h-screen text-white">
      <SiteHeader />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-3xl mx-auto px-5 sm:px-10 pb-20"
      >
        <div className="aspect-square sm:aspect-video bg-son-surface border border-white/5 rounded-2xl flex items-center justify-center overflow-hidden mb-6">
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <Package className="w-16 h-16 text-son-silver-dim/30" />
          )}
        </div>

        {product.category_name && <p className="text-xs font-semibold text-son-gold uppercase tracking-wide mb-1">{product.category_name}</p>}
        <h1 className="text-2xl sm:text-3xl font-black">{product.name}</h1>
        <p className="sunset-text text-2xl font-bold mt-2">{currency(product.price)}</p>
        {product.description && <p className="text-son-silver mt-4 leading-relaxed">{product.description}</p>}
        {outOfStock && <p className="text-xs text-son-silver-dim mt-2">Sem estoque no momento</p>}

        <div className="mt-8 flex items-center gap-4">
          {outOfStock ? (
            <span className="text-sm font-semibold text-son-silver-dim">Esgotado</span>
          ) : qty > 0 ? (
            <div className="flex items-center gap-3 bg-son-surface border border-white/10 rounded-2xl px-3 py-2">
              <button onClick={() => changeQty(product.id, -1)} className="w-8 h-8 flex items-center justify-center text-son-pink">
                <Minus className="w-4 h-4" />
              </button>
              <span className="font-semibold w-6 text-center">{qty}</span>
              <button
                onClick={() => addItem(product)}
                disabled={qty >= product.quantity}
                className="w-8 h-8 flex items-center justify-center text-son-pink disabled:opacity-30"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={() => addItem(product)} className="btn-primary">
              <Plus className="w-4 h-4" />
              Adicionar à sacola
            </button>
          )}
          {qty > 0 && (
            <button onClick={() => navigate('/carrinho')} className="btn-secondary">
              <ShoppingBag className="w-4 h-4" />
              Ver sacola
            </button>
          )}
        </div>
      </motion.div>
    </main>
  )
}
