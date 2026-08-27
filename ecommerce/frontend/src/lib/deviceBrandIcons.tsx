import type { ComponentType } from 'react'
import { Laptop, Monitor, Smartphone, Tablet } from 'lucide-react'
import {
  SiApple,
  SiAsus,
  SiDell,
  SiGoogle,
  SiHp,
  SiHuawei,
  SiLenovo,
  SiLg,
  SiMotorola,
  SiOneplus,
  SiSamsung,
  SiSony,
  SiXiaomi,
} from 'react-icons/si'

// Ícone por tipo de aparelho (device_types.slug) -- mesmo mapeamento usado
// em EletronicaServiceRequestForm.tsx (DEVICE_TYPES), centralizado aqui
// pra reuso no form de "Nova solicitação" do admin.
export const DEVICE_TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  celular: Smartphone,
  tablet: Tablet,
  notebook: Laptop,
  computador: Monitor,
}

export function DeviceTypeIcon({ slug, className }: { slug: string; className?: string }) {
  const Icon = DEVICE_TYPE_ICONS[slug] ?? Smartphone
  return <Icon className={className} />
}

// Ícone por marca -- cobre as marcas mais comuns de celular/tablet/
// notebook/computador via Simple Icons (react-icons/si). Marca fora dessa
// lista (ou nome digitado livre pelo lojista) cai no fallback genérico
// (ícone de aparelho + inicial), não trava o cadastro.
const BRAND_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  apple: SiApple,
  iphone: SiApple,
  ipad: SiApple,
  macbook: SiApple,
  samsung: SiSamsung,
  motorola: SiMotorola,
  moto: SiMotorola,
  xiaomi: SiXiaomi,
  redmi: SiXiaomi,
  poco: SiXiaomi,
  google: SiGoogle,
  pixel: SiGoogle,
  lg: SiLg,
  sony: SiSony,
  huawei: SiHuawei,
  oneplus: SiOneplus,
  asus: SiAsus,
  dell: SiDell,
  hp: SiHp,
  lenovo: SiLenovo,
}

function normalizeBrandKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function resolveBrandIcon(name: string): ComponentType<{ className?: string }> | null {
  const key = normalizeBrandKey(name)
  if (BRAND_ICONS[key]) return BRAND_ICONS[key]
  const hit = Object.keys(BRAND_ICONS).find((k) => key.includes(k))
  return hit ? BRAND_ICONS[hit] : null
}

/** Ícone da marca (Simple Icons) com fallback pra inicial do nome quando a
 * marca não está no catálogo conhecido -- nunca deixa o card vazio. */
export function BrandIcon({ name, className }: { name: string; className?: string }) {
  const Icon = resolveBrandIcon(name)
  if (Icon) return <Icon className={className} />
  return <span className={`${className ?? ''} font-black flex items-center justify-center`}>{name.trim().charAt(0).toUpperCase() || '?'}</span>
}
