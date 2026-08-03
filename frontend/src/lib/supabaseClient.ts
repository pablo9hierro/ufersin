import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** false = build/deploy sem as envs do Supabase. Landing e páginas públicas
 * continuam renderizando; login/cadastro falham com mensagem clara. */
export const supabaseConfigured = Boolean(url && anonKey)

if (!supabaseConfigured) {
  console.warn(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configuradas — login/cadastro do lojista vão falhar. Configure no dashboard da Vercel (Project → Settings → Environment Variables).',
  )
}

export type AuthRole = 'lojista' | 'superadmin'

export const AUTH_STORAGE_KEYS = {
  lojista: 'resolutoo-auth-lojista',
  superadmin: 'resolutoo-auth-superadmin',
} as const

const placeholderUrl = url || 'https://placeholder.supabase.co'
const placeholderKey = anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder'

function makeClient(storageKey: string): SupabaseClient {
  return createClient(placeholderUrl, placeholderKey, {
    auth: {
      storageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}

/** Sessão do lojista — storage isolada do superadmin. */
export const supabaseLojista: SupabaseClient = makeClient(AUTH_STORAGE_KEYS.lojista)

/** Sessão do superadmin — storage isolada do lojista. */
export const supabaseSuperadmin: SupabaseClient = makeClient(AUTH_STORAGE_KEYS.superadmin)

/** Alias legado: aponta pro cliente lojista (cadastro, reset senha, RPC). */
export const supabase: SupabaseClient = supabaseLojista

export function clientForRole(role: AuthRole): SupabaseClient {
  return role === 'superadmin' ? supabaseSuperadmin : supabaseLojista
}

/** Migra a key default do GoTrue (`sb-<ref>-auth-token`) pra key role-scoped. */
export function migrateLegacyAuthStorage() {
  if (typeof window === 'undefined' || !url) return
  try {
    const ref = new URL(url).hostname.split('.')[0]
    if (!ref) return
    const legacyKey = `sb-${ref}-auth-token`
    const raw = localStorage.getItem(legacyKey)
    if (!raw) return
    // Só move se nenhuma key nova existir ainda.
    if (localStorage.getItem(AUTH_STORAGE_KEYS.lojista) || localStorage.getItem(AUTH_STORAGE_KEYS.superadmin)) {
      localStorage.removeItem(legacyKey)
      return
    }
    // Sem whoami síncrono: assume lojista (maioria dos usuários). Superadmin
    // re-loga uma vez se cair no slot errado — Login/sessionHome corrige.
    localStorage.setItem(AUTH_STORAGE_KEYS.lojista, raw)
    localStorage.removeItem(legacyKey)
  } catch {
    /* ignore */
  }
}

migrateLegacyAuthStorage()
