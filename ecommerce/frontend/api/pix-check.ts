// Vercel Edge Function — confere o status de uma cobrança Pix na AbacatePay
// e confirma o pagamento no Supabase se já foi pago. Chamada tanto pelo
// polling do navegador (Pagamento.tsx) quanto pelo cron de backstop do
// Supabase (sunset_pix_backstop) — funciona igual pros dois casos.
export const config = { runtime: 'edge' }

import { callRpc, json, getEnv } from './_supabase'

const AC_BASE = 'https://api.abacatepay.com/v2'

interface OrderData {
  id: string
  payment_method: string
  payment_status: string
  pix_payment_id: string | null
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
  if (!order) return json({ error: 'Pedido não encontrado.' }, 404)

  // Nada a checar: não é pix, já está pago, cobrança ainda não criada, ou
  // modo mock (sem chave — pagamento mock só confirma via botão "simular").
  if (order.payment_method !== 'pix' || order.payment_status === 'pago' || !order.pix_payment_id || !abacateKey) {
    return json(order, 200)
  }

  let resp: Response
  try {
    resp = await fetch(`${AC_BASE}/transparents/check?id=${encodeURIComponent(order.pix_payment_id)}`, {
      headers: { Authorization: `Bearer ${abacateKey}` },
    })
  } catch {
    return json(order, 200) // AbacatePay fora do ar não deve quebrar o polling
  }
  if (!resp.ok) return json(order, 200)

  const parsed = (await resp.json().catch(() => null)) as { data?: { status?: string } } | null
  const status = parsed?.data?.status ?? 'PENDING'

  if (status === 'PAID') {
    try {
      const updated = await callRpc<OrderData>(supabaseUrl, anonKey, 'confirm_pix_payment', { p_order_id: orderId })
      return json(updated, 200)
    } catch (err) {
      return json({ error: `Não foi possível confirmar o pagamento: ${String(err)}` }, 500)
    }
  }

  return json(order, 200)
}
