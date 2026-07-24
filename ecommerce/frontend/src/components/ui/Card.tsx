import { type HTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'

export default function Card({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={clsx('bg-son-surface border border-white/5 rounded-2xl', className)} {...props}>
      {children}
    </div>
  )
}

export function GlassCard({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={clsx('glass rounded-2xl', className)} {...props}>
      {children}
    </div>
  )
}
