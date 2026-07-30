export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="u4-panel w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
        <p className="font-bold mb-1.5">{title}</p>
        <p className="text-sm u4-dim mb-5">{message}</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="u4-btn-secondary py-2 text-sm">
            Cancelar
          </button>
          <button onClick={onConfirm} className="u4-btn-primary py-2 text-sm">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
