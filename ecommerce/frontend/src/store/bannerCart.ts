import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type BannerCartItem = { productId: string; quantity: number }

// Carrinho separado do carrinho normal do catálogo — só existe pra
// promoção "selfie service" em /banner. Checkout de banner só aceita o
// que vier daqui, nunca do carrinho do site.
interface BannerCartState {
  promotionId: string | null
  items: BannerCartItem[]
  setPromotion: (promotionId: string, items: BannerCartItem[]) => void
  addItem: (productId: string, max?: number) => void
  changeQty: (productId: string, delta: number, max?: number) => void
  clear: () => void
}

export const useBannerCart = create<BannerCartState>()(
  persist(
    (set) => ({
      promotionId: null,
      items: [],
      // Kit: carrinho vem pronto (todo o pacote, quantidade 1 cada) e não
      // pode ser editado pelo cliente. Selfie service: começa vazio.
      setPromotion: (promotionId, items) => set({ promotionId, items }),
      addItem: (productId, max) =>
        set((state) => {
          const existing = state.items.find((i) => i.productId === productId)
          if (existing) {
            if (max != null && existing.quantity >= max) return state
            return { items: state.items.map((i) => (i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i)) }
          }
          return { items: [...state.items, { productId, quantity: 1 }] }
        }),
      changeQty: (productId, delta, max) =>
        set((state) => ({
          items: state.items
            .map((i) => {
              if (i.productId !== productId) return i
              const upper = max ?? Infinity
              return { ...i, quantity: Math.min(upper, Math.max(0, i.quantity + delta)) }
            })
            .filter((i) => i.quantity > 0),
        })),
      clear: () => set({ promotionId: null, items: [] }),
    }),
    { name: 'sonset_banner_cart' }
  )
)
