import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** false = build sem as envs do Supabase (ex.: demo /loja embutida na
 * Rodoletas, que roda em modo local via USE_LOCAL_DB — ver api.ts). */
export const supabaseConfigured = Boolean(url && anonKey)

if (!supabaseConfigured) {
  console.warn(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configuradas — chamadas diretas ao Supabase vão falhar (cai em modo demonstração se USE_LOCAL_DB).'
  )
}

// createClient() joga "supabaseUrl is required" se a URL vier vazia e
// derruba o SPA inteiro (tela preta) — mesmo bug já corrigido no client
// Supabase da Rodoletas (frontend/src/lib/supabaseClient.ts). Placeholder
// inerte só pra o módulo carregar; nunca usado pra dado real quando
// !supabaseConfigured (ver USE_LOCAL_DB em api.ts).
//
// Schema dedicado do Ufersin dentro do mesmo projeto Supabase compartilhado
// — isolado dos schemas de outras lojas. O schema `sunset` (legado externo)
// nunca deve ser tocado por aqui; ver
// supabase-ufersin/0000_bootstrap_ufersin_schema.sql pra como o schema
// `ufersin` foi criado. Só mude via VITE_SUPABASE_SCHEMA se precisar
// apontar deliberadamente pra outro schema.
//
// Auth GoTrue desligada de propósito: staff da loja usa JWT Railway +
// Zustand (`sonset_admin_auth` etc.). Persistência Auth aqui cruzava a
// sessão da plataforma Resolutoo (mesmo projeto / mesma origin /loja).
export const supabase: SupabaseClient = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
  {
    db: { schema: import.meta.env.VITE_SUPABASE_SCHEMA || 'ufersin' },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'ufersin-loja-noauth',
    },
  },
)
