import clsx from 'clsx'
import { brandName, isDemoModeActive } from '../../lib/demoMode'
import UfersinMark from './UfersinMark'
import { useTenantConfig } from '../../hooks/useTenantConfig'

const SIZES = {
  sm: 'h-16',
  md: 'h-24',
  lg: 'h-40',
}

/** Logo Resolutoo: Ufersin (1º estilo) ou nome da loja. Sem Sunset. */
export default function Logo({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  const tenantConfig = useTenantConfig()
  if (isDemoModeActive()) {
    return <UfersinMark className={clsx('w-auto text-son-pink', SIZES[size], className)} />
  }
  const name = brandName(tenantConfig?.loja_nome)
  if (name && name !== 'Minha loja') {
    return (
      <span
        className={clsx(
          'inline-flex items-center font-black tracking-tight text-white truncate max-w-[10rem]',
          size === 'sm' ? 'text-base' : size === 'md' ? 'text-xl' : 'text-3xl',
          className
        )}
      >
        {name}
      </span>
    )
  }
  return <UfersinMark className={clsx('w-auto text-son-pink', SIZES[size], className)} />
}
