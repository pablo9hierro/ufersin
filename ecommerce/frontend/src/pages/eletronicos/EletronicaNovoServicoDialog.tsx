import { useEffect, useState } from 'react'
import { CheckCircle2, Home, Loader2, MapPin, Search, Truck, X } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import { fetchCatalog, type CatalogItem } from '../../lib/eletronicosApi'
import { resolveTenantSlug } from '../../lib/tenantConfig'
import LocationPicker, { type LocationPickerResult } from '../../components/checkout/LocationPicker'

// Port 1:1 (adaptado) de src/components/dashboard/NovoServicoDialog.tsx do
// vrtech -- "PDV de serviço": lojista registra um atendimento já combinado
// por fora (telefone, balcão), pesquisando o serviço no catálogo real e já
// marcando o horário. O real cria service_request + appointment numa
// tacada só (endpoint /api/appointments do vrtech já faz isso junto); esse
// motor tem os dois passos separados (POST service-requests, depois POST
// appointments com service_request_id), então o dialog aqui chama os dois
// em sequência -- mesmo resultado funcional.
// LocationPicker aqui só devolve lat/lng/label/bairro (não rua/número/
// cidade como o do vrtech original) -- mesma simplificação já feita em
// EletronicaServiceRequestForm.tsx, documentada lá.

const INPUT =
  'w-full bg-[#0a0a0b] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#d4d4d8]/30 outline-none focus:border-[#e0211a] transition-colors'

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const SELECT = 'bg-[#0a0a0b] border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#e0211a] transition-colors'

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function DateDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const today = new Date()
  const year = m ? Number(m[1]) : today.getFullYear()
  const month = m ? Number(m[2]) : today.getMonth() + 1
  const day = m ? Number(m[3]) : today.getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const emit = (y: number, mo: number, d: number) => {
    const maxDay = daysInMonth(y, mo)
    onChange(`${y}-${pad(mo)}-${pad(Math.min(d, maxDay))}`)
  }
  const anos = [today.getFullYear(), today.getFullYear() + 1]
  const dias = Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1)
  return (
    <div className="flex gap-2">
      <select aria-label="Dia" value={day} onChange={(e) => emit(year, month, Number(e.target.value))} className={SELECT}>
        {dias.map((d) => (
          <option key={d} value={d}>{pad(d)}</option>
        ))}
      </select>
      <select aria-label="Mês" value={month} onChange={(e) => emit(year, Number(e.target.value), day)} className={`${SELECT} flex-1`}>
        {MESES.map((nome, i) => (
          <option key={nome} value={i + 1}>{nome}</option>
        ))}
      </select>
      <select aria-label="Ano" value={year} onChange={(e) => emit(Number(e.target.value), month, day)} className={SELECT}>
        {anos.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
    </div>
  )
}

function TimeDropdown({ value, onChange, step = 5 }: { value: string; onChange: (v: string) => void; step?: number }) {
  const [h, m] = value.split(':')
  const pad = (n: number) => String(n).padStart(2, '0')
  const horas = Array.from({ length: 24 }, (_, i) => pad(i))
  const minutos = Array.from({ length: Math.ceil(60 / step) }, (_, i) => pad(i * step))
  return (
    <div className="flex items-center gap-2">
      <select aria-label="Hora" value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)} className={SELECT}>
        {horas.map((x) => (
          <option key={x} value={x}>{x}</option>
        ))}
      </select>
      <span className="text-[#d4d4d8]/40">:</span>
      <select aria-label="Minuto" value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)} className={SELECT}>
        {minutos.map((x) => (
          <option key={x} value={x}>{x}</option>
        ))}
      </select>
      <span className="text-xs text-[#d4d4d8]/40 ml-1">h</span>
    </div>
  )
}

