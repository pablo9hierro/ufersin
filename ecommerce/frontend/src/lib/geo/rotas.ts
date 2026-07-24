// Distância em linha reta é calculada aqui mesmo (client-side, de graça).
// A rota real pelas ruas passa por um Cloudflare Worker (/api/route) em vez
// de bater direto no OSRM ou na Google — o Worker decide qual das duas usar
// (Google Routes quando GOOGLE_ROUTES_API_KEY estiver configurada, OSRM
// como fallback gratuito enquanto isso não acontece) sem expor nenhuma
// chave no navegador. Primeira rota migrada do backend Rust (Railway) pra
// serverless — ver worker/src/index.ts.
import type { Ponto, Rota } from './tipos'

const WORKER_BASE = import.meta.env.VITE_WORKER_BASE_URL || 'https://sunset-tabas-api.mulekinrx1v9.workers.dev'

// Distância em LINHA RETA entre dois pontos (fórmula de Haversine). Zero
// requisição — é só matemática, funciona offline. Mesma fórmula usada no
// banco (sunset._distance_km) pra recalcular o frete de verdade no pedido —
// esta função aqui é só pra estimativa ao vivo no checkout.
export function distanciaKm(a: Ponto, b: Ponto): number {
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// Rota real pelas ruas — usada pra desenhar o trajeto no mapa e mostrar
// km/min. NÃO usada pro cálculo do frete (esse usa linha reta, calculado
// direto no banco).
export async function calcularRota(de: Ponto, ate: Ponto): Promise<Rota> {
  const r = await fetch(`${WORKER_BASE}/api/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ de, ate }),
  })
  if (!r.ok) throw new Error('rota falhou')
  return (await r.json()) as Rota
}
