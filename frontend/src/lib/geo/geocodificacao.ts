import type { EnderecoResultado, Ponto } from './tipos'

const TIMEOUT_MS = 8000

async function fetchComTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function buscarEnderecos(q: string, perto?: Ponto): Promise<EnderecoResultado[]> {
  const p = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '6',
    countrycodes: 'br',
    'accept-language': 'pt-BR',
  })
  if (perto) {
    p.set('viewbox', [perto.lng - 0.35, perto.lat - 0.35, perto.lng + 0.35, perto.lat + 0.35].join(','))
  }
  const r = await fetchComTimeout('https://nominatim.openstreetmap.org/search?' + p)
  if (!r.ok) throw new Error('busca falhou')
  const hits = (await r.json()) as Array<{
    lat: string
    lon: string
    name?: string
    display_name: string
    address?: Record<string, string>
  }>
  return hits.map((hit) => {
    const a = hit.address || {}
    const rua = a.road || a.pedestrian || a.neighbourhood || hit.name || hit.display_name.split(',')[0]
    return {
      lat: +hit.lat,
      lng: +hit.lon,
      titulo: a.house_number ? `${rua}, ${a.house_number}` : rua,
      subtitulo: [a.suburb || a.neighbourhood, a.city || a.town || a.village, a.state].filter(Boolean).join(' · '),
      bairro: a.suburb || a.neighbourhood,
    }
  })
}

export async function enderecoDe({ lat, lng }: Ponto, tentativa = 0): Promise<{ label: string; bairro?: string }> {
  const p = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: 'jsonv2',
    'accept-language': 'pt-BR',
    zoom: '18',
  })
  try {
    const r = await fetchComTimeout('https://nominatim.openstreetmap.org/reverse?' + p)
    if (!r.ok) {
      if (tentativa < 1) {
        await new Promise((res) => setTimeout(res, 700))
        return enderecoDe({ lat, lng }, tentativa + 1)
      }
      return { label: 'Local no mapa' }
    }
    const body = (await r.json()) as { address?: Record<string, string>; display_name?: string }
    const a = body.address || {}
    const rua = a.road || a.pedestrian || a.suburb || a.neighbourhood || body.display_name?.split(',')[0]
    if (!rua) return { label: 'Local no mapa', bairro: a.suburb || a.neighbourhood }
    const label = a.house_number ? `${rua}, ${a.house_number}` : rua
    return { label, bairro: a.suburb || a.neighbourhood }
  } catch {
    if (tentativa < 1) {
      await new Promise((res) => setTimeout(res, 700))
      return enderecoDe({ lat, lng }, tentativa + 1)
    }
    return { label: 'Local no mapa' }
  }
}
