import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// Substitui o window.confirm() nativo (cinza/preto, fora do padrão do
// site) por um diálogo no mesmo estilo glass usado em todo popup do
// admin. Uso: const { askConfirm, confirmDialogElement } = useConfirmDialog()
// — chama askConfirm(mensagem, onConfirm) e renderiza {confirmDialogElement}
// uma vez em qualquer lugar da árvore do componente.
export function useConfirmDialog() {
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const askConfirm = (message: string, onConfirm: () => void) => setConfirmDialog({ message, onConfirm })

  const confirmDialogElement = (
    <AnimatePresence>
      {confirmDialog && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="glass rounded-2xl p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white font-semibold mb-5">{confirmDialog.message}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDialog(null)} className="btn-secondary flex-1">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmDialog.onConfirm()
                  setConfirmDialog(null)
                }}
                className="flex-1 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 transition-all"
              >
                Remover
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return { askConfirm, confirmDialogElement }
}
