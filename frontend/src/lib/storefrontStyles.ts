export type StorefrontStyle = 'ufersin' | 'burgerbite' | 'burgerhouse'

export const STOREFRONT_STYLES: {
  key: StorefrontStyle
  label: string
  desc: string
  /** Cores do chrome de preview (fixas, não o site real). */
  preview: { bg: string; accent: string; accent2?: string; tile?: boolean }
}[] = [
  {
    key: 'ufersin',
    label: 'Ufersin',
    desc: 'Visual limpo e moderno',
    preview: { bg: '#06070d', accent: '#4d7cff', accent2: '#8b5cf6' },
  },
  {
    key: 'burgerbite',
    label: 'BurgerBite',
    desc: 'Vibrante, pílulas e destaque',
    preview: { bg: '#0e0d0d', accent: '#ff3d3d', accent2: '#ff8a00' },
  },
  {
    key: 'burgerhouse',
    label: 'Burger House',
    desc: 'Minimalista, grade de fotos',
    preview: { bg: '#050505', accent: '#ff7a1a', tile: true },
  },
]

export function isStorefrontStyle(v: string | null | undefined): v is StorefrontStyle {
  return v === 'ufersin' || v === 'burgerbite' || v === 'burgerhouse'
}
