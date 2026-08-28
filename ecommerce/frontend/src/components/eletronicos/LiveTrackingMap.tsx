import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Loader2 } from 'lucide-react'

// Port do LiveTrackingMap.tsx real (src/components/dashboard/LiveTrackingMap.tsx)
// -- mapa colorido (não escuro -- pedido explícito no original: essa tela
// não precisa ser preto e cinza), pino fixo da loja + pino do endereço do
// cliente + trajeto real por ruas (OSRM). Estilo/proporção Uber·99·iFood:
// mapa grande (não thumbnail), pinça-zoom livre, mas 5s depois de parar de
// mexer volta sozinho a reenquadrar os dois pontos -- sempre norte-pra-cima
// (nunca gira com o rumo, igual o Leaflet já faz por padrão).
// tile.openstreetmap.org direto (o que o original usa) bloqueia esse tipo
// de acesso agora -- confirmado ao vivo (header `x-blocked`, política deles
// mudou). CARTO (rastertiles OU o endpoint novo sem "rastertiles/", dark_all
// e voyager, todos testados) agora exige API key própria -- toda tile vem
// com selo "API KEY REQUIRED" por cima, o que no zoom pequeno do card
// parece só "mapa branco". Esri World Street Map: colorido, rua/nome de
// rua visível, sem marca d'água, sem chave -- confirmado com curl direto.
// Atenção: Esri usa a ordem {z}/{y}/{x} (trocada da XYZ padrão) e um único
// servidor (sem {s}).
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTR = 'Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P'
const RECENTER_IDLE_MS = 5000

const destIcon = L.divIcon({
  className: '',
  html: `<div style="width:16px;height:16px;border-radius:9999px;background:#e0211a;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const driverIcon = L.divIcon({
  className: '',
  html: `<div style="width:30px;height:30px;border-radius:9999px;background:#111827;border:3px solid #22c55e;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4)">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3"/><path d="M9 21V13h6v8"/></svg>
  </div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
})

function straightLineDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Rota real por ruas via OSRM demo público -- sem chave, sem custo, mas
 * melhor-esforço: falha vira sem rota desenhada, nunca quebra o card. */
async function fetchRoute(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<[number, number][] | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const data = await res.json()
    const coords = data?.routes?.[0]?.geometry?.coordinates as [number, number][] | undefined
    if (!coords?.length) return null
    return coords.map(([lng, lat]) => [lat, lng])
  } catch {
    return null
  }
}

