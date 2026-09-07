import { X } from 'lucide-react'
import type { ReactNode } from 'react'

/** Modal de preview de recurso -- mesmo padrão de dialog já usado em
 * MeuPlano.tsx (overlay + role="dialog"), reaproveitado aqui pro clique
 * "ver como funciona" dos cards de recurso da landing. */
export default function FeaturePreviewDialog({
  title,
  desc,
  onClose,
  children,
  wide,
}: {
  title: string
  desc: string
  onClose: () => void
  children: ReactNode
  /** Preview com iframe do painel real -- precisa de mais espaço que o card ilustrativo. */
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`uf-glass rounded-2xl p-6 w-full max-h-[90vh] overflow-y-auto ${wide ? 'max-w-4xl' : 'max-w-md'}`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-bold text-lg">{title}</h3>
            <p className="text-sm text-uf-silver-dim mt-1">{desc}</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-uf-silver-dim hover:text-white flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
