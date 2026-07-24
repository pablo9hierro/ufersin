// Cloudflare Worker — primeira rota do backend Rust (Railway) migrada pra
// serverless. Só o que NÃO depende de WhatsApp/Evolution API (conexão
// persistente, tem que continuar no Railway) é candidato a vir pra cá.
//
// POST /api/route — mesmo contrato de backend/src/routes/public.rs
// (compute_route) e backend/src/google_routes.rs (calcular_rota): recebe
// dois pontos, devolve a rota real pelas ruas (Google Routes se
// GOOGLE_ROUTES_API_KEY estiver configurada, senão OSRM de graça). Usado
// pela navegação do motoboy e pelo acompanhamento do cliente em /consultar.

export interface Env {
  GOOGLE_ROUTES_API_KEY?: string
}

interface Ponto {
  lat: number
  lng: number
}

interface RotaResult {
  coords: [number, number][]
  km: number
  min: number
}

// Mesmo algoritmo padrão de "encoded polyline" do Google usado no lado Rust
// (backend/src/google_routes.rs:decode_polyline) — sem lib externa.
function decodePolyline(encoded: string): [number, number][] {
  let index = 0
  let lat = 0
  let lng = 0
  const coords: [number, number][] = []

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let b: number
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    coords.push([lat / 1e5, lng / 1e5])
  }
  return coords
}

function parseDurationSeconds(s: string): number {
  return Math.round(parseFloat(s.replace(/s$/, '')) || 0)
}

async function calcularRotaGoogle(key: string, de: Ponto, ate: Ponto): Promise<RotaResult> {
  const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: de.lat, longitude: de.lng } } },
      destination: { location: { latLng: { latitude: ate.lat, longitude: ate.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      units: 'METRIC',
    }),
  })
  if (!resp.ok) {
    console.error('google routes computeRoutes failed', resp.status, await resp.text())
    throw new Error('failed to compute route')
  }
  const parsed = (await resp.json()) as {
    routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline: string } }[]
  }
  const rota = parsed.routes?.[0]
  if (!rota?.polyline) throw new Error('google routes missing polyline')
  return {
    coords: decodePolyline(rota.polyline.encodedPolyline),
    km: (rota.distanceMeters ?? 0) / 1000,
    min: Math.max(rota.duration ? Math.floor(parseDurationSeconds(rota.duration) / 60) : 1, 1),
  }
}

async function calcularRotaOsrm(de: Ponto, ate: Ponto): Promise<RotaResult> {
  const url = `https://router.project-osrm.org/route/v1/driving/${de.lng},${de.lat};${ate.lng},${ate.lat}?overview=full&geometries=geojson`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error('osrm route failed')
  const parsed = (await resp.json()) as {
    routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[]
  }
  const rota = parsed.routes?.[0]
  if (!rota) throw new Error('osrm returned no route')
  return {
    coords: rota.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    km: rota.distance / 1000,
    min: Math.max(Math.round(rota.duration / 60), 1),
  }
}

function calcularRota(env: Env, de: Ponto, ate: Ponto): Promise<RotaResult> {
  return env.GOOGLE_ROUTES_API_KEY ? calcularRotaGoogle(env.GOOGLE_ROUTES_API_KEY, de, ate) : calcularRotaOsrm(de, ate)
}

// Mesmo papel do CorsLayer/CORS_ORIGINS do lado Rust (backend/src/main.rs) —
// libera só os domínios conhecidos do front, não "*".
const ALLOWED_ORIGINS = new Set(['https://sunset-tabas.vercel.app', 'http://localhost:5173'])

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/api/route') {
      try {
        const { de, ate } = (await request.json()) as { de: Ponto; ate: Ponto }
        const rota = await calcularRota(env, de, ate)
        return Response.json(rota, { headers: cors })
      } catch (err) {
        console.error('compute_route failed', err)
        return Response.json({ error: 'failed to compute route' }, { status: 500, headers: cors })
      }
    }

    return new Response('Not found', { status: 404, headers: cors })
  },
}
