import { create } from 'zustand'

interface CartDrawerState {
  open: boolean
  openDrawer: () => void
  closeDrawer: () => void
  toggleDrawer: () => void
}

export const useCartDrawer = create<CartDrawerState>((set) => ({
  open: false,
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
  toggleDrawer: () => set((s) => ({ open: !s.open })),
}))
