import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Product } from '../lib/types'

export type CartItem = { productId: string; quantity: number }

interface CartState {
  items: CartItem[]
  addItem: (product: Product) => void
  changeQty: (productId: string, delta: number, max?: number) => void
  removeItem: (productId: string) => void
  clear: () => void
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
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
