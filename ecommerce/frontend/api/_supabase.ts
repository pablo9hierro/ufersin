// Helper compartilhado pelas Edge Functions em api/ — NÃO é uma rota (o "_"
// no nome faz a Vercel ignorar este arquivo na hora de mapear api/*.ts pra
// endpoints). Content-Profile: sunset é obrigatório em toda chamada RPC:
// sem ele o PostgREST procura a função no schema "public" por padrão, não
// em "sunset" (onde tudo deste projeto realmente mora).
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

export function getEnv() {
  return {
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    anonKey: process.env.VITE_SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
}
