// Vercel Edge Function — chamada pelo trigger sunset_pix_paid_notify
// (pg_net) NA HORA que um pedido Pix vira 'pago', ou pela própria
// pix-check.ts como reforço. Só aciona o WhatsApp — que continua no
// Rust/Railway via Evolution API, de propósito (só isso fica lá).
// Best-effort: se o Railway estiver fora do ar, não derruba a confirmação
// de pagamento em si (que já aconteceu no Supabase antes disso ser chamado).
export const config = { runtime: 'edge' }

import { json } from './_supabase'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let orderId: string | undefined
  try {
    orderId = (await req.json())?.order_id
  } catch {
    return json({ error: 'corpo da requisição inválido' }, 400)
  }
  if (!orderId) return json({ error: 'order_id é obrigatório' }, 400)

  const apiBase = process.env.VITE_API_BASE_URL
  if (!apiBase) {
    return json({ ok: false, warning: 'VITE_API_BASE_URL não configurado — WhatsApp não enviado.' }, 200)
  }

  try {
    await fetch(`${apiBase}/api/orders/${orderId}/notify-payment-received`, { method: 'POST' })
  } catch (err) {
    // best-effort: pagamento já está confirmado no Supabase de qualquer
    // forma, só o aviso de WhatsApp que pode ter falhado (ex: Railway fora do ar).
    return json({ ok: false, warning: `Railway indisponível: ${String(err)}` }, 200)
  }

  return json({ ok: true }, 200)
}
