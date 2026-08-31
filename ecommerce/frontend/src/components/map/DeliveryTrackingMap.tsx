import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LocateFixed } from 'lucide-react'
import { orderService } from '../../services/orderService'
import { TILE_ATTR, TILE_URL, FALLBACK, monitorarTiles, ajustarParaCaber } from '../../lib/geo/mapa'
import { destDivIcon, motoDivIcon } from '../../lib/geo/icones'
import { calcularRota } from '../../lib/geo/rotas'
import { anexarGestoMapa } from '../../lib/geo/rotacaoMapa'
import type { Rota } from '../../lib/geo/tipos'
import type { DeliveryPosition, Order } from '../../types'

const TRACK_POLL_MS = 5000
const ROUTE_REFRESH_MS = 25000

// Extraído de pages/Consultar.tsx (a versão clone-do-Sunset) pra ser
// reaproveitado tal e qual em qualquer uiux* -- a reprodução do gesto de
// arrastar/pinçar/girar + a lógica de tracking são obrigatórias
// (ANEXO A da especificação funcional), só a cor da rota (`--tenant-map-
// accent`, com o mesmo dourado de sempre como fallback) e a moldura ao
// redor ficam livres pro tema de cada layout.
//
// Só aparece quando o pedido está em_rota_de_entrega. Faz polling em vez
// de assinar Realtime. Se o motoboy saiu com um LOTE de entregas, a
// posição dele só é revelada aqui quando a SUA entrega é a parada atual
// (is_next_stop) -- mesma lógica do Uber/99.
export default function DeliveryTrackingMap({ order, live = true }: { order: Order; live?: boolean }) {
  const [position, setPosition] = useState<DeliveryPosition | null>(null)
  const [route, setRoute] = useState<Rota | null>(null)
  const [mapRotation, setMapRotation] = useState(0)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const visibleWrapperRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const motoMarkerRef = useRef<L.Marker | null>(null)
  const destMarkerRef = useRef<L.Marker | null>(null)
  const routeLineRef = useRef<L.Polyline | null>(null)
  const fitInicialRef = useRef(false)
  const rotationRef = useRef(0)
  const [tilesFailing, setTilesFailing] = useState(false)
  useEffect(() => {
    rotationRef.current = mapRotation
  }, [mapRotation])

  const tracking = position?.is_next_stop === true && position.lat != null && position.lng != null

  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    const map = L.map(mapDivRef.current, { zoomControl: false, zoomSnap: 0, zoomDelta: 0.5 }).setView([FALLBACK.lat, FALLBACK.lng], 14)
    const tileLayer = L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 20, keepBuffer: 4, updateWhenZooming: false }).addTo(map)
    const pararMonitor = monitorarTiles(tileLayer, setTilesFailing)
    if (order.customer_lat != null && order.customer_lng != null) {
      destMarkerRef.current = L.marker([order.customer_lat, order.customer_lng], { icon: destDivIcon(26) }).addTo(map)
      if (!live) map.setView([order.customer_lat, order.customer_lng], 15)
    }
    map.dragging.disable()
    map.touchZoom.disable()
    map.scrollWheelZoom.disable()
    map.doubleClickZoom.disable()
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 0)
    return () => {
      pararMonitor()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapDivRef.current) return
    return anexarGestoMapa(mapDivRef.current, {
      map,
      getRotation: () => rotationRef.current,
      onRotate: setMapRotation,
    })
  }, [])

  useEffect(() => {
    // Entrega por motoboy/99pop terceiro: cliente vê o destino no mapa, mas
    // nunca a posição em tempo real (loja não controla o GPS do terceiro).
    if (!live) return
    let cancelled = false
    const poll = () => {
      orderService
        .trackDeliveryPosition(order.id)
        .then((p) => {
          if (!cancelled) setPosition(p)
        })
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, TRACK_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [order.id])

  useEffect(() => {
    if (!tracking || position.lat == null || position.lng == null) return
    if (order.customer_lat == null || order.customer_lng == null) return
    let cancelled = false
    const fetchRoute = () => {
      calcularRota({ lat: position.lat!, lng: position.lng! }, { lat: order.customer_lat!, lng: order.customer_lng! })
        .then((r) => {
          if (!cancelled) setRoute(r)
        })
        .catch(() => {})
    }
    fetchRoute()
    const interval = setInterval(fetchRoute, ROUTE_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, order.id])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!tracking || position.lat == null || position.lng == null) {
      motoMarkerRef.current?.remove()
      motoMarkerRef.current = null
      routeLineRef.current?.remove()
      routeLineRef.current = null
      return
    }

    if (!motoMarkerRef.current) {
      motoMarkerRef.current = L.marker([position.lat, position.lng], {
        icon: motoDivIcon(position.heading ?? null, 32, -mapRotation),
      }).addTo(map)
    } else {
      motoMarkerRef.current.setLatLng([position.lat, position.lng])
      motoMarkerRef.current.setIcon(motoDivIcon(position.heading ?? null, 32, -mapRotation))
    }

    destMarkerRef.current?.setIcon(destDivIcon(26, -mapRotation))

    if (route) {
      routeLineRef.current?.remove()
      routeLineRef.current = L.polyline(route.coords, { color: '#d5aa45', weight: 5, opacity: 0.85 }).addTo(map)
    }

    if (!fitInicialRef.current) {
      fitInicialRef.current = true
      if (destMarkerRef.current && visibleWrapperRef.current) {
        const rect = visibleWrapperRef.current.getBoundingClientRect()
        ajustarParaCaber(map, L.latLngBounds([[position.lat, position.lng], destMarkerRef.current.getLatLng()]), rect, 40)
      } else {
        map.setView([position.lat, position.lng], 15)
      }
    }
  }, [position, route, tracking, mapRotation])

  const recentralizar = () => {
    const map = mapRef.current
    if (!map || !tracking || position.lat == null || position.lng == null) return
    setMapRotation(0)
    if (destMarkerRef.current && visibleWrapperRef.current) {
      const rect = visibleWrapperRef.current.getBoundingClientRect()
      ajustarParaCaber(map, L.latLngBounds([[position.lat, position.lng], destMarkerRef.current.getLatLng()]), rect, 40)
    } else {
      map.setView([position.lat, position.lng], 15)
    }
  }

  return (
    <div className="mt-3">
      {!live && <p className="text-xs opacity-60 mb-2">Pedido saiu para entrega — acompanhe pelo motoboy combinado.</p>}
      {live && !position && <p className="text-xs opacity-60 mb-2">Aguardando início da corrida…</p>}
      {live && position && position.is_next_stop === false && (
        <p className="text-xs opacity-60 mb-2">
          O motoboy está terminando outra entrega antes da sua — assim que ele sair pra você, o mapa aparece aqui.
        </p>
      )}
      {position?.is_next_stop === true && position.lat == null && <p className="text-xs opacity-60 mb-2">Motoboy a caminho, aguardando sinal de GPS…</p>}
      {/* isolate: cria um stacking context próprio pro mapa, senão os panes
          internos do Leaflet (z-index alto) vazam por cima de outros
          elementos fixed da página (FABs de WhatsApp/carrinho). */}
      <div ref={visibleWrapperRef} className="relative isolate w-full h-48 rounded-xl overflow-hidden border border-white/5">
        <div className="absolute" style={{ inset: '-80%', transform: `rotate(${mapRotation}deg)`, transition: 'transform .15s linear', willChange: 'transform' }}>
          <div ref={mapDivRef} className="absolute inset-0" />
        </div>
        {tilesFailing && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[500] bg-red-950/90 border border-red-500/40 text-red-200 text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap">
            Mapa não carregou — verifique sua internet
          </div>
        )}
        {tracking && (
          <button
            onClick={recentralizar}
            className="absolute bottom-2 right-2 z-[500] w-8 h-8 flex items-center justify-center rounded-full bg-black/60 border border-white/10 text-white backdrop-blur-sm"
            aria-label="Centralizar mapa no trajeto"
          >
            <LocateFixed className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
