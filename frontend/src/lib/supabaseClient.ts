import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configuradas — login/cadastro do lojista vão falhar.')
}

// Mesmo projeto Supabase usado pelo motor de e-commerce (ver
// ecommerce/frontend/src/lib/supabaseClient.ts), mas este client só fala
// com `.auth` -- nunca lê/escreve tabela nenhuma direto, então não precisa
// (nem deve) apontar pra um schema específico como `ufersin`/`sunset`.
// `auth.users` é global ao projeto (ver ARQUITETURA.md §2b), por isso é
// seguro reaproveitar o mesmo projeto Supabase só pra autenticação do
// lojista sem vazar nada entre Sunset/VRTech/Ufersin.
export const supabase = createClient(url ?? '', anonKey ?? '')
