import { AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'

// Uiverse.io by Yaya12085 — cartão de confirmação (era claro/branco pra
// "desativar conta"; aqui escuro/sunset, reaproveitado genérico pra
// qualquer ação destrutiva com confirmação, a primeira sendo desmarcar
// favorito). Ícone circular + título + mensagem + botão de ação em cima,
// cancelar embaixo — mesma ordem/hierarquia da referência.
export default function ConfirmRemoveDialog({
  title,
  message,
  confirmLabel = 'Remover',
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="sunset-confirm-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sunset-confirm-icon">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="text-center mt-3">
          <p className="sunset-confirm-title">{title}</p>
          <p className="sunset-confirm-message">{message}</p>
        </div>
        <div className="mt-4 space-y-2">
          <button type="button" onClick={onConfirm} className="sunset-confirm-danger-btn">
            {confirmLabel}
          </button>
          <button type="button" onClick={onCancel} className="sunset-confirm-cancel-btn">
            Cancelar
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
