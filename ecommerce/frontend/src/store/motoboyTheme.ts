import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'dark' | 'light'

interface MotoboyThemeState {
  theme: Theme
  toggle: () => void
}

export const useMotoboyTheme = create<MotoboyThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      toggle: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
    }),
    { name: 'sonset_motoboy_theme' }
  )
)
