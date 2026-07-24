// Cloudflare Pages Function — porta de frontend/api/pix-simulate.ts. Botão
// "(ambiente de teste) simular pagamento aprovado" do Pagamento.tsx. Só
// funciona em modo mock (sem ABACATEPAY_API_KEY) — com uma chave real
// configurada, fica desabilitado de propósito pra não confirmar pagamento
// que não aconteceu de verdade.
import { callRpc, json, getEnv, type Env } from './_supabase'

interface OrderData {
  payment_method: string
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context
  if (env.ABACATEPAY_API_KEY) {
    return json({ error: 'Uma ABACATEPAY_API_KEY real está configurada — simulação desabilitada.' }, 403)
  }

  const { supabaseUrl, anonKey } = getEnv(env)
  if (!supabaseUrl || !anonKey) {
    return json({ error: 'Supabase não configurado no servidor (faltam envs no Cloudflare Pages).' }, 500)
  }

  let orderId: string | undefined
  try {
    orderId = (await request.json())?.order_id
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
  if (order.payment_method !== 'pix') {
    return json({ error: 'Pedido não é pagamento via Pix.' }, 400)
  }

  try {
    const updated = await callRpc(supabaseUrl, anonKey, 'confirm_pix_payment', { p_order_id: orderId })
    return json(updated, 200)
  } catch (err) {
    return json({ error: `Não foi possível confirmar o pagamento: ${String(err)}` }, 500)
  }
}
