import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Loader2, LocateFixed, MessageCircle, Package, Search } from 'lucide-react'
import SiteHeader from '../components/layout/SiteHeader'
import PageTransition from '../components/layout/PageTransition'
import CartFab from '../components/CartFab'
import { StatusBadge } from '../components/ui/Badge'
import { api } from '../lib/api'
import { TILE_ATTR, TILE_URL, FALLBACK, monitorarTiles, ajustarParaCaber } from '../lib/geo/mapa'
import { destDivIcon, motoDivIcon } from '../lib/geo/icones'
import { calcularRota } from '../lib/geo/rotas'
import { anexarGestoMapa } from '../lib/geo/rotacaoMapa'
import type { Rota } from '../lib/geo/tipos'
import type { DeliveryPosition, Order } from '../lib/types'
import { useCustomer } from '../store/customer'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// wa.me exige o número completo com código do país — o WhatsApp do
// motoboy é cadastrado pelo admin sem esse padrão garantido (diferente do
// WhatsApp do cliente, que já sai normalizado como 55+DDD+número desde o
// checkout). DDD do Brasil tem 2 dígitos + número 8 ou 9 dígitos = no
// máximo 11 dígitos sem código de país; se vier assim, prefixa 55.
function whatsappComPais(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length <= 11 ? `55${digits}` : digits
}

const TRACK_POLL_MS = 5000
const ROUTE_REFRESH_MS = 25000

