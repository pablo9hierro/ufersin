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
      // sessionStorage (não localStorage): isolado por ABA, não por origin.
      // localStorage é compartilhado entre todas as abas — duas abas
      // logadas com tenants/roles diferentes ficavam brigando pelo mesmo
      // slot (a última a gravar "vencia" na outra aba), e o supabase-js
      // ainda propaga isso via evento `storage`, causando os redirects
      // piscando entre /dashboard, /meu-plano e /completar-conta. Com
      // sessionStorage cada aba tem sua própria sessão, sem vazar pra
      // nem ser afetada por nenhuma outra aba aberta.
      storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
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
  // Lê a key antiga de onde quer que ela esteja (localStorage — todo o
  // storage anterior a essa mudança gravava lá) e grava a nova SEMPRE em
  // sessionStorage, que é onde os clientes Supabase leem agora (isolado
  // por aba). Nunca deixar a migração "ressuscitar" uma sessão antiga em
  // localStorage — isso voltaria a vazar entre abas.
  const raw = localStorage.getItem(from)
  localStorage.removeItem(from)
  if (!raw) return
  if (!sessionStorage.getItem(to)) {
    sessionStorage.setItem(to, raw)
  }
}

/**
 * Migra keys antigas (localStorage, compartilhado entre abas) → namespace
 * `resolutoo_platform_*` em sessionStorage (isolado por aba).
 * Nunca toca `resolutoo_loja_*` / `sonset_*` (sessão do ecommerce).
 */
export function migrateLegacyAuthStorage() {
  if (typeof window === 'undefined' || !url) return
  try {
    moveKey(LEGACY_AUTH_STORAGE_KEYS.lojista, AUTH_STORAGE_KEYS.lojista)
    moveKey(LEGACY_AUTH_STORAGE_KEYS.superadmin, AUTH_STORAGE_KEYS.superadmin)
    // Uma key namespaced ainda em localStorage (de antes da mudança pra
    // sessionStorage) também precisa migrar, não só as legadas.
    moveKey(AUTH_STORAGE_KEYS.lojista, AUTH_STORAGE_KEYS.lojista)
    moveKey(AUTH_STORAGE_KEYS.superadmin, AUTH_STORAGE_KEYS.superadmin)

    const ref = new URL(url).hostname.split('.')[0]
    if (!ref) return
    const legacyKey = `sb-${ref}-auth-token`
    const raw = localStorage.getItem(legacyKey)
    localStorage.removeItem(legacyKey)
    if (!raw) return
    // Só move se nenhuma key de plataforma existir ainda nesta aba.
    if (sessionStorage.getItem(AUTH_STORAGE_KEYS.lojista) || sessionStorage.getItem(AUTH_STORAGE_KEYS.superadmin)) {
      return
    }
    // Sem whoami síncrono: assume lojista (maioria). Superadmin re-loga
    // uma vez se cair no slot errado — Login/sessionHome corrige.
    sessionStorage.setItem(AUTH_STORAGE_KEYS.lojista, raw)
  } catch {
    /* ignore */
  }
}

/** Remove só a key da role — nunca limpa namespace da loja. */
export function clearPlatformAuthKey(role: AuthRole) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEYS[role])
    localStorage.removeItem(AUTH_STORAGE_KEYS[role])
    localStorage.removeItem(LEGACY_AUTH_STORAGE_KEYS[role])
    // A key crua do supabase-js (formato padrão `sb-<ref>-auth-token`, de
    // antes do storageKey namespaced existir) precisa sumir também — senão
    // migrateLegacyAuthStorage() a ressuscita pro slot que acabou de ser
    // limpo assim que a página recarrega, e o logout "não pega".
    if (url) {
      const ref = new URL(url).hostname.split('.')[0]
      if (ref) localStorage.removeItem(`sb-${ref}-auth-token`)
    }
  } catch {
    /* ignore */
  }
}

migrateLegacyAuthStorage()
