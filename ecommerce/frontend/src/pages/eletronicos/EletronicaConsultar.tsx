import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Clock,
  CreditCard,
  Eye,
  Loader2,
  MapPin,
  Package,
  PackageCheck,
  PartyPopper,
  Search,
  Smartphone,
  Truck,
  Wrench,
  XCircle,
} from 'lucide-react'
import { resolveTenantSlug, withTenantSearch } from '../../lib/tenantConfig'
import { consultarOtpCheck, consultarOtpVerify, type ConsultarResponse, type ServiceRequestDto } from '../../lib/eletronicosApi'
import EletronicaLogo from './EletronicaLogo'

// Port 1:1 de src/app/consultar/ConsultarView.tsx do vrtech -- mesmo tema
// (gradiente vr-graphite->vr-black, card branco, timeline com etapas
// pontilhadas), mesmo STATUS_MAP/STAGES (adaptado pros nomes reais de
// ServiceStatus que o backend Resolutoo usa), e agora também o gate de OTP
// por WhatsApp (telefone -> valida se tem atendimento -> código de 3
// dígitos mandado por WhatsApp -> resultados). Cancelamento de
// solicitação ainda não portado (endpoint /api/consultar de cancelar não
// existe nesse motor).

type ServiceStatus = string

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  pending: { label: 'Aguardando avaliação', color: 'text-yellow-700', bg: 'bg-yellow-100', icon: <Clock className="w-3.5 h-3.5" /> },
  aguardando_diagnostico: { label: 'Aguardando diagnóstico', color: 'text-yellow-700', bg: 'bg-yellow-100', icon: <Clock className="w-3.5 h-3.5" /> },
  diagnostico_enviado: { label: 'Orçamento enviado', color: 'text-orange-700', bg: 'bg-orange-100', icon: <ClipboardList className="w-3.5 h-3.5" /> },
  accepted: { label: 'Aceito', color: 'text-green-700', bg: 'bg-green-100', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  rejected: { label: 'Recusado', color: 'text-red-700', bg: 'bg-red-100', icon: <XCircle className="w-3.5 h-3.5" /> },
  retirada_local: { label: 'Retirada/entrega pelo cliente', color: 'text-teal-700', bg: 'bg-teal-100', icon: <Package className="w-3.5 h-3.5" /> },
  em_busca: { label: 'Motoboy a caminho', color: 'text-orange-700', bg: 'bg-orange-100', icon: <Truck className="w-3.5 h-3.5" /> },
  in_progress: { label: 'Em reparo', color: 'text-purple-700', bg: 'bg-purple-100', icon: <Wrench className="w-3.5 h-3.5" /> },
  completed: { label: 'Pronto', color: 'text-gray-700', bg: 'bg-gray-100', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  em_pagamento: { label: 'Em pagamento', color: 'text-lime-700', bg: 'bg-lime-100', icon: <CreditCard className="w-3.5 h-3.5" /> },
  delivered: { label: 'Aparelho entregue', color: 'text-cyan-700', bg: 'bg-cyan-100', icon: <PackageCheck className="w-3.5 h-3.5" /> },
  finished: { label: 'Atendimento concluído', color: 'text-emerald-700', bg: 'bg-emerald-100', icon: <PartyPopper className="w-3.5 h-3.5" /> },
  cancelled: { label: 'Cancelado', color: 'text-rose-700', bg: 'bg-rose-100', icon: <XCircle className="w-3.5 h-3.5" /> },
}

type Stage = { key: string; label: string; icon: React.ReactNode; statuses: ServiceStatus[] }

const STAGES: Stage[] = [
  { key: 'pending', label: 'Solicitação recebida', icon: <ClipboardList className="w-3.5 h-3.5" />, statuses: ['pending', 'aguardando_diagnostico', 'diagnostico_enviado', 'accepted'] },
  { key: 'pickup', label: 'Em rota de busca / cliente vai levar', icon: <Truck className="w-3.5 h-3.5" />, statuses: ['em_busca', 'retirada_local'] },
  { key: 'in_progress', label: 'Em reparo', icon: <Wrench className="w-3.5 h-3.5" />, statuses: ['in_progress'] },
  { key: 'completed', label: 'Pronto — combinando entrega/retirada', icon: <PackageCheck className="w-3.5 h-3.5" />, statuses: ['completed'] },
  { key: 'em_pagamento', label: 'Em pagamento', icon: <CreditCard className="w-3.5 h-3.5" />, statuses: ['em_pagamento'] },
  { key: 'delivery', label: 'Em rota de entrega / cliente vai buscar', icon: <Truck className="w-3.5 h-3.5" />, statuses: ['delivered'] },
  { key: 'finished', label: 'Atendimento concluído', icon: <PartyPopper className="w-3.5 h-3.5" />, statuses: ['finished'] },
]

function stageIndexForStatus(status: ServiceStatus): number {
  return STAGES.findIndex((s) => s.statuses.includes(status))
}

function TimelineStep({
  icon,
  label,
  current,
  last,
  children,
}: {
  icon: React.ReactNode
  label: string
  current?: boolean
  last?: boolean
  children?: React.ReactNode
}) {
  return (
    <li className="relative pl-8 pb-5 last:pb-0">
      {!last && <span className="absolute left-[11px] top-6 bottom-0 border-l-2 border-dashed border-red-200" />}
      <span
        className={`absolute left-0 top-0 w-6 h-6 rounded-full flex items-center justify-center ${
          current ? 'bg-[#e0211a] text-white' : 'bg-red-100 text-[#e0211a]'
        }`}
      >
        {icon}
      </span>
      <p className={`text-sm leading-6 ${current ? 'font-bold text-[#e0211a]' : 'font-medium text-gray-700'}`}>{label}</p>
      {children}
    </li>
  )
}

function RequestStatusTimeline({ request }: { request: ServiceRequestDto & { service_order: { pdf_url: string | null } | null } }) {
  const [expanded, setExpanded] = useState(false)
  const current = STATUS_MAP[request.status] ?? STATUS_MAP.pending
  const isInterrupted = request.status === 'rejected' || request.status === 'cancelled'
  const currentIdx = stageIndexForStatus(request.status)
  const visibleStages = isInterrupted ? [] : STAGES.slice(0, currentIdx + 1)

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <span className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full ${current.bg} ${current.color}`}>
          {current.icon}
          {current.label}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1">
          <ol>
            {isInterrupted ? (
              <>
                <TimelineStep icon={<ClipboardList className="w-3.5 h-3.5" />} label="Solicitação realizada" />
                <TimelineStep icon={current.icon} label={current.label} current last />
              </>
            ) : (
              visibleStages.map((stage, i) => {
                const isLast = i === visibleStages.length - 1
                return (
                  <TimelineStep key={stage.key} icon={stage.icon} label={stage.label} current={isLast} last={isLast}>
                    {isLast && request.service_order?.pdf_url && (
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <a
                          href={request.service_order.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[#e0211a] hover:text-[#a3140f] font-semibold flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Ver ordem de serviço (PDF)
                        </a>
                      </div>
                    )}
                  </TimelineStep>
                )
              })
            )}
          </ol>
        </div>
      )}
    </div>
  )
}

function NotFoundCard() {
  return (
    <div className="bg-white rounded-2xl p-8 text-center shadow">
      <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
      <p className="text-gray-700 font-semibold mb-1">Não foi encontrada nenhuma solicitação neste WhatsApp</p>
      <p className="text-gray-400 text-sm mb-5">Você pode iniciar um atendimento agora mesmo:</p>
      <Link
        to={`/catalogo-servico${withTenantSearch()}`}
        className="inline-block w-full bg-[#e0211a] hover:bg-[#a3140f] text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 text-sm"
      >
        Ver serviços
      </Link>
    </div>
  )
}

function formatPhone(value: string) {
  const d = value.replace(/\D/g, '')
  if (d.length <= 2) return `(${d}`
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
}

function googleMapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

export default function EletronicaConsultar() {
  const slug = resolveTenantSlug()

  const [step, setStep] = useState<'phone' | 'otp' | 'results' | 'not-found'>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ConsultarResponse | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    setData(null)
    setStep('phone')
  }, [slug])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((v) => v - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const checkPhone = async (rawPhone: string) => {
    if (!slug) return
    const digits = rawPhone.replace(/\D/g, '')
    if (digits.length < 10) return
    setLoading(true)
    setError(null)
    try {
      const res = await consultarOtpCheck(slug, digits, false)
      if (!res.found) {
        setStep('not-found')
        return
      }
      setStep('otp')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao verificar telefone')
    } finally {
      setLoading(false)
    }
  }

  const sendNewOtp = async (rawPhone: string) => {
    if (!slug) return
    const digits = rawPhone.replace(/\D/g, '')
    if (digits.length < 10) return
    setLoading(true)
    setError(null)
    try {
      const res = await consultarOtpCheck(slug, digits, true)
      if (!res.found) {
        setStep('not-found')
        return
      }
      setResendCooldown(30)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar código')
    } finally {
      setLoading(false)
    }
  }

  // Gera e manda o primeiro código assim que o telefone é confirmado.
  useEffect(() => {
    if (step === 'otp' && slug) sendNewOtp(phone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    await checkPhone(phone)
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!slug || phone.replace(/\D/g, '').length < 10 || otp.length < 3) return
    setLoading(true)
    setError(null)
    try {
      const res = await consultarOtpVerify(slug, phone, otp)
      if (!res.valid) {
        setError('Código inválido ou expirado')
        return
      }
      setData({ requests: res.requests, appointments: res.appointments })
      setStep('results')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao verificar código')
    } finally {
      setLoading(false)
    }
  }

  const nothingFound = step === 'results' && data && data.requests.length === 0 && data.appointments.length === 0

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#232327] to-[#0a0a0b]">
      <header className="px-5 pt-8 pb-6 text-white">
        <Link to={`/${withTenantSearch()}`} className="flex items-center gap-1.5 text-[#d4d4d8] hover:text-white text-sm mb-5 w-fit transition-colors">
          <ChevronLeft className="w-4 h-4" /> Início
        </Link>
        <EletronicaLogo size="sm" className="mb-3" />
        <h1 className="text-2xl font-bold">Minhas solicitações</h1>
        <p className="text-[#d4d4d8]/70 text-sm mt-1">Digite seu WhatsApp cadastrado pra ver o status dos seus pedidos</p>
      </header>

      <div className="px-4 max-w-lg md:mx-auto pb-8">
        {step === 'phone' && (
          <form onSubmit={handleSearch} className="bg-white rounded-2xl p-5 shadow-xl mb-4">
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Seu WhatsApp cadastrado</label>
            <div className="flex gap-2">
              <input
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                inputMode="tel"
                maxLength={15}
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#e0211a]"
              />
              <button
                type="submit"
                disabled={loading || phone.replace(/\D/g, '').length < 10}
                className="bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-40 text-white font-semibold rounded-xl px-5 flex items-center justify-center gap-2 transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>
            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          </form>
        )}

        {step === 'not-found' && (
          <div className="mb-4">
            <NotFoundCard />
          </div>
        )}

        {step === 'otp' && (
          <form onSubmit={handleVerify} className="bg-white rounded-2xl p-5 shadow-xl mb-4">
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Código de 3 dígitos enviado pro seu WhatsApp</label>
            <div className="flex gap-2">
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="000"
                inputMode="numeric"
                maxLength={3}
                autoFocus
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-2xl tracking-[0.5em] font-bold text-center outline-none focus:border-[#e0211a]"
              />
              <button
                type="submit"
                disabled={loading || otp.length < 3}
                className="bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-40 text-white font-semibold rounded-xl px-5 flex items-center justify-center gap-2 transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>
            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
            <div className="flex items-center justify-between mt-3">
              <button
                type="button"
                onClick={() => {
                  setStep('phone')
                  setOtp('')
                }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Trocar número
              </button>
              <button
                type="button"
                disabled={resendCooldown > 0 || loading}
                onClick={() => sendNewOtp(phone)}
                className="text-xs text-[#e0211a] hover:text-[#a3140f] font-semibold disabled:text-gray-300 disabled:cursor-not-allowed"
              >
                {resendCooldown > 0 ? `Gerar novo código (${resendCooldown}s)` : 'Gerar novo código'}
              </button>
            </div>
          </form>
        )}

        {nothingFound && <NotFoundCard />}

        <div className="space-y-3">
          {data?.requests.map((req) => {
            const quote = req.quote_value ?? req.estimated_quote_value
            return (
              <div key={req.id} className="bg-white rounded-2xl p-5 shadow">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <RequestStatusTimeline request={req} />
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0 pt-2.5">
                    {new Date(req.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="font-semibold text-gray-900">{req.phone_model || 'Aparelho'}</span>
                  </div>
                  {req.problem_description && (
                    <p className="text-sm text-gray-600 pl-6 leading-relaxed">{req.problem_description}</p>
                  )}

                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="text-sm text-gray-500">
                        {req.self_pickup
                          ? 'Você vai levar/buscar o aparelho — sem coleta/entrega'
                          : req.address_label || 'Endereço a confirmar'}
                      </span>
                      {!req.self_pickup && req.address_lat != null && req.address_lng != null && (
                        <a
                          href={googleMapsLink(req.address_lat, req.address_lng)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs text-blue-600 hover:underline mt-0.5"
                        >
                          📍 Ver localização exata no mapa
                        </a>
                      )}
                    </div>
                  </div>

                  {quote != null && (
                    <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 mt-1">
                      <p className="text-sm font-bold text-[#e0211a]">
                        💰 {req.quote_value != null ? 'Orçamento' : 'Valor estimado'}: R$ {quote.toFixed(2)}
                      </p>
                    </div>
                  )}

                  {req.owner_notes && (
                    <p className="text-xs text-gray-500 pl-6 italic border-l-2 border-gray-100 ml-1">{req.owner_notes}</p>
                  )}
                </div>
              </div>
            )
          })}

          {data?.appointments.map((a) => (
            <div key={a.id} className="bg-white rounded-2xl p-5 shadow flex items-start gap-3">
              <PackageCheck className="w-5 h-5 text-[#e0211a] shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-gray-900">{a.service_label || 'Agendamento'}</p>
                <p className="text-xs text-gray-500">
                  {new Date(a.starts_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </p>
                {a.notes && <p className="text-xs text-gray-500 mt-1">{a.notes}</p>}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-[#d4d4d8]/60 mt-6">
          <Link to={`/${withTenantSearch()}`} className="text-[#e0211a] hover:underline">
            Nova solicitação
          </Link>
        </p>
      </div>
    </main>
  )
}