export default function LiveTrackingMap({
  destLat,
  destLng,
  driver,
  minutesPerKm = 3,
  heightClassName = 'h-64',
}: {
  destLat: number
  destLng: number
  /** Posição ao vivo do técnico (fresca -- ver isFresh no chamador). null = ainda sem dado. */
  driver: { lat: number; lng: number } | null
  minutesPerKm?: number
  heightClassName?: string
}) {
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const driverMarkerRef = useRef<L.Marker | null>(null)
  const routeLayerRef = useRef<L.Polyline | null>(null)
  const recenterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loading, setLoading] = useState(true)

  const origin = driver

  // Recentro (depois de pinçado/zoomado e parado por RECENTER_IDLE_MS) foca
  // de perto na rua ATUAL do técnico -- zoom fixo nível de rua, não um
  // fitBounds nos dois pontos (isso mostraria o trajeto inteiro de longe,
  // não "a rua que ele está agora"). Mesma dinâmica do Uber/99/iFood: o
  // enquadramento geral só acontece uma vez, ao abrir.
  const DRIVER_FOLLOW_ZOOM = 17
  const recenterOnDriver = () => {
    const map = mapRef.current
    const marker = driverMarkerRef.current
    if (!map || !marker) return
    map.setView(marker.getLatLng(), DRIVER_FOLLOW_ZOOM, { animate: true })
  }

  const scheduleRecenter = () => {
    if (recenterTimerRef.current) clearTimeout(recenterTimerRef.current)
    recenterTimerRef.current = setTimeout(recenterOnDriver, RECENTER_IDLE_MS)
  }

  useEffect(() => {
    if (!divRef.current || mapRef.current || !origin) return
    setLoading(false)
    // zoomControl/attributionControl off -- estilo app (Uber/99/iFood não
    // mostram esses controles nativos do Leaflet). rotate nunca é ligado
    // aqui -- fica sempre norte-pra-cima por padrão.
    const map = L.map(divRef.current, { zoomControl: false, attributionControl: false }).setView([destLat, destLng], 14)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map)
    L.control.attribution({ prefix: false }).addTo(map)
    L.marker([destLat, destLng], { icon: destIcon }).addTo(map)
    driverMarkerRef.current = L.marker([origin.lat, origin.lng], { icon: driverIcon }).addTo(map)
    mapRef.current = map

    const bounds = L.latLngBounds([[destLat, destLng], [origin.lat, origin.lng]])
    map.fitBounds(bounds, { paddingTopLeft: [30, 30], paddingBottomRight: [30, 30], maxZoom: 17 })

    fetchRoute(origin, { lat: destLat, lng: destLng }).then((coords) => {
      if (mapRef.current !== map || !coords) return
      routeLayerRef.current = L.polyline(coords, { color: '#e0211a', weight: 4, opacity: 0.85 }).addTo(map)
    })

    // Pinça/zoom livre, mas volta sozinho a reenquadrar os dois pontos
    // depois de RECENTER_IDLE_MS parado -- mesma dinâmica do Uber/99/iFood.
    map.on('dragstart zoomstart', () => {
      if (recenterTimerRef.current) clearTimeout(recenterTimerRef.current)
    })
    map.on('dragend zoomend', scheduleRecenter)

    const t = setTimeout(() => map.invalidateSize(), 100)
    return () => {
      clearTimeout(t)
      if (recenterTimerRef.current) clearTimeout(recenterTimerRef.current)
      map.remove()
      mapRef.current = null
      driverMarkerRef.current = null
      routeLayerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destLat, destLng, Boolean(origin)])

  // Posição ao vivo mudou (novo poll) -- move o pino e redesenha a rota
  // sem recriar o mapa inteiro (evita piscar), e reagenda o recentro
  // (só dispara depois de RECENTER_IDLE_MS parado, não empurra o mapa na
  // hora -- se o lojista está mexendo/olhando outro trecho, não interrompe).
  useEffect(() => {
    if (!mapRef.current || !origin || !driverMarkerRef.current) return
    driverMarkerRef.current.setLatLng([origin.lat, origin.lng])
    fetchRoute(origin, { lat: destLat, lng: destLng }).then((coords) => {
      if (!coords || !routeLayerRef.current) return
      routeLayerRef.current.setLatLngs(coords)
    })
    scheduleRecenter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.lat, origin?.lng])

  const distanceKm = origin ? straightLineDistanceKm({ lat: destLat, lng: destLng }, origin) : null
  const etaMin = distanceKm !== null ? Math.round(distanceKm * minutesPerKm) : null

  if (!origin) {
    return (
      <div className={`rounded-xl overflow-hidden border border-white/10 ${heightClassName} bg-[#161618] flex items-center justify-center`}>
        <p className="text-xs text-[#d4d4d8]/40 px-4 text-center">Localização do técnico ainda não disponível</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl overflow-hidden border border-white/10 isolate" onClick={(e) => e.stopPropagation()}>
      <div className={`relative isolate z-0 w-full ${heightClassName}`}>
        <div ref={divRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#161618]">
            <Loader2 className="w-5 h-5 animate-spin text-[#d4d4d8]/30" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2 bg-[#161618] text-xs text-[#d4d4d8]/60">
        {distanceKm !== null ? `~${distanceKm.toFixed(1)} km · ~${etaMin} min` : 'Calculando trajeto...'}
      </div>
    </div>
  )
}
