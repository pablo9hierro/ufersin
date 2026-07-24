import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configuradas — chamadas diretas ao Supabase vão falhar.'
  )
}

// Schema dedicado do Sunset dentro do mesmo projeto Supabase compartilhado
// com o VRTech — igual ao search_path isolado que o backend Rust usava.
export const supabase = createClient(url ?? '', anonKey ?? '', {
  db: { schema: 'sunset' },
})
