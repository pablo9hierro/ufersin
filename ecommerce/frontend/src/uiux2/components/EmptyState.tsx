import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function EmptyState({ icon: Icon, message, actionLabel, actionHref }: { icon: LucideIcon; message: string; actionLabel?: string; actionHref?: string }) {
  return (
    <div className="text-center py-16 u2-dim">
      <Icon className="w-10 h-10 mx-auto mb-3 opacity-40" />
      <p>{message}</p>
      {actionLabel && actionHref && (
        <Link to={actionHref} className="u2-btn-primary inline-flex mt-4 px-5 py-2.5 text-sm">
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
