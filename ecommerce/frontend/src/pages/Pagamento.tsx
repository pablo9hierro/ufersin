import { tenantHasOnlinePix } from '../lib/tenantConfig'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '../lib/tenantRouter'
import { Check, Copy, Loader2, PartyPopper } from 'lucide-react'
import { motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import SiteHeader from '../components/layout/SiteHeader'
import PageTransition from '../components/layout/PageTransition'
import CardPaymentDialog from '../components/checkout/CardPaymentDialog'
import { useTenantConfig } from '../hooks/useTenantConfig'
import { orderService } from '../services/orderService'
import { ApiError } from '../lib/apiError'
import { useCustomerAuth } from '../store/customerAuth'
import type { Order } from '../types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

export default function Pagamento() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const tenantConfig = useTenantConfig()
  // Nome ficou de quando só existia Pix online, mas a checagem
  // (forma_pagamento === 'plataforma' && !pagamento_manual) já é genérica —
  // mesma conta Mercado Pago serve Pix e cartão, então reaproveita aqui.
  const onlineGateway = tenantHasOnlinePix(tenantConfig)
  const customerEmail = useCustomerAuth((s) => s.customer?.email ?? undefined)
  const customerWhatsapp = useCustomerAuth((s) => s.customer?.whatsapp)
  const [order, setOrder] = useState<Order | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pixError, setPixError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!orderId) return
    try {
      const updated = await orderService.refreshPayment(orderId)
      setOrder(updated)
    } catch {
      // ignore polling error, tenta de novo no próximo ciclo
    }
  }, [orderId])

  useEffect(() => {
    if (!orderId) return
    orderService.get(orderId).then(async (o) => {
      if (!onlineGateway || (o.payment_method !== 'pix' && o.payment_method !== 'cartao')) {
        navigate(`/consultar?order=${orderId}`, { replace: true })
        return
      }
      // Nada cria a cobrança Pix antes disso (nem o checkout, nem a RPC de
      // criar pedido) — na primeira vez que essa tela abre pra um pedido
      // Pix sem cobrança ainda, gera de verdade agora.
      if (o.payment_method === 'pix' && o.payment_status !== 'pago' && !o.pix_copia_cola) {
        try {
          o = await orderService.createPixPayment(orderId, false, customerEmail)
        } catch (e) {
          // Sem cobrança criada, o polling de refresh abaixo não tem o
          // que checar (não existe pix_payment_id ainda) — sem mostrar o
          // motivo aqui, a tela ficava com "QR indisponível" pra sempre e
          // sem nenhuma pista de por quê.
          setPixError(
            e instanceof ApiError ? e.message : 'Não foi possível gerar o QR Pix. Recarregue a página pra tentar de novo.',
          )
        }
      }
      setOrder(o)
      setLoading(false)
    })
  }, [orderId, onlineGateway, navigate, customerEmail])

  useEffect(() => {
    if (!order || order.payment_status === 'pago') return
    if (order.payment_method === 'cartao') return // CardPaymentDialog cuida do próprio fluxo
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
      // endpoint só funciona em modo mock; ignora se não disponível
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
      </main>
    )
  }

  if (!order) {
    return (
      <main className="min-h-screen text-white">
        <SiteHeader />
        <p className="text-center text-son-silver-dim py-20">Pedido não encontrado.</p>
      </main>
    )
  }

  const paid = order.payment_status === 'pago'

  return (
    <main className="min-h-screen text-white">
      <SiteHeader />
      <PageTransition className="max-w-md mx-auto px-5 sm:px-10 pb-20 text-center">
        {paid ? (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="py-10">
            <PartyPopper className="w-14 h-14 text-son-gold mx-auto mb-4" />
            <h1 className="text-2xl font-black mb-2">Pagamento confirmado!</h1>
            <p className="text-son-silver-dim mb-8">Seu pedido já está sendo preparado. Você vai receber atualizações pelo WhatsApp.</p>
            <Link to={`/consultar?order=${order.id}`} className="btn-primary inline-flex">
              Acompanhar pedido
            </Link>
          </motion.div>
        ) : order.payment_method === 'cartao' ? (
          <CardPaymentDialog
            orderId={order.id}
            amount={order.total}
            mode="checkout"
            onClose={() => navigate(`/consultar?order=${order.id}`)}
            onSuccess={(updated) => setOrder(updated)}
            autoSendWhatsapp={
              tenantConfig?.entrega_somente_pix && order.delivery_type === 'entrega' ? customerWhatsapp : undefined
            }
            onChangePaymentMethod={() => navigate('/checkout')}
            onCancelOrder={
              customerWhatsapp ? async () => { await orderService.cancel(order.id, customerWhatsapp) } : undefined
            }
          />
        ) : (
          <>
            <h1 className="text-2xl font-black mt-6 mb-1">Pague com Pix</h1>
            <p className="text-son-silver-dim text-sm mb-6">Escaneie o QR code ou copie o código abaixo.</p>

            {pixError && !order.pix_copia_cola && <p className="error-msg mb-4">{pixError}</p>}
            <div className="bg-white rounded-2xl p-4 inline-block mb-6">
              {order.pix_copia_cola ? (
                <QRCodeSVG value={order.pix_copia_cola} size={224} />
              ) : (
                <div className="w-56 h-56 flex items-center justify-center text-gray-400 text-sm">QR indisponível</div>
              )}
            </div>

            <p className="sunset-text font-black text-2xl mb-6">{currency(order.total)}</p>

            {order.pix_copia_cola && (
              <button onClick={handleCopy} className="btn-secondary w-full mb-4 text-sm break-all">
                {copied ? <Check className="w-4 h-4 flex-shrink-0" /> : <Copy className="w-4 h-4 flex-shrink-0" />}
                {copied ? 'Copiado!' : 'Copiar código Pix'}
              </button>
            )}

            <div className="flex items-center justify-center gap-2 text-xs text-son-silver-dim mb-6">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Aguardando confirmação do pagamento...
            </div>

            {!onlineGateway && (
              <button onClick={handleSimulate} className="text-xs text-son-silver-dim underline hover:text-white">
                (ambiente de teste) simular pagamento aprovado
              </button>
            )}
          </>
        )}
      </PageTransition>
    </main>
  )
}
