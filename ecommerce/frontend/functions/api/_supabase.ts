// Helper compartilhado pelas Cloudflare Pages Functions em functions/api/ —
// NÃO é uma rota (o "_" no nome faz o Cloudflare Pages ignorar este arquivo
// na hora de mapear functions/api/*.ts pra endpoints, mesma convenção da
// Vercel). Equivalente a frontend/api/_supabase.ts (Vercel Edge Function),
// só que lendo env de `context.env` em vez de `process.env` — Cloudflare
// Workers não tem `process.env` global, as bindings vêm por parâmetro.

export interface Env {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  ABACATEPAY_API_KEY?: string
  VITE_API_BASE_URL?: string
}

export async function callRpc<T = unknown>(
  supabaseUrl: string,
  apiKey: string,
  name: string,
  params: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'sunset',
    },
    body: JSON.stringify(params),
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // corpo não é JSON — segue com data = null, o texto cru vira a mensagem de erro abaixo
  }
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : null) ||
      text ||
      `RPC ${name} falhou (HTTP ${res.status})`
    throw new Error(message)
  }
  return data as T
}

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function getEnv(env: Env) {
  return {
    supabaseUrl: env.VITE_SUPABASE_URL,
    anonKey: env.VITE_SUPABASE_ANON_KEY,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  }
}
