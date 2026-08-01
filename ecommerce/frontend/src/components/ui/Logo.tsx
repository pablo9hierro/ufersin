import clsx from 'clsx'
import logoSrc from '../../assets/logo.png'
import { isDemoModeActive } from '../../lib/demoMode'
import UfersinMark from './UfersinMark'

const SIZES = {
  sm: 'h-16',
  md: 'h-24',
  lg: 'h-40',
}

/** Logo do motor: demo → Ufersin; fora → marca Sunset (padrão
 *  dev→demo→produção). Nome da loja do assinante vai no texto
 *  (brandName / AdminLayout), não substitui o shell Sunset. */
export default function Logo({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  if (isDemoModeActive()) {
    return <UfersinMark className={clsx('w-auto text-son-pink', SIZES[size], className)} />
  }
  return (
    <img
      src={logoSrc}
      alt="Sunset"
      className={clsx('w-auto object-contain drop-shadow-[0_0_16px_rgba(242,193,78,0.35)]', SIZES[size], className)}
    />
  )
}
