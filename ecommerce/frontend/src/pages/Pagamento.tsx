import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Copy, Loader2, PartyPopper } from 'lucide-react'
import { motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import SiteHeader from '../components/layout/SiteHeader'
import PageTransition from '../components/layout/PageTransition'
import { api } from '../lib/api'
import type { Order } from '../lib/types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

export default function Pagamento() {
  const { orderId } = useParams<{ orderId: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!orderId) return
    try {
      const updated = await api.orders.refreshPayment(orderId)
      setOrder(updated)
    } catch {
      // ignore polling error, tenta de novo no próximo ciclo
    }
  }, [orderId])

  useEffect(() => {
    if (!orderId) return
    api.orders.get(orderId).then(async (o) => {
      // Nada cria a cobrança Pix antes disso (nem o checkout, nem a RPC de
      // criar pedido) — na primeira vez que essa tela abre pra um pedido
      // Pix sem cobrança ainda, gera de verdade agora.
      if (o.payment_method === 'pix' && o.payment_status !== 'pago' && !o.pix_copia_cola) {
        try {
          o = await api.orders.createPixPayment(orderId)
        } catch {
          // deixa a tela mostrar "QR indisponível" — o polling de refresh
          // abaixo tenta de novo mais adiante se o usuário recarregar.
        }
      }
      setOrder(o)
      setLoading(false)
    })
  }, [orderId])

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
      const updated = await api.orders.simulatePixPaid(orderId)
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
        ) : (
          <>
            <h1 className="text-2xl font-black mt-6 mb-1">Pague com Pix</h1>
            <p className="text-son-silver-dim text-sm mb-6">Escaneie o QR code ou copie o código abaixo.</p>

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

            <button onClick={handleSimulate} className="text-xs text-son-silver-dim underline hover:text-white">
              (ambiente de teste) simular pagamento aprovado
            </button>
          </>
        )}
      </PageTransition>
    </main>
  )
}
