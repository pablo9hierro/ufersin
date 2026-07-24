import { MessageCircle } from 'lucide-react'

export default function WhatsAppLink({ phone, className }: { phone: string; className?: string }) {
  const digits = phone.replace(/\D/g, '')
  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={
        className ??
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors'
      }
    >
      <MessageCircle className="w-3.5 h-3.5 flex-shrink-0" />
      {phone}
    </a>
  )
}
