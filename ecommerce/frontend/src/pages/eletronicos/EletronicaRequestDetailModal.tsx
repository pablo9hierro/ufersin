import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  QrCode,
  Smartphone,
  User,
  X,
} from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { ServiceRequestDto } from '../../lib/eletronicosApi'
import { generateServiceOrderPdf } from '../../lib/eletronicosPdf'
import { useTenantConfig } from '../../hooks/useTenantConfig'

// Port 1:1 (adaptado) de src/components/RequestDetailModal.tsx do vrtech --
// mesmo STATUS_LABELS/getAdvanceConfig (fluxo guiado single/choice em vez
// de "qualquer status"), mesmo dialog de pagamento com desconto/Pix real
// (reaproveita eletronicosAdmin.pix, o mesmo mecanismo do PDV). NÃO
// portado (gaps disclosed, esse motor não tem a tabela/endpoint ainda):
// senha do cliente (PIN/padrão), DiagnosticSection completa (fotos +
// checklist de diagnóstico -- aqui "aguardando_diagnostico" só pede o
// valor final e avança), checklist item-a-item da OS (usa o campo texto
// livre "resumo do serviço" já existente).

type ServiceStatus = string

const PAYMENT_METHODS = ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Transferência'] as const

const STATUS_LABELS: Record<string, string> = {
  pending: '🆕 Solicitação nova — aguardando aceite',
  accepted: 'Aceito pelo cliente (orçamento confirmado)',
  rejected: '✅ Atendimento concluído — Recusado pelo cliente',
  retirada_local: '🏠 Retirada/entrega pelo cliente',
  em_busca: '🛵 Em rota de recolhimento',
  in_progress: '🔧 Em reparo',
  completed: '✅ Pronto — combinar entrega/retirada',
  em_pagamento: '💳 Em pagamento',
  em_entrega: '📦 Em rota de entrega',
  delivered: '📬 Aparelho entregue',
  finished: '✅ Atendimento concluído',
  cancelled: '✅ Atendimento concluído — Cancelado pelo cliente',
  aguardando_diagnostico: '🔍 Aguardando diagnóstico físico do aparelho',
  diagnostico_enviado: '📄 Diagnóstico enviado — aguardando aprovação do cliente',
}

type AdvanceConfig =
  | { type: 'terminal' }
  | { type: 'diagnostic' }
  | { type: 'single'; next: ServiceStatus; label: string; ready: boolean; blockedMessage?: string }
  | { type: 'choice'; options: { next: ServiceStatus; label: string }[]; ready: boolean; blockedMessage?: string }

function getAdvanceConfig(
  current: ServiceStatus,
  osCompleted: boolean,
  paymentReady: boolean,
  selfPickup: boolean,
  diagnosisRequested: boolean,
  estimatedQuoteValue: string,
): AdvanceConfig {
  switch (current) {
    case 'pending':
      if (selfPickup) {
        return { type: 'single', next: 'retirada_local', label: '🏠 Aceitar — aguardando aparelho', ready: true }
      }
      return {
        type: 'choice',
        options: [
          { next: 'retirada_local', label: '🏠 Aceitar — cliente vai trazer/retirar o aparelho' },
          { next: 'em_busca', label: '🛵 Aceitar — em rota de coleta (motoboy)' },
        ],
        ready: true,
      }
    case 'retirada_local':
    case 'em_busca':
      return diagnosisRequested
        ? {
            type: 'single',
            next: 'aguardando_diagnostico',
            label: '🔍 Enviar para diagnóstico físico',
            ready: !!estimatedQuoteValue,
            blockedMessage: 'Preencha o orçamento estimado antes de avançar.',
          }
        : {
            type: 'single',
            next: 'in_progress',
            label: '🔧 Avançar para "Em reparo"',
            ready: !!estimatedQuoteValue,
            blockedMessage: 'Preencha o orçamento estimado antes de avançar.',
          }
    case 'aguardando_diagnostico':
      return { type: 'diagnostic' }
    case 'diagnostico_enviado':
      return {
        type: 'choice',
        options: [
          { next: 'in_progress', label: '✅ Cliente aprovou o orçamento' },
          { next: 'cancelled', label: '❌ Cliente cancelou' },
        ],
        ready: true,
      }
    case 'accepted':
      if (selfPickup) {
        return { type: 'single', next: 'retirada_local', label: '🏠 Confirmar chegada do aparelho', ready: true }
      }
      return {
        type: 'choice',
        options: [
          { next: 'retirada_local', label: '🏠 Cliente vai trazer/retirar o aparelho' },
          { next: 'em_busca', label: '🛵 Recolhimento do aparelho (motoboy)' },
        ],
        ready: true,
      }
    case 'in_progress':
      return {
        type: 'single',
        next: 'completed',
        label: '✅ Avançar para "Reparo concluído"',
        ready: osCompleted,
        blockedMessage: 'Registre o resumo do serviço e conclua a ordem de serviço antes de avançar.',
      }
    case 'completed':
      return { type: 'single', next: 'em_pagamento', label: '💳 Avançar para forma de pagamento', ready: true }
    case 'em_pagamento':
      if (selfPickup) {
        return {
          type: 'single',
          next: 'delivered',
          label: '📬 Confirmar retirada pelo cliente',
          ready: paymentReady,
          blockedMessage: 'Registre a forma de pagamento antes de avançar.',
        }
      }
      return {
        type: 'single',
        next: 'em_entrega',
        label: '📦 Confirmar saída para entrega (motoboy)',
        ready: paymentReady,
        blockedMessage: 'Registre a forma de pagamento antes de avançar.',
      }
    case 'em_entrega':
    case 'delivered':
      return { type: 'single', next: 'finished', label: '✅ Avançar para "Atendimento concluído"', ready: true }
    default:
      return { type: 'terminal' }
  }
}

function googleMapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

type PixState = {
  amount: number
  payment_id: string
  qr_code: string
  qr_code_base64: string
  status: 'pendente' | 'aprovado'
}

function PixQrDialog({ state, onClose }: { state: PixState; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-[#e0211a]" />
          <h3 className="font-bold text-gray-900">Pix — R$ {state.amount.toFixed(2)}</h3>
        </div>
        {state.status === 'aprovado' ? (
          <p className="text-sm text-green-600 flex items-center gap-1.5 py-6 justify-center font-semibold">
            <Check className="w-5 h-5" /> Pagamento aprovado!
          </p>
        ) : (
          <>
            {state.qr_code_base64 && (
              <img src={state.qr_code_base64} alt="QR Code Pix" className="w-full rounded-xl border border-gray-100 p-2" />
            )}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(state.qr_code)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="w-full px-3 py-2.5 rounded-xl text-xs font-mono text-gray-500 bg-gray-50 border border-gray-200 hover:border-[#e0211a]/40 transition-colors truncate"
            >
              {copied ? 'Copiado!' : 'Copiar código copia-e-cola'}
            </button>
            <p className="text-xs text-gray-400 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Aguardando pagamento...
            </p>
          </>
        )}
        <button type="button" onClick={onClose} className="w-full px-4 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-800 transition-colors">
          Fechar
        </button>
      </div>
    </div>
  )
}

export default function EletronicaRequestDetailModal({
  request,
  onClose,
  onUpdated,
}: {
  request: ServiceRequestDto
  onClose: () => void
  onUpdated: (r: ServiceRequestDto) => void
}) {
  const tenantConfig = useTenantConfig()
  const [status, setStatus] = useState(request.status)
  const [quoteValue, setQuoteValue] = useState(request.quote_value?.toString() ?? '')
  const [estimatedQuoteValue, setEstimatedQuoteValue] = useState(request.estimated_quote_value?.toString() ?? '')
  const [savingEstimate, setSavingEstimate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [completedServices, setCompletedServices] = useState('')
  const [osCompleted, setOsCompleted] = useState(['completed', 'em_pagamento', 'em_entrega', 'delivered', 'finished'].includes(request.status))
  const [completing, setCompleting] = useState(false)

  const [selectedMethods, setSelectedMethods] = useState<string[]>((request.payment_methods ?? []).map((p) => p.method))
  const [methodValues, setMethodValues] = useState<Record<string, string>>(
    Object.fromEntries((request.payment_methods ?? []).map((p) => [p.method, String(p.value)])),
  )
  const [discountPercent, setDiscountPercent] = useState(request.discount_percent != null ? String(request.discount_percent) : '')
  const [paymentSaved, setPaymentSaved] = useState((request.payment_methods ?? []).length > 0)
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(true)
  const [pixDialog, setPixDialog] = useState<PixState | null>(null)
  const pendingMethodsRef = useRef<{ method: string; value: number }[]>([])

  const phoneDigits = request.customer_phone.replace(/\D/g, '')
  const baseValue = Number(quoteValue || 0)
  const discountNum = parseInt(discountPercent || '0', 10) || 0
  const discountedValue = baseValue * (1 - discountNum / 100)
  const lastMethod = selectedMethods[selectedMethods.length - 1]
  const otherMethods = selectedMethods.slice(0, -1)
  const otherSum = useMemo(
    () => otherMethods.reduce((s, m) => s + (parseFloat(methodValues[m] || '0') || 0), 0),
    [otherMethods, methodValues],
  )
  const remainder = Math.max(0, discountedValue - otherSum)
  const methodsValid = selectedMethods.length <= 1 || otherSum <= discountedValue + 0.01

  const toggleMethod = (method: string) => {
    setPaymentSaved(false)
    setSelectedMethods((prev) => (prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]))
  }

  async function persistPaymentMethods(finalMethods: { method: string; value: number }[]) {
    try {
      const updated = await eletronicosAdmin.serviceRequests.updateStatus(request.id, {
        status,
        discount_percent: discountNum || undefined,
        payment_methods: finalMethods,
        quote_value: discountedValue,
      })
      setQuoteValue(String(discountedValue))
      onUpdated(updated)
      setPaymentSaved(true)
      return true
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : 'Não foi possível salvar a forma de pagamento.')
      return false
    } finally {
      setSavingPayment(false)
    }
  }

  async function startPix(amount: number, finalMethods: { method: string; value: number }[]) {
    setPaymentError(null)
    setSavingPayment(true)
    try {
      const pix = await eletronicosAdmin.pix.create({
        amount,
        customer_name: request.customer_name,
        customer_email: request.customer_email ?? undefined,
        external_reference: request.id,
      })
      setPixDialog({ amount, payment_id: pix.payment_id, qr_code: pix.qr_code, qr_code_base64: pix.qr_code_base64, status: 'pendente' })
      pendingMethodsRef.current = finalMethods
    } catch (e) {
      setPaymentError(e instanceof Error ? e.message : 'Falha ao gerar Pix.')
    } finally {
      setSavingPayment(false)
    }
  }

  async function handleSavePayment() {
    setPaymentError(null)
    if (selectedMethods.length === 0) {
      setPaymentError('Selecione ao menos uma forma de pagamento.')
      return
    }
    if (!methodsValid) {
      setPaymentError('Os valores informados já passam do total com desconto.')
      return
    }
    const finalMethods = selectedMethods.length === 1
      ? [{ method: selectedMethods[0], value: discountedValue }]
      : [
          ...otherMethods.map((m) => ({ method: m, value: parseFloat(methodValues[m] || '0') || 0 })),
          { method: lastMethod, value: remainder },
        ]
    const pixEntry = finalMethods.find((m) => m.method === 'Pix' && m.value > 0)
    if (pixEntry) {
      await startPix(pixEntry.value, finalMethods)
      return
    }
    setSavingPayment(true)
    await persistPaymentMethods(finalMethods)
  }

  useEffect(() => {
    if (!pixDialog || pixDialog.status !== 'pendente') return
    const t = setInterval(async () => {
      try {
        const { status: pixStatus } = await eletronicosAdmin.pix.status(pixDialog.payment_id)
        if (pixStatus === 'approved') {
          clearInterval(t)
          setPixDialog((prev) => (prev ? { ...prev, status: 'aprovado' } : prev))
          const ok = await persistPaymentMethods(pendingMethodsRef.current)
          if (ok) setTimeout(() => setPixDialog(null), 1800)
        }
      } catch {
        // erro pontual de rede não trava a UI, tenta de novo no próximo tick
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixDialog?.payment_id, pixDialog?.status])

  async function saveEstimatedQuote() {
    setSavingEstimate(true)
    try {
      const value = estimatedQuoteValue ? parseFloat(estimatedQuoteValue) : undefined
      const updated = await eletronicosAdmin.serviceRequests.updateStatus(request.id, { status, quote_value: value })
      onUpdated(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar orçamento estimado')
    } finally {
      setSavingEstimate(false)
    }
  }

  async function handleAdvance(next: string) {
    setError(null)
    setLoading(true)
    try {
      const updated = await eletronicosAdmin.serviceRequests.updateStatus(request.id, {
        status: next,
        quote_value: quoteValue ? parseFloat(quoteValue) : undefined,
      })
      setStatus(next)
      onUpdated(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setLoading(false)
    }
  }

  async function handleCompleteOs() {
    setCompleting(true)
    setError(null)
    try {
      const order = await eletronicosAdmin.serviceOrders.getOrCreate(request.id)
      await eletronicosAdmin.serviceOrders.complete(order.id, {
        checklist: [],
        completed_services: completedServices.trim() || undefined,
      })
      setOsCompleted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao concluir ordem de serviço')
    } finally {
      setCompleting(false)
    }
  }

  async function handleGeneratePdf() {
    setGeneratingPdf(true)
    setError(null)
    try {
      const order = await eletronicosAdmin.serviceOrders.getOrCreate(request.id)
      const blob = generateServiceOrderPdf(request, order, tenantConfig?.loja_nome || 'Assistência técnica')
      const url = await eletronicosAdmin.uploadMedia(blob, `os-${request.id}.pdf`)
      await eletronicosAdmin.serviceOrders.setPdf(order.id, url)
      window.open(url, '_blank')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao gerar PDF')
    } finally {
      setGeneratingPdf(false)
    }
  }

  const advance = getAdvanceConfig(status, osCompleted, paymentSaved, !!request.self_pickup, !!request.diagnosis_requested, estimatedQuoteValue)

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-3xl z-10">
          <h2 className="font-bold text-gray-900">Detalhes da solicitação</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors">
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <section className="space-y-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cliente</h3>
            <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="font-semibold text-gray-900">{request.customer_name}</span>
              </div>
              <a href={`https://wa.me/55${phoneDigits}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-green-600 hover:text-green-700">
                <Phone className="w-4 h-4 shrink-0" />
                <span className="text-sm">{request.customer_phone}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              {request.customer_email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="text-sm text-gray-600">{request.customer_email}</span>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Celular</h3>
            <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="font-semibold text-gray-900">
                  {request.phone_model ?? (request.diagnosis_requested ? '🔍 Diagnóstico solicitado' : '—')}
                </span>
              </div>
              {request.problem_description && (
                <div className="flex items-start gap-2">
                  <MessageSquare className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-700">{request.problem_description}</p>
                </div>
              )}
              {request.image_url && (
                <a href={request.image_url} target="_blank" rel="noreferrer">
                  <img src={request.image_url} alt="Foto do celular" className="w-full max-h-48 object-cover rounded-xl mt-2" />
                </a>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Endereço</h3>
            <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-900">
                    {request.self_pickup ? 'Cliente vai levar/buscar o aparelho — sem coleta/entrega' : request.address_label || 'Endereço a confirmar'}
                  </p>
                  {!request.self_pickup && request.address_lat != null && request.address_lng != null && (
                    <a
                      href={googleMapsLink(request.address_lat, request.address_lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline mt-0.5 inline-block"
                    >
                      📍 Ver localização exata no mapa
                    </a>
                  )}
                </div>
              </div>
            </div>
          </section>

          {(status === 'retirada_local' || status === 'em_busca') && (
            <section className="space-y-2">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Coleta do aparelho</h3>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Orçamento estimado (R$) <span className="font-normal text-gray-400">— falado de boca, confirmado no diagnóstico</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-gray-400 font-medium">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={estimatedQuoteValue}
                    onChange={(e) => setEstimatedQuoteValue(e.target.value)}
                    onBlur={saveEstimatedQuote}
                    placeholder="0,00"
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#e0211a]"
                  />
                </div>
                {savingEstimate && (
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Salvando...
                  </p>
                )}
                {!request.self_pickup && request.shipping_price && (
                  <p className="text-xs text-amber-600 mt-1.5">
                    Frete (coleta): R$ {Number(request.shipping_price).toFixed(2)} — será somado automaticamente ao total.
                  </p>
                )}
              </div>
            </section>
          )}

          {status !== 'retirada_local' && status !== 'em_busca' && Number(quoteValue) > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Orçamento</h3>
              <div className="bg-slate-50 rounded-2xl p-4">
                <p className="text-sm text-gray-600">
                  Valor atual: <span className="font-semibold text-gray-900">R$ {Number(quoteValue || 0).toFixed(2)}</span>
                </p>
                {!request.self_pickup && request.shipping_price && (
                  <p className="text-xs text-gray-400 mt-0.5">Inclui frete (coleta): R$ {Number(request.shipping_price).toFixed(2)}</p>
                )}
              </div>
            </section>
          )}

          {status === 'in_progress' && (
            <section className="space-y-2">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ordem de serviço</h3>
              {osCompleted ? (
                <p className="text-sm text-green-600 bg-green-50 border border-green-100 rounded-xl p-3">✓ Ordem de serviço concluída</p>
              ) : (
                <>
                  <label className="block text-xs text-gray-500 mb-1">Resumo do serviço realizado</label>
                  <input
                    value={completedServices}
                    onChange={(e) => setCompletedServices(e.target.value)}
                    placeholder="ex: troca de tela"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#e0211a] mb-2"
                  />
                  <button
                    type="button"
                    disabled={completing}
                    onClick={handleCompleteOs}
                    className="w-full rounded-xl bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-50 text-white font-semibold py-2.5 flex items-center justify-center gap-2 transition-all"
                  >
                    {completing && <Loader2 className="w-4 h-4 animate-spin" />}
                    Concluir ordem de serviço
                  </button>
                </>
              )}
            </section>
          )}

          {status === 'em_pagamento' && !paymentDialogOpen && !paymentSaved && (
            <button
              type="button"
              onClick={() => setPaymentDialogOpen(true)}
              className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-[#e0211a] border border-[#e0211a]/30 rounded-xl py-2.5 hover:bg-red-50 transition-colors"
            >
              💳 Confirmar pagamento
            </button>
          )}

          {status === 'em_pagamento' && paymentDialogOpen && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
              <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Confirmar pagamento</h3>
                  <button type="button" onClick={() => setPaymentDialogOpen(false)} className="text-gray-400 hover:text-gray-700">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Desconto (%)</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      min="0"
                      max="100"
                      value={discountPercent}
                      onChange={(e) => {
                        setDiscountPercent(e.target.value.replace(/[^0-9]/g, ''))
                        setPaymentSaved(false)
                      }}
                      placeholder="0"
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#e0211a]"
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Valor original</span>
                    <span className="font-semibold text-gray-700">R$ {baseValue.toFixed(2)}</span>
                  </div>
                  {discountNum > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Valor com desconto</span>
                      <span className="font-bold text-[#e0211a]">R$ {discountedValue.toFixed(2)}</span>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Forma de pagamento</label>
                    <div className="flex flex-wrap gap-2">
                      {PAYMENT_METHODS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => toggleMethod(m)}
                          className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors
                            ${selectedMethods.includes(m) ? 'bg-[#e0211a] text-white border-[#e0211a]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#e0211a]/40'}`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  {selectedMethods.length > 1 && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-400">
                        Informe o valor pago em cada forma — a última é calculada automaticamente com o restante.
                      </p>
                      {otherMethods.map((m) => (
                        <div key={m} className="flex items-center gap-2">
                          <span className="text-sm text-gray-600 flex-1">{m}</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            value={methodValues[m] ?? ''}
                            onChange={(e) => {
                              setMethodValues((prev) => ({ ...prev, [m]: e.target.value }))
                              setPaymentSaved(false)
                            }}
                            placeholder="0,00"
                            className="w-28 rounded-xl border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-[#e0211a]"
                          />
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600 flex-1">
                          {lastMethod} <span className="text-gray-400">(restante)</span>
                        </span>
                        <input disabled value={remainder.toFixed(2)} className="w-28 rounded-xl border border-gray-200 px-2 py-1.5 text-sm opacity-60" />
                      </div>
                      {!methodsValid && <p className="text-xs text-amber-600">Os valores informados já passam do total com desconto.</p>}
                    </div>
                  )}
                  {paymentError && <p className="text-xs text-red-500">{paymentError}</p>}
                  <button
                    type="button"
                    onClick={handleSavePayment}
                    disabled={savingPayment || paymentSaved}
                    className="w-full rounded-xl bg-[#e0211a] hover:bg-[#a3140f] text-white font-semibold py-2.5 flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                  >
                    {savingPayment
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : paymentSaved
                        ? '✓ Pagamento registrado'
                        : selectedMethods.includes('Pix')
                          ? '📱 Gerar Pix'
                          : 'Salvar forma de pagamento'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {status !== 'em_pagamento' && !!request.payment_methods?.length && (
            <section className="space-y-2">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pagamento</h3>
              <div className="bg-slate-50 rounded-2xl p-4 space-y-1">
                {!!request.discount_percent && <p className="text-sm text-gray-600">Desconto aplicado: {request.discount_percent}%</p>}
                {request.payment_methods.map((p) => (
                  <p key={p.method} className="text-sm text-gray-700 flex justify-between">
                    <span>{p.method}</span>
                    <span className="font-semibold">R$ {Number(p.value).toFixed(2)}</span>
                  </p>
                ))}
              </div>
            </section>
          )}

          {['completed', 'em_pagamento', 'em_entrega', 'delivered', 'finished'].includes(status) && (
            <button
              type="button"
              disabled={generatingPdf}
              onClick={handleGeneratePdf}
              className="w-full rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600 flex items-center justify-center gap-2 hover:border-[#e0211a] hover:text-[#e0211a] transition-colors"
            >
              {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Gerar / baixar PDF da OS
            </button>
          )}

          <section className="space-y-3 pt-2 border-t border-gray-100">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Status do atendimento</h3>

            <div className="bg-slate-50 rounded-2xl p-4">
              <p className="text-xs text-gray-400 mb-1">Status atual</p>
              <p className="font-semibold text-gray-900">{STATUS_LABELS[status] ?? status}</p>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {advance.type !== 'terminal' && advance.type !== 'diagnostic' && !advance.ready && advance.blockedMessage && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">{advance.blockedMessage}</p>
            )}

            {advance.type === 'diagnostic' && (
              <div className="space-y-2">
                <label className="block text-xs text-gray-500 mb-1">Valor final do orçamento (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quoteValue}
                  onChange={(e) => setQuoteValue(e.target.value)}
                  placeholder="0,00"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#e0211a]"
                />
                <button
                  type="button"
                  onClick={() => handleAdvance('diagnostico_enviado')}
                  disabled={loading || !quoteValue}
                  className="w-full rounded-xl bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-50 text-white font-semibold py-2.5 flex items-center justify-center gap-2 transition-all"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ArrowRight className="w-4 h-4" /> Enviar orçamento pro cliente</>}
                </button>
              </div>
            )}

            {advance.type === 'single' && (
              <button
                onClick={() => handleAdvance(advance.next)}
                disabled={loading || !advance.ready}
                className={`w-full rounded-xl text-white font-semibold py-2.5 flex items-center justify-center gap-2 transition-all disabled:opacity-50
                  ${saved ? 'bg-green-600' : 'bg-[#e0211a] hover:bg-[#a3140f]'}`}
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
                ) : saved ? (
                  '✓ Status atualizado!'
                ) : (
                  <><ArrowRight className="w-4 h-4" /> {advance.label}</>
                )}
              </button>
            )}

            {advance.type === 'choice' && (
              <div className="space-y-2">
                {advance.options.map((opt) => (
                  <button
                    key={opt.next}
                    onClick={() => handleAdvance(opt.next)}
                    disabled={loading || !advance.ready}
                    className="w-full rounded-xl bg-[#e0211a] hover:bg-[#a3140f] text-white font-semibold py-2.5 flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : opt.label}
                  </button>
                ))}
              </div>
            )}

            {(status === 'pending' || status === 'retirada_local' || status === 'em_busca') && (
              <button
                onClick={() => handleAdvance('cancelled')}
                disabled={loading}
                className="w-full text-sm font-medium text-red-600 border border-red-200 rounded-xl py-2 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                Recusar / cancelar solicitação
              </button>
            )}
          </section>

          <p className="text-xs text-gray-400 text-center pb-2">Solicitado em {new Date(request.created_at).toLocaleString('pt-BR')}</p>
        </div>
      </div>

      {pixDialog && <PixQrDialog state={pixDialog} onClose={() => setPixDialog(null)} />}
    </div>
  )
}
