import clsx from 'clsx'
import logoSrc from '../../assets/logo.png'

const SIZES = {
  sm: 'h-16',
  md: 'h-24',
  lg: 'h-40',
}

export default function Logo({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <img
      src={logoSrc}
      alt="Sunset Tabas"
      className={clsx('w-auto object-contain drop-shadow-[0_0_16px_rgba(242,193,78,0.35)]', SIZES[size], className)}
    />
  )
}
