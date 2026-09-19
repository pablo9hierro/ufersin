import clsx from 'clsx'
import { brandName, isDemoModeActive } from '../../lib/demoMode'
import DemoBrandMark from './DemoBrandMark'
import { useTenantConfig } from '../../hooks/useTenantConfig'

const SIZES = {
  sm: 'h-16',
  md: 'h-24',
  lg: 'h-40',
}

/** Logo Resolutoo: nome da loja, ou "Resolutoo" como último fallback --
 * nunca um ícone genérico (sempre texto). */
export default function Logo({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  const tenantConfig = useTenantConfig()
  if (isDemoModeActive()) {
    return <DemoBrandMark className={clsx('w-auto', SIZES[size], className)} />
  }
  const name = brandName(tenantConfig?.loja_nome)
  const label = name && name !== 'Minha loja' ? name : 'Resolutoo'
  return (
    <span
      className={clsx(
        'inline-flex items-center font-black tracking-tight text-white truncate max-w-[10rem]',
        size === 'sm' ? 'text-base' : size === 'md' ? 'text-xl' : 'text-3xl',
        className
      )}
    >
      {label}
    </span>
  )
}
