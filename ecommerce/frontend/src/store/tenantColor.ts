import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface TenantColorState {
  color1: string | null
  color2: string | null
  setColors: (color1: string, color2?: string | null) => void
  reset: () => void
}

// "Cor da sua loja" -- 1-2 cores escolhidas pelo lojista, usadas pra
// DERIVAR (nunca aplicar cru, ver lib/colorHarmony.ts) o trio de acento
// de QUALQUER estilo de layout ativo (Clone Sunset/Ufersin nativo/Burger
// House -- todos os 3 têm cor/base/textura fixas por padrão, só o trio de
// acento reage). null = sem override, cada estilo usa sua cor de marca
// fixa (padrão hardcoded) -- é o que "Restaurar padrão" restaura.
export const useTenantColor = create<TenantColorState>()(
  persist(
    (set) => ({
      color1: null,
      color2: null,
      setColors: (color1, color2 = null) => set({ color1, color2 }),
      reset: () => set({ color1: null, color2: null }),
    }),
    { name: 'rodoletas_demo_tenant_color' }
  )
)