function ServicePicker({
  value,
  onChange,
}: {
  value: { id: string | null; label: string }
  onChange: (v: { id: string | null; label: string }) => void
}) {
  const [query, setQuery] = useState(value.label)
  const [items, setItems] = useState<CatalogItem[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const slug = resolveTenantSlug()
    if (!slug) return
    setLoading(true)
    fetchCatalog(slug)
      .then((res) => setItems(res.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const q = query.trim().toLowerCase()
  const results = q
    ? items.filter((i) => (i.model_name ?? '').toLowerCase().includes(q) || i.repair_type.toLowerCase().includes(q)).slice(0, 20)
    : items.slice(0, 20)

  const select = (item: CatalogItem) => {
    const label = `${item.model_name ?? 'Universal'} — ${item.repair_type}`
    setQuery(label)
    onChange({ id: item.id, label })
    setOpen(false)
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-4 h-4 text-[#d4d4d8]/40 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            onChange({ id: null, label: e.target.value })
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Buscar no cadastro de serviços..."
          className={`${INPUT} pl-9`}
        />
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-[#161618] border border-white/10 rounded-xl shadow-xl max-h-56 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2.5 text-sm text-[#d4d4d8]/50 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando...
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-[#d4d4d8]/50">Nenhum serviço encontrado no cadastro — o texto digitado será usado como está.</div>
          ) : (
            results.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={() => select(item)}
                className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
              >
                <p className="text-sm text-white">{item.model_name ?? 'Universal'} — {item.repair_type}</p>
                <p className="text-xs text-[#d4d4d8]/50">R$ {Number(item.price).toFixed(2)}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function EletronicaNovoServicoDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [service, setService] = useState<{ id: string | null; label: string }>({ id: null, label: '' })
  const [notes, setNotes] = useState('')
  const [dia, setDia] = useState(today)
  const [horario, setHorario] = useState('09:00')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [selfPickup, setSelfPickup] = useState(true)
  const [address, setAddress] = useState<LocationPickerResult | null>(null)
  const [showMap, setShowMap] = useState(false)

  const submit = async () => {
    setSaving(true)
    setErr(null)
    try {
      const request = await eletronicosAdmin.serviceRequests.create({
        customer_name: customerName,
        customer_phone: customerPhone,
        phone_model: service.label || undefined,
        problem_description: notes || undefined,
        self_pickup: selfPickup,
        address_lat: selfPickup ? undefined : address?.lat,
        address_lng: selfPickup ? undefined : address?.lng,
        address_neighborhood: selfPickup ? undefined : address?.bairro,
        status: selfPickup ? 'retirada_local' : 'em_busca',
      })
      await eletronicosAdmin.appointments.create({
        service_label: service.label || 'Atendimento',
        customer_name: customerName,
        customer_phone: customerPhone,
        date: dia,
        time: horario,
        notes: notes || undefined,
      })
      void request
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao registrar o serviço.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="bg-[#161618] border border-white/10 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 sticky top-0 bg-[#161618] z-10">
          <h2 className="font-semibold text-white">Registrar novo serviço</h2>
          <button onClick={onClose} className="text-[#d4d4d8]/50 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {showMap && <LocationPicker onClose={() => setShowMap(false)} onConfirm={(r) => { setAddress(r); setShowMap(false) }} />}

          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Cliente</label>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">WhatsApp</label>
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Serviço</label>
            <ServicePicker value={service} onChange={setService} />
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Data</label>
            <DateDropdown value={dia} onChange={setDia} />
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Horário de início</label>
            <TimeDropdown value={horario} onChange={setHorario} />
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Aparelho</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelfPickup(true)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold border transition-all ${
                  selfPickup ? 'border-[#e0211a] bg-red-500/10 text-[#e0211a]' : 'border-white/10 text-[#d4d4d8]'
                }`}
              >
                <Home className="w-3.5 h-3.5" /> Já com a loja
              </button>
              <button
                type="button"
                onClick={() => setSelfPickup(false)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold border transition-all ${
                  !selfPickup ? 'border-[#e0211a] bg-red-500/10 text-[#e0211a]' : 'border-white/10 text-[#d4d4d8]'
                }`}
              >
                <Truck className="w-3.5 h-3.5" /> Buscar (coleta)
              </button>
            </div>
            {!selfPickup && (
              <button
                type="button"
                onClick={() => setShowMap(true)}
                className="w-full mt-2 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/10 bg-[#0a0a0b] text-sm text-left hover:border-[#e0211a]/40 transition-colors"
              >
                <MapPin className="w-4 h-4 text-[#e0211a] shrink-0" />
                <span className={address ? 'text-white truncate' : 'text-[#d4d4d8]/50'}>{address?.label ?? 'Selecionar endereço de coleta no mapa…'}</span>
              </button>
            )}
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Observações</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={INPUT} />
          </div>
          {err && <p className="text-sm text-red-400">{err}</p>}
          <button
            onClick={submit}
            disabled={saving || !customerName || !customerPhone || !service.label || (!selfPickup && !address)}
            className="w-full bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Registrar
          </button>
        </div>
      </div>
    </div>
  )
}
