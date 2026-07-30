import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configuradas — chamadas diretas ao Supabase vão falhar.'
  )
}

// Schema dedicado do Ufersin dentro do mesmo projeto Supabase compartilhado
// com VRTech/Sunset — isolado dos dois, igual ao search_path isolado que o
// backend Rust usa pro Sunset. `sunset` é a Sunset Tabas de produção de
// verdade (nunca deve ser tocada por aqui); ver
// supabase-ufersin/0000_bootstrap_ufersin_schema.sql pra como o schema
// `ufersin` foi criado. Só mude via VITE_SUPABASE_SCHEMA se precisar
// apontar deliberadamente pra outro schema (ex.: depurar algo no sunset).
export const supabase = createClient(url ?? '', anonKey ?? '', {
  db: { schema: import.meta.env.VITE_SUPABASE_SCHEMA || 'ufersin' },
})
