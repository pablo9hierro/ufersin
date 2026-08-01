import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ArrowLeft, Loader2, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { buscarEnderecos, enderecoDe } from '../lib/geo/geocodificacao'
import { obterLocalizacao } from '../lib/geo/localizacao'
import { FALLBACK, monitorarTiles, TILE_ATTR, TILE_URL } from '../lib/geo/mapa'
import type { EnderecoResultado, Ponto } from '../lib/geo/tipos'

export interface AddressPickerResult {
  lat: number
  lng: number
  label: string
  bairro?: string
}

interface AddressPickerProps {
  initial?: (Ponto & { label?: string }) | null
  onClose: () => void
  onConfirm: (result: AddressPickerResult) => void
}

function MapaCentro({
  centro,
  zoom = 17,
  onMoveStart,
  onMoveEnd,
  onTileStatus,
}: {
  centro: Ponto
  zoom?: number
  onMoveStart?: () => void
  onMoveEnd?: (c: Ponto) => void
  onTileStatus?: (falhando: boolean) => void
}) {
  const divRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!divRef.current) return
    const map = L.map(divRef.current, { zoomControl: false, zoomSnap: 0, zoomDelta: 0.5 }).setView(
      [centro.lat, centro.lng],
      zoom,
    )
    const tileLayer = L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 20 }).addTo(map)
    const pararMonitor = onTileStatus ? monitorarTiles(tileLayer, onTileStatus) : undefined
    if (onMoveStart) map.on('movestart', onMoveStart)
    if (onMoveEnd) map.on('moveend', () => onMoveEnd(map.getCenter()))
    return () => {
      pararMonitor?.()
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={divRef} className="absolute inset-0" />
}