// Mapa ao vivo do motoboy a caminho — só aparece quando o pedido está
// em_rota_de_entrega. Faz polling em vez de assinar Realtime (mais simples
// e evita expor sunset.motoboy_runs via RLS pública; a cada poucos
// segundos já dá a sensação de "ao vivo" sem esse risco).
//
// Importante: se o motoboy saiu com um LOTE de entregas, a posição dele só
// é revelada aqui quando a SUA entrega é a parada atual (is_next_stop) —
// mesma lógica do Uber/99: você não vê o entregador enquanto ele ainda tá
// terminando a entrega de outra pessoa.
function DeliveryTrackingMap({ order }: { order: Order }) {
  const [position, setPosition] = useState<DeliveryPosition | null>(null)
  const [route, setRoute] = useState<Rota | null>(null)
  const [mapRotation, setMapRotation] = useState(0)
  const mapDivRef = useRef<HTMLDivElement>(null)
  // Wrapper de fora (tamanho real, visível) — diferente de mapDivRef, que
  // o Leaflet gerencia e é propositalmente maior que a área visível
  // (inset:-80%, pra rotação não deixar canto vazio). fitBounds precisa
  // do tamanho VISÍVEL de verdade, não do tamanho que o Leaflet enxerga.
  const visibleWrapperRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const motoMarkerRef = useRef<L.Marker | null>(null)
  const destMarkerRef = useRef<L.Marker | null>(null)
  const routeLineRef = useRef<L.Polyline | null>(null)
  // Liberdade total pra arrastar/dar zoom/girar no mapa (mesmo gesto do
  // motoboy, sem o botão/funcionalidade de travar/centralizar dele — esse
  // aqui é só do cliente). Enquadra a posição do motoboy + destino uma
  // única vez, na primeira vez que a posição aparece — depois disso nunca
  // mais mexe sozinho, pra não brigar com o gesto manual do cliente.
  const fitInicialRef = useRef(false)
  const rotationRef = useRef(0)
  const [tilesFailing, setTilesFailing] = useState(false)
  useEffect(() => {
    rotationRef.current = mapRotation
  }, [mapRotation])

  const tracking = position?.is_next_stop === true && position.lat != null && position.lng != null

  // O container do mapa fica sempre montado (mesmo antes de "tracking"
  // ficar true), senão esse efeito roda antes da div existir de verdade e,
  // como as deps são [], nunca mais tenta de novo.
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    const map = L.map(mapDivRef.current, { zoomControl: false, zoomSnap: 0, zoomDelta: 0.5 }).setView([FALLBACK.lat, FALLBACK.lng], 14)
    const tileLayer = L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 20, keepBuffer: 4, updateWhenZooming: false }).addTo(map)
    const pararMonitor = monitorarTiles(tileLayer, setTilesFailing)
    if (order.customer_lat != null && order.customer_lng != null) {
      destMarkerRef.current = L.marker([order.customer_lat, order.customer_lng], { icon: destDivIcon(26) }).addTo(map)
    }
    // Nativo do Leaflet não sabe que o mapa pode estar rotacionado (a
    // rotação é só CSS por fora) — fica desligado pra sempre, o gesto
    // unificado abaixo cuida de arrastar/pinçar/girar sabendo da rotação.
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
    let cancelled = false
    const poll = () => {
      api
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

  // Busca a rota do motoboy até o cliente assim que a posição dele fica
  // visível, e atualiza periodicamente enquanto ele se desloca de verdade.
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
      // Não é a parada atual (ou ainda sem sinal de GPS): some com o
      // marcador do motoboy e a rota, se já existiam de uma entrega
      // anterior do mesmo lote.
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

  // Botão de "recentralizar": diferente do travar/seguir do motoboy, esse é
  // uma ação única — dá um zoom-out mostrando motoboy + destino de uma vez
  // e devolve o controle pro cliente na mesma hora (não fica "ligado",
  // não trava mais nada; o cliente pode voltar a pinçar/arrastar à vontade
  // logo em seguida).
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
      {!position && <p className="text-xs text-son-silver-dim mb-2">Aguardando início da corrida…</p>}
      {position && position.is_next_stop === false && (
        <p className="text-xs text-son-silver-dim mb-2">
          O motoboy está terminando outra entrega antes da sua — assim que ele sair pra você, o mapa aparece aqui.
        </p>
      )}
      {position?.is_next_stop === true && position.lat == null && (
        <p className="text-xs text-son-silver-dim mb-2">Motoboy a caminho, aguardando sinal de GPS…</p>
      )}
      {/* isolate: cria um stacking context próprio pro mapa, senão os panes
          internos do Leaflet (z-index alto) vazam por cima de outros
          elementos fixed da página (os FABs de WhatsApp/carrinho). */}
      <div ref={visibleWrapperRef} className="relative isolate w-full h-48 rounded-xl overflow-hidden border border-white/5">
        <div
          className="absolute"
          style={{ inset: '-80%', transform: `rotate(${mapRotation}deg)`, transition: 'transform .15s linear', willChange: 'transform' }}
        >
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
            className="absolute bottom-2 right-2 z-[500] w-8 h-8 flex items-center justify-center rounded-full bg-son-black/80 border border-white/10 text-white backdrop-blur-sm"
            aria-label="Centralizar mapa no trajeto"
          >
            <LocateFixed className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

export default function Consultar() {
  const customer = useCustomer()
  const [searchParams] = useSearchParams()
  const [phone, setPhone] = useState(customer.whatsapp)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [loading, setLoading] = useState(false)

  const search = async (rawPhone: string) => {
    const digits = rawPhone.replace(/\D/g, '')
    if (digits.length < 10) return
    setLoading(true)
    try {
      const result = await api.orders.track(`55${digits}`)
      setOrders(result)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const orderId = searchParams.get('order')
    if (orderId) {
      setLoading(true)
      api
        .orders.get(orderId)
        .then((o) => setOrders([o]))
        .finally(() => setLoading(false))
    } else if (customer.whatsapp) {
      search(customer.whatsapp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="min-h-screen text-white">
      <SiteHeader showCart={false} showProfile={false} showWhatsApp />
      <CartFab />
      <PageTransition className="max-w-xl mx-auto px-5 sm:px-10 pt-6 pb-20">
        <div className="flex gap-2 mb-8">
          <input
            className="input-field"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="(83) 99999-9999"
            type="tel"
            inputMode="numeric"
          />
          <button
            onClick={() => search(phone)}
            className="btn-primary px-5"
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </div>

        {orders === null ? null : orders.length === 0 ? (
          <div className="text-center py-16 text-son-silver-dim">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Nenhum pedido encontrado para esse número.</p>
          </div>
        ) : (
          <ul className="space-y-4">
            {orders.map((order) => (
              <li key={order.id} className="bg-son-surface border border-white/5 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-son-silver-dim">Pedido #{order.id.slice(0, 8)}</span>
                  <StatusBadge status={order.status} label={order.status === 'pendente' ? 'Pedido feito' : undefined} />
                </div>
                <ul className="text-sm text-son-silver space-y-0.5 mb-2">
                  {order.items.map((item) => (
                    <li key={item.product_id}>
                      {item.quantity}x {item.product_name}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-son-silver-dim">
                    {order.delivery_type === 'retirada' ? 'Retirada no local' : `Entrega em ${order.neighborhood ?? '-'}`}
                  </span>
                  <span className="sunset-text font-bold">{currency(order.total)}</span>
                </div>
                {order.status === 'em_rota_de_entrega' && (
                  <>
                    {order.motoboy_whatsapp && (
                      <a
                        href={`https://wa.me/${whatsappComPais(order.motoboy_whatsapp)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Falar com motoboy
                      </a>
                    )}
                    <DeliveryTrackingMap order={order} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageTransition>
    </main>
  )
}
