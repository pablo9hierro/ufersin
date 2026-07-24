import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

// Entrada padrão pra troca de página nas rotas de CLIENTE (catálogo,
// checkout, consultar etc.) — nunca usado nas áreas logadas (admin/
// motoboy), que continuam sem esse motion de propósito.
export default function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
