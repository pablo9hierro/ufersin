import { tenantHasOnlinePix } from '../../lib/tenantConfig'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '../../lib/tenantRouter'
import { Check, Copy, Loader2, PartyPopper } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { orderService } from '../../services/orderService'
import type { Order } from '../../types'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'

// Tela de Pix -- gera a cobrança na primeira visita (se ainda não
// existir), mostra QR/código copia-e-cola, faz polling do status a cada
// 4s até `payment_status === 'pago'`. Mesma lógica exata do Sunset
// (services/orderService.ts), só reapresentada.
export default function Uiux2Pagamento() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const tenantConfig = useTenantConfig()
  const onlinePix = tenantHasOnlinePix(tenantConfig)
  const [order, setOrder] = useState<Order | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!orderId) return
    try {
      const updated = await orderService.refreshPayment(orderId)
      setOrder(updated)
    } catch {
      // ignora erro de polling, tenta de novo no próximo ciclo
    }
  }, [orderId])

  useEffect(() => {
    if (!orderId) return
    if (tenantConfig && !onlinePix) {
      navigate(`/consultar?order=${orderId}`, { replace: true })
      return
    }
    orderService.get(orderId).then(async (o) => {
      if (onlinePix && o.payment_method === 'pix' && o.payment_status !== 'pago' && !o.pix_copia_cola) {
        try {
          o = await orderService.createPixPayment(orderId)
        } catch {
          // deixa a tela mostrar "QR indisponível"
        }
      }
      setOrder(o)
      setLoading(false)
    })
  }, [orderId, onlinePix, tenantConfig, navigate])

  useEffect(() => {
    if (!order || order.payment_status === 'pago') return
    const interval = setInterval(refresh, 4000)
    return () => clearInterval(interval)
  }, [order, refresh])

  const handleCopy = () => {
    if (!order?.pix_copia_cola) return
    navigator.clipboard.writeText(order.pix_copia_cola)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSimulate = async () => {
    if (!orderId) return
    try {
      const updated = await orderService.simulatePixPaid(orderId)
      setOrder(updated)
    } catch {
      // endpoint só existe em ambiente mock
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin u2-oncanvas-accent" />
        </div>
      </Shell>
    )
  }

  if (!order) {
    return (
      <Shell>
        <p className="text-center u2-dim py-20">Pedido não encontrado.</p>
      </Shell>
    )
  }

  const paid = order.payment_status === 'pago'

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-20 max-w-sm mx-auto text-center">
        {paid ? (
          <div className="py-10">
            <PartyPopper className="w-14 h-14 u2-accent mx-auto mb-4" />
            <h1 className="text-xl font-black mb-2">Pagamento confirmado!</h1>
            <p className="u2-dim mb-8">Seu pedido já está sendo preparado. Você vai receber atualizações pelo WhatsApp.</p>
            <Link to={`/consultar?order=${order.id}`} className="u2-btn-primary inline-flex px-6 py-3">
              Acompanhar pedido
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-black mt-4 mb-1">Pague com Pix</h1>
            <p className="u2-dim text-sm mb-6">Escaneie o QR code ou copie o código abaixo.</p>

            <div className="bg-white rounded-2xl p-4 inline-block mb-6">
              {order.pix_copia_cola ? <QRCodeSVG value={order.pix_copia_cola} size={224} /> : <div className="w-56 h-56 flex items-center justify-center text-gray-400 text-sm">QR indisponível</div>}
            </div>

            <p className="u2-accent font-black text-2xl mb-6">{currency(order.total)}</p>

            {order.pix_copia_cola && (
              <button onClick={handleCopy} className="u2-btn-secondary w-full mb-4 text-sm py-3 flex items-center justify-center gap-2">
                {copied ? <Check className="w-4 h-4 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
                {copied ? 'Copiado!' : 'Copiar código Pix'}
              </button>
            )}

            <div className="flex items-center justify-center gap-2 text-xs u2-dim mb-6">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Aguardando confirmação do pagamento...
            </div>

            <button onClick={handleSimulate} className="text-xs u2-dim underline">
              (ambiente de teste) simular pagamento aprovado
            </button>
          </>
        )}
      </div>
    </Shell>
  )
}
