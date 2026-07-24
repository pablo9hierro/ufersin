// Cloudflare Pages Function — porta de frontend/api/upload-image.ts.
// Recebe os bytes crus da imagem, confirma que quem está mandando é um
// admin de verdade (via RPC sunset.admin_ping, mesma sessão que o resto do
// app usa) e só então grava no Supabase Storage usando a service_role key
// — que nunca sai daqui, o navegador nunca a vê.
import type { Env } from './_supabase'

const BUCKET = 'sunset-products'
const MAX_BYTES = 10 * 1024 * 1024

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context
  const supabaseUrl = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Supabase não configurado no servidor (faltam envs no Cloudflare Pages).' }, 500)
  }

  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) {
    return json({ error: 'Sessão de admin ausente.' }, 401)
  }

  // Valida a sessão de admin via RPC — sem isso qualquer um poderia usar
  // essa rota pra escrever no bucket com a service_role key. Usa a ANON
  // key aqui (não a service_role): admin_ping já é SECURITY DEFINER e já é
  // GRANT'd pra anon, e o service_role nunca recebeu GRANT USAGE no schema
  // "sunset" neste projeto (só anon/authenticated) — usar a service_role
  // key só dava "permission denied for schema sunset" (42501), sem
  // relação nenhuma com a sessão em si. Content-Profile é OBRIGATÓRIO:
  // sem ele o PostgREST procura a função em "public" (padrão), não em
  // "sunset" — supabase-js faz isso sozinho via `db.schema`, fetch() cru não.
  const pingRes = await fetch(`${supabaseUrl}/rest/v1/rpc/admin_ping`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'sunset',
    },
    body: JSON.stringify({ p_token: token }),
  })
  if (!pingRes.ok) {
    const body = await pingRes.text().catch(() => '')
    // 404/PGRST202 = a função sunset.admin_ping ainda não existe no banco
    // (falta rodar supabase/sunset_admin_ping.sql).
    if (pingRes.status === 404 || body.includes('PGRST202') || body.includes('function sunset.admin_ping')) {
      return json({ error: 'RPC sunset.admin_ping não existe no Supabase ainda — rode supabase/sunset_admin_ping.sql no SQL Editor.' }, 401)
    }
    // P0001 + "unauthorized" = _require_admin rejeitou o token de verdade
    // (sessão expirada/inválida). Qualquer OUTRA coisa (apikey errada,
    // RLS, erro de rede etc.) não devia virar essa mensagem — mostra o
    // corpo cru pra dar pra diagnosticar de verdade em vez de adivinhar.
    if (body.includes('"unauthorized"')) {
      return json({ error: 'Sessão de admin inválida ou expirada — faça login novamente.' }, 401)
    }
    return json({ error: `Falha ao validar sessão (HTTP ${pingRes.status}): ${body.slice(0, 300) || 'sem corpo'}` }, 401)
  }

  const contentType = request.headers.get('content-type') ?? 'application/octet-stream'
  const ext = EXT_BY_TYPE[contentType]
  if (!ext) {
    return json({ error: `Tipo de arquivo não suportado: ${contentType}` }, 400)
  }

  const bytes = await request.arrayBuffer()
  if (bytes.byteLength === 0) {
    return json({ error: 'Arquivo vazio.' }, 400)
  }
  if (bytes.byteLength > MAX_BYTES) {
    return json({ error: 'Arquivo grande demais (máx 10MB).' }, 413)
  }

  const filename = `${crypto.randomUUID()}.${ext}`
  const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${filename}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: bytes,
  })

  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '')
    const parsed = (() => {
      try {
        return JSON.parse(body)?.message as string | undefined
      } catch {
        return undefined
      }
    })()
    const message =
      uploadRes.status === 404
        ? `Bucket "${BUCKET}" não existe no Supabase Storage.`
        : uploadRes.status === 401 || uploadRes.status === 403
          ? 'Supabase recusou a chave de serviço (SUPABASE_SERVICE_ROLE_KEY inválida ou sem permissão no Storage).'
          : parsed || `Supabase Storage recusou o upload (HTTP ${uploadRes.status}).`
    return json({ error: message }, 502)
  }

  return json({ url: `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${filename}` }, 200)
}