/** Mapa fullscreen pra confirmar ponto (onboarding / Meu plano). */
export default function AddressPicker({ initial, onClose, onConfirm }: AddressPickerProps) {
  const [step, setStep] = useState<'busca' | 'ajuste'>(initial ? 'ajuste' : 'busca')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EnderecoResultado[]>([])
  const [searching, setSearching] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [ajusteCentro, setAjusteCentro] = useState<Ponto>(initial ?? FALLBACK)
  const [pos, setPos] = useState<Ponto>(initial ?? FALLBACK)
  const [label, setLabel] = useState(initial?.label ?? 'Localizando…')
  const [bairro, setBairro] = useState<string | undefined>()
  const [moving, setMoving] = useState(false)
  const [tilesFailing, setTilesFailing] = useState(false)
  const [mapQuery, setMapQuery] = useState('')
  const [mapResults, setMapResults] = useState<EnderecoResultado[]>([])
  const [mapSearching, setMapSearching] = useState(false)
  const seq = useRef(0)
  const mapSeq = useRef(0)
  const moveSeq = useRef(0)
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const scrollY = window.scrollY
    const body = document.body
    const previous = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width }
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    return () => {
      body.style.overflow = previous.overflow
      body.style.position = previous.position
      body.style.top = previous.top
      body.style.width = previous.width
      window.scrollTo(0, scrollY)
    }
  }, [])

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([])
      setSearching(false)
      return
    }
    const id = ++seq.current
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await buscarEnderecos(query, pos)
        if (id === seq.current) setResults(r)
      } catch {
        if (id === seq.current) setResults([])
      }
      if (id === seq.current) setSearching(false)
    }, 500)
    return () => clearTimeout(t)
  }, [query, pos])

  useEffect(() => {
    if (mapQuery.trim().length < 3) {
      setMapResults([])
      setMapSearching(false)
      return
    }
    const id = ++mapSeq.current
    const t = setTimeout(async () => {
      setMapSearching(true)
      try {
        const r = await buscarEnderecos(mapQuery, pos)
        if (id === mapSeq.current) setMapResults(r)
      } catch {
        if (id === mapSeq.current) setMapResults([])
      }
      if (id === mapSeq.current) setMapSearching(false)
    }, 500)
    return () => clearTimeout(t)
  }, [mapQuery, pos])

  useEffect(() => {
    if (step !== 'ajuste') return
    let cancelled = false
    ;(async () => {
      const addr = await enderecoDe(ajusteCentro)
      if (!cancelled) {
        setLabel(addr.label)
        setBairro(addr.bairro)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [step, ajusteCentro])

  function abrirAjuste(centro: Ponto, addr?: { label?: string; bairro?: string }) {
    setAjusteCentro(centro)
    setPos(centro)
    setLabel(addr?.label ?? 'Localizando…')
    setBairro(addr?.bairro)
    setStep('ajuste')
  }

  async function usarLocalizacaoAtual() {
    setErrorMsg(null)
    setGpsLoading(true)
    try {
      const p = await obterLocalizacao()
      abrirAjuste(p)
    } catch {
      setErrorMsg('Não consegui acessar seu GPS. Ajuste o alfinete manualmente no mapa.')
      abrirAjuste(pos)
    } finally {
      setGpsLoading(false)
    }
  }

  function handleMoveEnd(c: Ponto) {
    setPos(c)
    setMoving(false)
    setLabel('…')
    if (moveTimer.current) clearTimeout(moveTimer.current)
    const id = ++moveSeq.current
    moveTimer.current = setTimeout(async () => {
      const addr = await enderecoDe(c)
      if (id !== moveSeq.current) return
      setLabel(addr.label)
      setBairro(addr.bairro)
    }, 400)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-uf-black flex flex-col">
      {step === 'busca' && (
        <>
          <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
            <Search className="w-4 h-4 text-uf-silver-dim flex-none" />
            <input
              autoFocus
              className="flex-1 bg-transparent outline-none text-uf-silver placeholder-uf-silver-dim text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite a rua..."
            />
            <button type="button" onClick={onClose} className="text-uf-silver-dim hover:text-white flex-none" aria-label="Fechar">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <button
              type="button"
              onClick={usarLocalizacaoAtual}
              disabled={gpsLoading}
              className="w-full flex items-center gap-3 px-4 py-4 border-b border-white/5 text-left hover:bg-white/5"
            >
              {gpsLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-uf-blue flex-none" />
              ) : (
                <LocateFixed className="w-4 h-4 text-uf-blue flex-none" />
              )}
              <div>
                <div className="text-sm font-medium text-uf-silver">Usar minha localização atual</div>
                <div className="text-xs text-uf-silver-dim">Depois dá pra ajustar o alfinete no mapa</div>
              </div>
            </button>
            {errorMsg && <p className="error-msg px-4 pt-3">{errorMsg}</p>}
            {searching && <p className="text-xs text-uf-silver-dim px-4 py-3">Buscando endereços…</p>}
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => abrirAjuste(r, { label: r.titulo, bairro: r.bairro })}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-white/5 text-left hover:bg-white/5"
              >
                <MapPin className="w-4 h-4 text-uf-silver-dim flex-none" />
                <div className="min-w-0">
                  <div className="text-sm text-uf-silver truncate">{r.titulo}</div>
                  <div className="text-xs text-uf-silver-dim truncate">{r.subtitulo}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 'ajuste' && (
        <>
          <div className="relative isolate overflow-hidden flex-1">
            <MapaCentro
              key={`${ajusteCentro.lat.toFixed(5)},${ajusteCentro.lng.toFixed(5)}`}
              centro={ajusteCentro}
              onMoveStart={() => setMoving(true)}
              onMoveEnd={handleMoveEnd}
              onTileStatus={setTilesFailing}
            />
            {tilesFailing && (
              <div className="absolute top-28 left-1/2 -translate-x-1/2 z-[500] bg-red-950/90 border border-red-500/40 text-red-200 text-xs px-3 py-1.5 rounded-full">
                Mapa não carregou — verifique sua internet
              </div>
            )}
            <button
              type="button"
              onClick={() => setStep('busca')}
              className="absolute top-4 left-4 z-[500] w-10 h-10 flex items-center justify-center rounded-full bg-uf-black/80 border border-white/10 text-white"
              aria-label="Voltar"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 z-[500] w-10 h-10 flex items-center justify-center rounded-full bg-uf-black/80 border border-white/10 text-white"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={usarLocalizacaoAtual}
              disabled={gpsLoading}
              className="absolute bottom-4 right-4 z-[500] w-10 h-10 flex items-center justify-center rounded-full bg-uf-black/80 border border-white/10 text-white"
              aria-label="Minha localização"
            >
              {gpsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
            </button>

            <div className="absolute top-16 left-4 right-4 z-[500]">
              {(mapResults.length > 0 || mapSearching) && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-uf-black border border-white/10 rounded-xl overflow-hidden max-h-56 overflow-y-auto shadow-lg">
                  {mapSearching && <p className="text-xs text-uf-silver-dim px-3 py-2.5">Buscando…</p>}
                  {mapResults.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setMapQuery('')
                        setMapResults([])
                        abrirAjuste(r, { label: r.titulo, bairro: r.bairro })
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/5 last:border-b-0 text-left hover:bg-white/5"
                    >
                      <MapPin className="w-4 h-4 text-uf-silver-dim flex-none" />
                      <div className="min-w-0">
                        <div className="text-sm text-uf-silver truncate">{r.titulo}</div>
                        <div className="text-xs text-uf-silver-dim truncate">{r.subtitulo}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 bg-uf-black border border-white/15 rounded-2xl px-4 py-3 shadow-lg">
                <Search className="w-4 h-4 text-uf-blue flex-none" />
                <input
                  className="flex-1 min-w-0 bg-transparent outline-none text-uf-silver placeholder-uf-silver-dim text-sm"
                  value={mapQuery || label}
                  onFocus={() => {
                    if (!mapQuery) setMapQuery(label === '…' || label === 'Localizando…' ? '' : label)
                  }}
                  onChange={(e) => setMapQuery(e.target.value)}
                  placeholder="Buscar rua no mapa…"
                />
              </div>
            </div>

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center z-[400]">
              <MapPin
                className={`w-9 h-9 text-uf-blue drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)] transition-transform ${
                  moving ? '-translate-y-2' : 'translate-y-0'
                }`}
                fill="currentColor"
              />
            </div>
          </div>
          <div className="relative border-t border-white/10 px-4 py-4">
            <button
              type="button"
              onClick={() => onConfirm({ lat: pos.lat, lng: pos.lng, label, bairro })}
              disabled={moving}
              className="btn-primary w-full py-3.5"
            >
              Confirmar localização
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}
