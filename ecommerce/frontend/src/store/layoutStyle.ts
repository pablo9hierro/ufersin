import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 'ufersin' = componentes NATIVOS da Ufersin (pasta src/uiux2/) --
// visual limpo/moderno. 'burgerbite' = estilo BurgerBite (pasta
// src/uiux3/) -- onboarding radial, pílulas, catálogo em destaque+lista.
// 'burgerhouse' = estilo Burger House (pasta src/uiux4/) --
// monocromático + 1 acento, tipografia condensada, catálogo em grade de
// azulejos. Os 3 têm cor/base fixas por padrão (só o trio de acento
// reage à "cor da sua loja", ver store/tenantColor.ts). Cada pasta
// uiux2/3/4 tem seus PRÓPRIOS componentes/classes -- nenhuma compartilha
// estrutura com as outras, só a lógica de negócio (services/store/hooks).
// "Clone Sunset" existiu como 4ª opção e foi REMOVIDO do seletor (não
// tinha mais salvação de harmonização de cor) -- o front original do
// Sunset ainda existe no código (StyleAware em App.tsx cai nele fora do
// modo demonstração, é o site de produção de verdade), só não é mais
// selecionável aqui. Só tem efeito em modo demonstração.
export type LayoutStyle = 'ufersin' | 'burgerbite' | 'burgerhouse'

interface LayoutStyleState {
  style: LayoutStyle
  setStyle: (s: LayoutStyle) => void
}

export const useLayoutStyle = create<LayoutStyleState>()(
  persist(
    (set) => ({
      style: 'ufersin',
      setStyle: (style) => set({ style }),
    }),
    { name: 'rodoletas_demo_layout_style' }
  )
)
