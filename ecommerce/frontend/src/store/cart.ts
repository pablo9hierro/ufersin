import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Product } from '../types'

export type CartItem = { productId: string; quantity: number }

interface CartState {
  items: CartItem[]
  /** Loja dona dos `items` atuais — carrinho é global no localStorage
   * (`sonset_cart`), mas cada loja tem seu próprio catálogo. Sem isso,
   * testar/visitar loja B com item de loja A ainda no carrinho mostrava
   * contagem "fantasma" no badge (item nunca casa com o catálogo atual,
   * então a sacola renderiza vazia mesmo com o número > 0 no ícone). */
  tenantSlug: string | null
  addItem: (product: Product) => void
  changeQty: (productId: string, delta: number, max?: number) => void
  removeItem: (productId: string) => void
  clear: () => void
  /** Chamado ao montar a loja (App.tsx) — zera o carrinho se for de uma
   * loja diferente da última vez que essa aba/navegador usou. */
  syncTenant: (slug: string) => void
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      tenantSlug: null,
      syncTenant: (slug) => {
        const current = get().tenantSlug
        if (!slug || current === slug) return
        set({ items: [], tenantSlug: slug })
      },
      addItem: (product) =>
        set((state) => {
          const existing = state.items.find((i) => i.productId === product.id)
          if (existing) {
            if (existing.quantity >= product.quantity) return state
            return {
              items: state.items.map((i) =>
                i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
              ),
            }
          }
          return { items: [...state.items, { productId: product.id, quantity: 1 }] }
        }),
      changeQty: (productId, delta, max) =>
        set((state) => ({
          items: state.items
            .map((i) => {
              if (i.productId !== productId) return i
              const upper = max ?? Infinity
              const next = Math.min(upper, Math.max(0, i.quantity + delta))
              return { ...i, quantity: next }
            })
            .filter((i) => i.quantity > 0),
        })),
      removeItem: (productId) =>
        set((state) => ({ items: state.items.filter((i) => i.productId !== productId) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'sonset_cart' }
  )
)
