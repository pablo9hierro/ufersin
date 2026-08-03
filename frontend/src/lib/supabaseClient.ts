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

/** Namespace da plataforma Resolutoo — NUNCA reutilizar no ecommerce /loja. */
export const AUTH_STORAGE_KEYS = {
  lojista: 'resolutoo_platform_auth_lojista',
  superadmin: 'resolutoo_platform_auth_superadmin',
} as const

/** Chaves legadas (pré-namespace) — migradas uma vez no boot. */
const LEGACY_AUTH_STORAGE_KEYS = {
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
      // local only — logout nunca invalida outras abas/apps na mesma origin
      // via refresh-token revoke global.
    },
  })
}

/** Sessão do lojista — storage isolada do superadmin e do /loja admin. */
export const supabaseLojista: SupabaseClient = makeClient(AUTH_STORAGE_KEYS.lojista)

/** Sessão do superadmin — storage isolada do lojista e do /loja admin. */
export const supabaseSuperadmin: SupabaseClient = makeClient(AUTH_STORAGE_KEYS.superadmin)

/** Alias legado: aponta pro cliente lojista (cadastro, reset senha, RPC). */
export const supabase: SupabaseClient = supabaseLojista

export function clientForRole(role: AuthRole): SupabaseClient {
  return role === 'superadmin' ? supabaseSuperadmin : supabaseLojista
}

function moveKey(from: string, to: string) {
  const raw = localStorage.getItem(from)
  if (!raw) return
  if (!localStorage.getItem(to)) {
    localStorage.setItem(to, raw)
  }
  localStorage.removeItem(from)
}

/**
 * Migra keys antigas → namespace `resolutoo_platform_*`.
 * Nunca toca `resolutoo_loja_*` / `sonset_*` (sessão do ecommerce).
 */
export function migrateLegacyAuthStorage() {
  if (typeof window === 'undefined' || !url) return
  try {
    moveKey(LEGACY_AUTH_STORAGE_KEYS.lojista, AUTH_STORAGE_KEYS.lojista)
    moveKey(LEGACY_AUTH_STORAGE_KEYS.superadmin, AUTH_STORAGE_KEYS.superadmin)

    const ref = new URL(url).hostname.split('.')[0]
    if (!ref) return
    const legacyKey = `sb-${ref}-auth-token`
    const raw = localStorage.getItem(legacyKey)
    if (!raw) return
    // Só move se nenhuma key de plataforma existir ainda.
    if (localStorage.getItem(AUTH_STORAGE_KEYS.lojista) || localStorage.getItem(AUTH_STORAGE_KEYS.superadmin)) {
      localStorage.removeItem(legacyKey)
      return
    }
    // Sem whoami síncrono: assume lojista (maioria). Superadmin re-loga
    // uma vez se cair no slot errado — Login/sessionHome corrige.
    localStorage.setItem(AUTH_STORAGE_KEYS.lojista, raw)
    localStorage.removeItem(legacyKey)
  } catch {
    /* ignore */
  }
}

/** Remove só a key da role — nunca limpa namespace da loja. */
export function clearPlatformAuthKey(role: AuthRole) {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(AUTH_STORAGE_KEYS[role])
    localStorage.removeItem(LEGACY_AUTH_STORAGE_KEYS[role])
  } catch {
    /* ignore */
  }
}

migrateLegacyAuthStorage()
