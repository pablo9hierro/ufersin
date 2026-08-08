import { tenantHasOnlinePix, tenantUsesManualPayment } from '../../lib/tenantConfig'
import { useEffect, useMemo, useState } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { Copy, GripVertical, Loader2, MapPin, Package, QrCode, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { StatusBadge } from '../../components/ui/Badge'
import Card from '../../components/ui/Card'
import WhatsAppLink from '../../components/ui/WhatsAppLink'
import { ApiError } from '../../lib/apiError'
import { planoAtLeast } from '../../lib/demoMode'
import { adminService } from '../../services/adminService'
import { orderService } from '../../services/orderService'
import { pdvService } from '../../services/pdvService'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { adminCanCancelOrder, type Order, type PaymentMethod } from '../../types'
import CashAmountInput from '../../components/CashAmountInput'
import { cashCoversTotal, formatCashMask, formatTrocoLabel, computeTroco } from '../../lib/cashMask'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

const BASE_FILTERS = [
  { value: 'pendente', label: 'Pendentes' },
  { value: 'montando_pedido', label: 'Montando' },
  { value: 'pedido_pronto', label: 'Prontos' },
  { value: 'retiradas', label: 'Retiradas' },
] as const

const ENTREGAS_FILTER = { value: 'entregas', label: 'Entregas' } as const
const CONCLUIDO_FILTER = { value: 'concluido', label: 'Concluídos' } as const
const CANCELADO_FILTER = { value: 'cancelado', label: 'Cancelados' } as const

type FilterValue =
  | (typeof BASE_FILTERS)[number]['value']
  | typeof ENTREGAS_FILTER.value
  | typeof CONCLUIDO_FILTER.value
  | typeof CANCELADO_FILTER.value

const ADMIN_CANCEL_REASONS = ['A pedido do cliente', 'Outro'] as const

/** Essential (no Motoboy): delivery prontos go to admin Entregas.
 *  Management/Premium: delivery stays for the motoboy queue. */
function nextStatusFor(order: Order, adminDelivery: boolean): string | null {
  switch (order.status) {
    case 'pendente':
      return 'montando_pedido'
    case 'montando_pedido':
      return 'pedido_pronto'
    case 'pedido_pronto':
      if (order.delivery_type === 'retirada') return 'retiradas'
      if (order.delivery_type === 'entrega' && adminDelivery) return 'entregas'
      return null
    case 'retiradas':
      return 'concluido'
    case 'entregas':
      return 'concluido'
    default:
      return null
  }
}

const NEXT_LABEL: Record<string, string> = {
  pendente: 'Montar pedido',
  montando_pedido: 'Marcar pronto',
  pedido_pronto: 'Pronto pra retirada',
  retiradas: 'Concluir retirada',
  entregas: 'Marcar entregue',
}

function OrderCard({
  order,
  busyId,
  advance,
  onCancel,
  manualPaymentMode,
  adminDelivery,
  payAtPickupMode,
}: {
  order: Order
  busyId: string | null
  advance: (order: Order, requirePayment: boolean) => void
  onCancel: (order: Order) => void
  manualPaymentMode: boolean
  adminDelivery: boolean
  payAtPickupMode: boolean
}) {
  const dragControls = useDragControls()
  const next = nextStatusFor(order, adminDelivery)
  const canAdvance = !!next
  const canCancel = adminCanCancelOrder(order.status)
  const settleAtPickup =
    payAtPickupMode &&
    order.status === 'retiradas' &&
    order.delivery_type === 'retirada' &&
    order.payment_status !== 'pago'
  const requiresPaymentConfirm =
    !settleAtPickup &&
    order.payment_status !== 'pago' &&
    (manualPaymentMode ||
      ((order.status === 'retiradas' || order.status === 'entregas') && order.payment_method !== 'pix'))

  const actionLabel =
    order.status === 'pedido_pronto' && order.delivery_type === 'entrega' && adminDelivery
      ? 'Pronto pra entrega'
      : settleAtPickup
        ? 'Dar baixa / finalizar venda'
        : NEXT_LABEL[order.status]

  return (
    <Reorder.Item value={order} dragListener={false} dragControls={dragControls}>
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <GripVertical
            onPointerDown={(e) => dragControls.start(e)}
            className="w-4 h-4 text-son-silver-dim flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
          />
          <span className="text-xs text-son-silver-dim flex-1">#{order.id.slice(0, 8)}</span>
          <StatusBadge status={order.status} />
        </div>
        <p className="text-xs text-son-gold mb-1">
          Origem: {order.sold_by_role ? `PDV ${order.sold_by_role === 'admin' ? 'admin' : `— ${order.sold_by_name ?? 'vendedor'}`}` : 'Site'}
        </p>
        <p className="font-semibold text-white">{order.customer_name}</p>
        <p className="mb-2">
          <WhatsAppLink phone={order.customer_whatsapp} />
        </p>
        <ul className="text-sm text-son-silver space-y-0.5 mb-2">
          {order.items.map((item) => (
            <li key={item.product_id}>
              {item.quantity}x {item.product_name}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-son-silver-dim">
            {order.delivery_type === 'retirada' ? 'Retirada' : `Entrega · ${order.neighborhood}`} · {order.payment_method}
            {order.payment_status !== 'pago' ? ' · pendente' : ''}
          </span>
          <span className="sunset-text font-bold">{currency(order.total)}</span>
        </div>
        {order.delivery_type === 'entrega' && order.customer_lat != null && order.customer_lng != null && (
          <div className="flex items-center justify-between gap-2 mb-2">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${order.customer_lat},${order.customer_lng}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-son-pink hover:underline flex-shrink-0"
            >
              <MapPin className="w-3.5 h-3.5" /> Abrir no Google Maps
            </a>
            {order.reference_point && (
              <p className="text-xs text-son-silver-dim italic text-right">{order.reference_point}</p>
            )}
          </div>
        )}
        {order.delivery_type === 'entrega' && (order.customer_lat == null || order.customer_lng == null) && order.reference_point && (
          <p className="text-xs text-son-silver-dim italic mb-2">{order.reference_point}</p>
        )}
        {order.status === 'cancelado' && (
          <p className="text-xs text-red-400 mb-2">
            Cancelado{order.cancel_by === 'cliente' ? ' pelo cliente' : ' pela loja'}
            {order.cancel_reason ? ` — ${order.cancel_reason}` : ''}
            {order.refund_status === 'refunded'
              ? ' · Pix estornado'
              : order.payment_status === 'pago' || order.refund_status === 'not_applicable'
                ? ' · Sem estorno automático (acerte devolução manualmente se já recebeu)'
                : ''}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {canAdvance && (
            <button
              onClick={() => advance(order, settleAtPickup || requiresPaymentConfirm)}
              disabled={busyId === order.id}
              className="btn-secondary w-full text-sm py-2"
            >
              {busyId === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {actionLabel}
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => onCancel(order)}
              disabled={busyId === order.id}
              className="w-full text-sm py-2 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              Cancelar pedido
            </button>
          )}
        </div>
        {order.status === 'pedido_pronto' && order.delivery_type === 'entrega' && !adminDelivery && (
          <p className="text-xs text-son-silver-dim text-center mt-2">Aguardando motoboy</p>
        )}
      </Card>
    </Reorder.Item>
  )
}

export default function AdminPedidos() {
  const tenantConfig = useTenantConfig()
  const manualPaymentMode = tenantUsesManualPayment(tenantConfig)
  const onlinePix = tenantHasOnlinePix(tenantConfig)
  const payAtPickupMode = !!tenantConfig?.pagamento_na_retirada
  const adminDelivery = !planoAtLeast(tenantConfig?.plano ?? 'essential', 'management')
  const filters = useMemo(
    () =>
      adminDelivery
        ? [...BASE_FILTERS, ENTREGAS_FILTER, CONCLUIDO_FILTER, CANCELADO_FILTER]
        : [...BASE_FILTERS, CONCLUIDO_FILTER, CANCELADO_FILTER],
    [adminDelivery]
  )

  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState<FilterValue>('pendente')
  const [loading, setLoading] = useState(true)
  const [confirmingOrder, setConfirmingOrder] = useState<Order | null>(null)
  const [settlingOrder, setSettlingOrder] = useState<Order | null>(null)
  const [settleMethod, setSettleMethod] = useState<PaymentMethod>('pix')
  const [settleName, setSettleName] = useState('')
  const [settleWhatsapp, setSettleWhatsapp] = useState('')
  const [skipQrcode, setSkipQrcode] = useState(false)
  const [confirmReceived, setConfirmReceived] = useState(false)
  const [settleCashCents, setSettleCashCents] = useState(0)
  const [confirmCashCents, setConfirmCashCents] = useState(0)
  const [pixOrder, setPixOrder] = useState<Order | null>(null)
  const [copiedPix, setCopiedPix] = useState(false)
  const [regeneratingPix, setRegeneratingPix] = useState(false)
  const [cancelingOrder, setCancelingOrder] = useState<Order | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [cancelReason, setCancelReason] = useState<(typeof ADMIN_CANCEL_REASONS)[number]>('A pedido do cliente')
  const [cancelNote, setCancelNote] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState<Order[]>([])

  const load = () => {
    setLoading(true)
    adminService.orders.list().then(setOrders).finally(() => setLoading(false))
  }

  useEffect(load, [])

  useEffect(() => {
    if (!adminDelivery && filter === 'entregas') setFilter('pendente')
  }, [adminDelivery, filter])

  useEffect(() => {
    setVisible(orders.filter((o) => o.status === filter))
  }, [orders, filter])

  useEffect(() => {
    if (!pixOrder || pixOrder.payment_status === 'pago') return
    const tick = async () => {
      try {
        const refreshed = await orderService.refreshPayment(pixOrder.id)
        setPixOrder(refreshed)
        if (refreshed.payment_status === 'pago') {
          await adminService.orders.updateStatus(refreshed.id, 'concluido')
          setPixOrder(null)
          setSettlingOrder(null)
          load()
        }
      } catch {
        /* keep polling */
      }
    }
    const interval = setInterval(tick, 4000)
    return () => clearInterval(interval)
  }, [pixOrder])

  const counts = Object.fromEntries(filters.map((f) => [f.value, orders.filter((o) => o.status === f.value).length]))

  const openSettlement = (order: Order) => {
    setSettlingOrder(order)
    setSettleMethod((order.payment_method as PaymentMethod) || 'pix')
    setSettleName(order.customer_name || '')
    const digits = order.customer_whatsapp?.replace(/\D/g, '') || ''
    const local = digits.startsWith('55') ? digits.slice(2) : digits
    setSettleWhatsapp(local ? formatPhone(local) : '')
    setSkipQrcode(!onlinePix)
    setConfirmReceived(false)
    setSettleCashCents(0)
    setError(null)
  }

  const advance = async (order: Order, requirePayment: boolean) => {
    const settleAtPickup =
      payAtPickupMode &&
      order.status === 'retiradas' &&
      order.delivery_type === 'retirada' &&
      order.payment_status !== 'pago'
    if (settleAtPickup) {
      openSettlement(order)
      return
    }
    if (requirePayment) {
      setConfirmCashCents(0)
      setConfirmingOrder(order)
      return
    }
    const next = nextStatusFor(order, adminDelivery)
    if (!next) return
    setError(null)
    setBusyId(order.id)
    try {
      await adminService.orders.updateStatus(order.id, next)
      if (next === 'pedido_pronto') {
        adminService.orders.notifyReady(order.id).catch(() => {})
      }
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível atualizar o pedido.')
    } finally {
      setBusyId(null)
    }
  }

  const confirmPayment = async () => {
    if (!confirmingOrder) return
    if (confirmingOrder.payment_method === 'dinheiro' && !cashCoversTotal(confirmCashCents, confirmingOrder.total)) {
      setError('Informe o valor recebido em dinheiro (maior ou igual ao total).')
      return
    }
    const next = nextStatusFor(confirmingOrder, adminDelivery)
    if (!next) return
    setError(null)
    setBusyId(confirmingOrder.id)
    try {
      await adminService.orders.updateStatus(confirmingOrder.id, next, true)
      setConfirmingOrder(null)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível confirmar o pagamento.')
    } finally {
      setBusyId(null)
    }
  }

  const settleExtras = () => {
    const waDigits = settleWhatsapp.replace(/\D/g, '')
    return {
      payment_method: settleMethod,
      customer_name: settleName.trim() || undefined,
      customer_whatsapp: waDigits ? `55${waDigits}` : undefined,
    }
  }

  const finalizeSettlement = async () => {
    if (!settlingOrder) return
    setError(null)
    setBusyId(settlingOrder.id)

    const extras = settleExtras()
    const usePixQr = settleMethod === 'pix' && onlinePix && !skipQrcode

    try {
      // Persist method + optional contact (stay on retiradas).
      await adminService.orders.updateStatus(settlingOrder.id, 'retiradas', undefined, extras)

      if (usePixQr) {
        let withPix = settlingOrder
        try {
          withPix = await orderService.createPixPayment(settlingOrder.id)
          if (!withPix.pix_copia_cola) throw new ApiError(502, 'Cobrança Pix sem QR / copia-e-cola.')
        } catch (e) {
          setError(
            e instanceof ApiError
              ? e.message
              : 'Não foi possível gerar o QR Pix. Marque cobrança manual ou tente de novo.',
          )
          return
        }
        setPixOrder(withPix)
        if (extras.customer_name && extras.customer_whatsapp) {
          pdvService.notifyPixCharge(withPix.id).catch(() => {})
        }
        return
      }

      if (!confirmReceived) {
        setError('Confirme que o pagamento foi recebido para finalizar.')
        return
      }
      if (settleMethod === 'dinheiro' && !cashCoversTotal(settleCashCents, settlingOrder.total)) {
        setError('Informe o valor recebido em dinheiro (maior ou igual ao total).')
        return
      }
      await adminService.orders.updateStatus(settlingOrder.id, 'concluido', true, extras)
      if (extras.customer_whatsapp) {
        pdvService.notifySale(settlingOrder.id).catch(() => {})
      }
      setSettlingOrder(null)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível finalizar a venda.')
    } finally {
      setBusyId(null)
    }
  }

  const regeneratePixCharge = async () => {
    if (!pixOrder) return
    setRegeneratingPix(true)
    setError(null)
    try {
      const withPix = await orderService.createPixPayment(pixOrder.id, true)
      if (!withPix.pix_copia_cola) throw new ApiError(502, 'Nova cobrança criada sem QR / copia-e-cola.')
      setPixOrder(withPix)
      if (withPix.customer_whatsapp?.replace(/\D/g, '')) {
        pdvService.notifyPixCharge(withPix.id).catch(() => {})
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível gerar nova cobrança Pix.')
    } finally {
      setRegeneratingPix(false)
    }
  }

  const copyPixCode = () => {
    if (!pixOrder?.pix_copia_cola) return
    navigator.clipboard.writeText(pixOrder.pix_copia_cola).then(() => {
      setCopiedPix(true)
      setTimeout(() => setCopiedPix(false), 2000)
    })
  }

  const openCancel = (order: Order) => {
    setCancelingOrder(order)
    setCancelConfirm(false)
    setCancelReason('A pedido do cliente')
    setCancelNote('')
    setError(null)
  }

  const submitCancel = async () => {
    if (!cancelingOrder || !cancelConfirm) return
    if (cancelReason === 'Outro' && !cancelNote.trim()) {
      setError('Informe a justificativa do cancelamento.')
      return
    }
    setError(null)
    setBusyId(cancelingOrder.id)
    try {
      await adminService.orders.cancel(
        cancelingOrder.id,
        cancelReason,
        cancelReason === 'Outro' ? cancelNote.trim() : undefined
      )
      setCancelingOrder(null)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar o pedido.')
    } finally {
      setBusyId(null)
    }
  }

  const confirmingIsEntrega = confirmingOrder?.status === 'entregas'
  const cancelPaidOnline =
    cancelingOrder?.payment_method === 'pix' &&
    cancelingOrder?.payment_status === 'pago' &&
    !!cancelingOrder?.pix_payment_id

  return (
    <div>
      <h1 className="text-2xl font-black mb-6">Pedidos</h1>

      {error && <p className="error-msg mb-4">{error}</p>}

      <div className="flex gap-2 overflow-x-auto pb-1 mb-6 scrollbar-hide">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              filter === f.value ? 'sunset-bg text-white' : 'bg-son-surface-light border border-white/5 text-son-silver hover:border-son-pink/30'
            }`}
          >
            {f.label} ({counts[f.value] ?? 0})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-son-silver-dim">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Nenhum pedido aqui.</p>
        </div>
      ) : (
        <Reorder.Group axis="y" values={visible} onReorder={setVisible} className="space-y-4">
          {visible.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              busyId={busyId}
              advance={advance}
              onCancel={openCancel}
              manualPaymentMode={manualPaymentMode}
              adminDelivery={adminDelivery}
              payAtPickupMode={payAtPickupMode}
            />
          ))}
        </Reorder.Group>
      )}

      {settlingOrder && !pixOrder && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !busyId && setSettlingOrder(null)}
        >
          <div className="glass rounded-2xl p-6 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-white">Finalizar retirada</h3>
                <p className="text-sm text-son-silver-dim">
                  Pedido #{settlingOrder.id.slice(0, 8)} ·{' '}
                  <span className="sunset-text font-bold">{currency(settlingOrder.total)}</span>
                </p>
              </div>
              <button type="button" onClick={() => setSettlingOrder(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <label className="label">Método de pagamento</label>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {(['pix', 'dinheiro', 'cartao'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSettleMethod(value)
                    if (value !== 'dinheiro') setSettleCashCents(0)
                  }}
                  className={`py-2.5 rounded-2xl border text-sm font-medium capitalize ${
                    settleMethod === value
                      ? 'sunset-bg text-white border-transparent'
                      : 'bg-son-surface border-white/10 text-son-silver hover:border-son-pink/30'
                  }`}
                >
                  {value === 'cartao' ? 'Cartão' : value === 'dinheiro' ? 'Dinheiro' : 'Pix'}
                </button>
              ))}
            </div>

            {settleMethod === 'dinheiro' && (
              <CashAmountInput
                className="mb-4"
                label="Valor recebido em dinheiro"
                orderTotal={settlingOrder.total}
                valueCents={settleCashCents}
                onChange={setSettleCashCents}
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="label">Nome cliente (opcional)</label>
                <input className="input-field" value={settleName} onChange={(e) => setSettleName(e.target.value)} placeholder="Nome" />
              </div>
              <div>
                <label className="label">WhatsApp (opcional)</label>
                <input
                  className="input-field"
                  value={settleWhatsapp}
                  onChange={(e) => setSettleWhatsapp(formatPhone(e.target.value))}
                  placeholder="(83) 99999-9999"
                  type="tel"
                  inputMode="numeric"
                />
              </div>
            </div>

            {settleMethod === 'pix' && (
              <label
                className={`mb-4 flex items-start gap-2.5 rounded-2xl border border-white/10 bg-son-surface px-3 py-2.5 ${
                  onlinePix ? 'cursor-pointer' : 'opacity-70'
                }`}
              >
                <input
                  type="checkbox"
                  checked={skipQrcode || !onlinePix}
                  disabled={!onlinePix}
                  onChange={(e) => setSkipQrcode(e.target.checked)}
                  className="mt-0.5 w-4 h-4"
                />
                <span className="text-xs text-son-silver-dim">
                  <QrCode className="w-3.5 h-3.5 inline mr-1" />
                  <span className="text-white font-semibold">Não gerar QR Code - cobrança manual</span>
                  <br />
                  {onlinePix
                    ? 'Se marcado, confirma o Pix recebido sem gerar cobrança na plataforma.'
                    : 'Loja em cobrança manual — Pix na retirada é confirmação sem QR de plataforma.'}
                </span>
              </label>
            )}

            {(settleMethod !== 'pix' || skipQrcode || !onlinePix) && (
              <label className="mb-4 flex items-start gap-2 text-sm text-son-silver cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmReceived}
                  onChange={(e) => setConfirmReceived(e.target.checked)}
                  className="rounded border-white/20 mt-0.5"
                />
                <span>
                  Confirmar pagamento recebido
                  {settleMethod === 'dinheiro' && settleCashCents > 0 && (
                    <span className="block text-xs text-son-silver-dim mt-1">
                      R$ {formatCashMask(settleCashCents)} · {formatTrocoLabel(computeTroco(settleCashCents, settlingOrder.total))}
                    </span>
                  )}
                </span>
              </label>
            )}

            <button
              type="button"
              onClick={finalizeSettlement}
              disabled={
                busyId === settlingOrder.id ||
                (settleMethod === 'dinheiro' && confirmReceived && !cashCoversTotal(settleCashCents, settlingOrder.total))
              }
              className="btn-primary w-full py-3"
            >
              {busyId === settlingOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Finalizar venda
            </button>
          </div>
        </div>
      )}

      {pixOrder && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div id="containerQrCobrança" className="glass rounded-2xl p-6 max-w-lg w-full text-center relative">
            <button
              type="button"
              onClick={() => {
                setPixOrder(null)
                setSettlingOrder(null)
                load()
              }}
              disabled={regeneratingPix}
              className="absolute top-3 right-3 text-son-silver-dim hover:text-white disabled:opacity-40"
              aria-label="Fechar cobrança Pix"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="font-bold text-white mb-1 pr-6">Pix da retirada</h3>
            <p className="text-sm text-son-silver-dim mb-4">
              Peça ao cliente para escanear o QR ou use o copia-e-cola.
              {pixOrder.customer_whatsapp?.replace(/\D/g, '')
                ? ' Enviamos o resumo e o código no WhatsApp informado.'
                : ''}{' '}
              A confirmação chega automaticamente quando o Pix for pago — aí o pedido vai para concluído.
            </p>
            <p className="sunset-text font-black text-xl mb-4">{currency(pixOrder.total)}</p>
            <div className="bg-white rounded-2xl p-4 inline-block mb-4">
              {pixOrder.pix_copia_cola ? (
                <QRCodeSVG value={pixOrder.pix_copia_cola} size={350} />
              ) : (
                <div className="w-[350px] h-[350px] flex items-center justify-center text-gray-400 text-sm">QR indisponível</div>
              )}
            </div>
            {pixOrder.pix_copia_cola && (
              <button type="button" onClick={copyPixCode} className="btn-secondary w-full mb-3 text-sm">
                <Copy className="w-4 h-4" />
                {copiedPix ? 'Copiado!' : 'Copiar Pix copia-e-cola'}
              </button>
            )}
            <button type="button" onClick={regeneratePixCharge} disabled={regeneratingPix} className="btn-secondary w-full text-sm">
              {regeneratingPix ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              Gerar nova cobrança
            </button>
          </div>
        </div>
      )}

      {confirmingOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmingOrder(null)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-white mb-2">
              {confirmingIsEntrega ? 'Confirmar pagamento e entrega' : 'Confirmar pagamento'}
            </h3>
            <p className="text-sm text-son-silver-dim mb-4">
              {confirmingIsEntrega ? (
                <>
                  Confirmar que o pedido foi entregue e o pagamento de{' '}
                  <span className="sunset-text font-bold">{currency(confirmingOrder.total)}</span> em{' '}
                  {confirmingOrder.payment_method === 'cartao' ? 'cartão' : confirmingOrder.payment_method} foi
                  recebido?
                </>
              ) : (
                <>
                  Confirmar pagamento de{' '}
                  <span className="sunset-text font-bold">{currency(confirmingOrder.total)}</span> em{' '}
                  {confirmingOrder.payment_method === 'cartao' ? 'cartão' : confirmingOrder.payment_method}?
                </>
              )}
            </p>
            {confirmingOrder.payment_method === 'dinheiro' && (
              <CashAmountInput
                className="mb-4"
                label="Valor recebido em dinheiro"
                orderTotal={confirmingOrder.total}
                valueCents={confirmCashCents}
                onChange={setConfirmCashCents}
              />
            )}
            {error && <p className="error-msg mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setConfirmingOrder(null)} className="btn-secondary flex-1">
                Voltar
              </button>
              <button
                onClick={confirmPayment}
                disabled={
                  busyId === confirmingOrder.id ||
                  (confirmingOrder.payment_method === 'dinheiro' && !cashCoversTotal(confirmCashCents, confirmingOrder.total))
                }
                className="btn-primary flex-1"
              >
                {busyId === confirmingOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelingOrder && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setCancelingOrder(null)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-white mb-2">Cancelar pedido</h3>
            <p className="text-sm text-son-silver-dim mb-4">
              Pedido #{cancelingOrder.id.slice(0, 8)} · {currency(cancelingOrder.total)}
            </p>

            <label className="flex items-center gap-2 text-sm text-son-silver mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={cancelConfirm}
                onChange={(e) => setCancelConfirm(e.target.checked)}
                className="rounded border-white/20"
              />
              Deseja cancelar este pedido?
            </label>

            <label className="block text-xs text-son-silver-dim mb-1">Motivo</label>
            <select
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value as (typeof ADMIN_CANCEL_REASONS)[number])}
              className="w-full mb-3 bg-son-surface-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
            >
              {ADMIN_CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            {cancelReason === 'Outro' && (
              <textarea
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                placeholder="Justificativa obrigatória"
                rows={3}
                className="w-full mb-3 bg-son-surface-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
              />
            )}

            {cancelPaidOnline && (
              <p className="text-xs text-son-silver-dim mb-4">
                {onlinePix && (cancelingOrder.pix_provider === 'mercado_pago' || !cancelingOrder.pix_provider)
                  ? 'Se o Pix foi cobrado online via Mercado Pago, o estorno total será tentado automaticamente antes de cancelar.'
                  : 'Pagamento online sem estorno automático via Mercado Pago — se você já recebeu o valor, acerte a devolução manualmente com o cliente.'}
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={() => setCancelingOrder(null)} className="btn-secondary flex-1">
                Voltar
              </button>
              <button
                onClick={submitCancel}
                disabled={!cancelConfirm || busyId === cancelingOrder.id}
                className="flex-1 py-2 rounded-xl bg-red-500/90 text-white text-sm font-semibold disabled:opacity-40"
              >
                {busyId === cancelingOrder.id ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
