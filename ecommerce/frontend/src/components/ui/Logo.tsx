import clsx from 'clsx'
import { isDemoModeActive } from '../../lib/demoMode'
import UfersinMark from './UfersinMark'

const SIZES = {
  sm: 'h-16',
  md: 'h-24',
  lg: 'h-40',
}

export default function Logo({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  if (isDemoModeActive()) {
    return <UfersinMark className={clsx('w-auto text-son-pink', SIZES[size], className)} />
  }
  // Painel do assinante Resolutoo — nunca mostrar marca Sunset Tabas.
  return (
    <span
      className={clsx(
        'inline-flex items-center font-black tracking-tight text-white',
        size === 'sm' ? 'text-base' : size === 'md' ? 'text-xl' : 'text-3xl',
        className
      )}
    >
      Resolutoo
    </span>
  )
}
