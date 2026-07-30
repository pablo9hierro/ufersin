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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="rounded-3xl w-full max-w-xs p-5" style={{ background: 'var(--u3-surface)' }} onClick={(e) => e.stopPropagation()}>
        <p className="font-bold mb-1.5">{title}</p>
        <p className="text-sm u3-dim mb-5">{message}</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="u3-pill-secondary py-2 text-sm">
            Cancelar
          </button>
          <button onClick={onConfirm} className="u3-pill-primary py-2 text-sm">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
