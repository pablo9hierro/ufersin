import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

// Port 1:1 de src/components/dashboard/AccordionSection.tsx do vrtech.

export default function EletronicaAccordionSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-[#161618] rounded-2xl border border-white/5 overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span>
          <span className="text-sm font-semibold text-white">{title}</span>
          {subtitle && <span className="block text-xs text-[#d4d4d8]/50 mt-0.5">{subtitle}</span>}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-[#d4d4d8]/40 shrink-0" /> : <ChevronDown className="w-4 h-4 text-[#d4d4d8]/40 shrink-0" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  )
}
