// Vercel Edge Function — cria a cobrança Pix (AbacatePay real, ou mock se
// ABACATEPAY_API_KEY não estiver configurada) pro pedido. Substitui
// create_pix_payment do backend Rust (Railway) — Pix agora depende só de
// Supabase + Vercel, Railway fica só com Evolution API/WhatsApp.
// Idempotente: se o pedido já tem cobrança, devolve como está.
export const config = { runtime: 'edge' }

import { callRpc, json, getEnv } from './_supabase'

const AC_BASE = 'https://api.abacatepay.com/v2'

interface OrderData {
  id: string
  payment_method: string
  payment_status: string
  pix_payment_id: string | null
  total: number
  customer_name: string
  customer_whatsapp: string
}

function fakeCopiaCola(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let chunk = ''
  for (let i = 0; i < 24; i++) chunk += chars[Math.floor(Math.random() * chars.length)]
  return `00020126580014BR.GOV.BCB.PIX0136${chunk}5204000053039865802BR5912SUNSET TABAS6009SAO PAULO62070503***6304ABCD`
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const { supabaseUrl, anonKey } = getEnv()
  if (!supabaseUrl || !anonKey) {
    return json({ error: 'Supabase não configurado no servidor (faltam envs na Vercel).' }, 500)
  }
  const abacateKey = process.env.ABACATEPAY_API_KEY

  let orderId: string | undefined
  try {
    orderId = (await req.json())?.order_id
  } catch {
    return json({ error: 'corpo da requisição inválido' }, 400)
  }
  if (!orderId) return json({ error: 'order_id é obrigatório' }, 400)

  let order: OrderData | null
  try {
    order = await callRpc<OrderData | null>(supabaseUrl, anonKey, 'get_order', { p_order_id: orderId })
  } catch {
    return json({ error: 'Pedido não encontrado.' }, 404)
  }
  // get_order devolve sucesso com corpo `null` (não um erro) quando o id
  // não bate com nenhum pedido — não é uma exceção pra pegar no catch acima.
  if (!order) return json({ error: 'Pedido não encontrado.' }, 404)
  if (order.payment_method !== 'pix') {
    return json({ error: 'Pedido não é pagamento via Pix.' }, 400)
  }
  if (order.pix_payment_id) {
    return json(order, 200)
  }

  let paymentId: string
  let copiaCola: string

  if (abacateKey) {
    const amountCentavos = Math.round(order.total * 100)
    const digits = (order.customer_whatsapp || '').replace(/\D/g, '')
    let resp: Response
    try {
      resp = await fetch(`${AC_BASE}/transparents/create`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${abacateKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountCentavos,
          description: 'Pedido Sunset Tabas',
          customer: { name: order.customer_name, cellphone: digits },
        }),
      })
    } catch (err) {
      return json({ error: `Não foi possível falar com a AbacatePay: ${String(err)}` }, 502)
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return json({ error: `AbacatePay recusou a cobrança (HTTP ${resp.status}): ${text.slice(0, 300)}` }, 502)
    }
    const parsed = (await resp.json().catch(() => null)) as { data?: { id?: string; brCode?: string }; error?: unknown } | null
    if (!parsed || parsed.error) {
      return json({ error: 'AbacatePay rejeitou a cobrança.' }, 502)
    }
    if (!parsed.data?.id || !parsed.data?.brCode) {
      return json({ error: 'Resposta da AbacatePay incompleta (faltou id ou brCode).' }, 502)
    }
    paymentId = parsed.data.id
    copiaCola = parsed.data.brCode
  } else {
    // Modo mock (sem ABACATEPAY_API_KEY) — só pra não travar o fluxo de
    // teste; o QR é renderizado no navegador a partir do copia-e-cola
    // (qrcode.react), não precisa gerar imagem nenhuma aqui.
    paymentId = `mock-${crypto.randomUUID()}`
    copiaCola = fakeCopiaCola()
  }

  try {
    const updated = await callRpc<OrderData>(supabaseUrl, anonKey, 'set_pix_charge', {
      p_order_id: orderId,
      p_payment_id: paymentId,
      p_qr_base64: null,
      p_copia_cola: copiaCola,
    })
    return json(updated, 200)
  } catch (err) {
    return json({ error: `Não foi possível salvar a cobrança: ${String(err)}` }, 500)
  }
}
