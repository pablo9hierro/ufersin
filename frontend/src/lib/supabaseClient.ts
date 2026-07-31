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

// createClient() joga "supabaseUrl is required" se a URL vier vazia e
// derruba o SPA inteiro (tela preta). Placeholder inerte só pra o módulo
// carregar; nunca use isso pra auth real.
export const supabase: SupabaseClient = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
)
