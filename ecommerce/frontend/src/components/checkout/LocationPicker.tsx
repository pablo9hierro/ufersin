import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ArrowLeft, Loader2, LocateFixed, MapPin, Pencil, Search, X } from 'lucide-react'
import { buscarEnderecos, enderecoDe } from '../../lib/geo/geocodificacao'
import { obterLocalizacao } from '../../lib/geo/localizacao'
import { FALLBACK, monitorarTiles, TILE_ATTR, TILE_URL } from '../../lib/geo/mapa'
import { anexarGestoMapa } from '../../lib/geo/rotacaoMapa'
import type { EnderecoResultado, Ponto } from '../../lib/geo/tipos'
import { api } from '../../lib/api'
import type { ShippingEstimate } from '../../lib/types'

export interface LocationPickerResult {
  lat: number
  lng: number
  label: string
  bairro?: string
  estimate?: ShippingEstimate
}

interface LocationPickerProps {
  initial?: (Ponto & { label?: string; bairro?: string }) | null
  onClose: () => void
  onConfirm: (result: LocationPickerResult) => void
}

// Mapa "cru" (sem React-Leaflet): o pino fica fixo no centro da TELA via CSS
// e é o MAPA que desliza por baixo dele (mesmo truque do Uber/99). Remonta
// via `key` no componente pai sempre que o centro inicial muda de vez
// (busca/GPS) — arrastos normais não remontam, só disparam moveend.
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
  const mapRef = useRef<L.Map | null>(null)
  const [rotation, setRotation] = useState(0)
  const rotationRef = useRef(0)
  useEffect(() => {
    rotationRef.current = rotation
  }, [rotation])

  useEffect(() => {
    if (!divRef.current) return
    const map = L.map(divRef.current, { zoomControl: false, zoomSnap: 0, zoomDelta: 0.5 }).setView([centro.lat, centro.lng], zoom)
    const tileLayer = L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 20, keepBuffer: 4, updateWhenZooming: false }).addTo(map)
    const pararMonitor = onTileStatus ? monitorarTiles(tileLayer, onTileStatus) : undefined
    if (onMoveStart) map.on('movestart', onMoveStart)
    if (onMoveEnd) map.on('moveend', () => onMoveEnd(map.getCenter()))
    // Nativo do Leaflet não sabe que o mapa pode estar rotacionado (a
    // rotação é só CSS por fora) — fica desligado pra sempre, o gesto
    // unificado abaixo cuida de arrastar/pinçar/girar sabendo da rotação
    // (panBy/setZoom continuam disparando move/moveend normalmente, então
    // a busca de endereço ao arrastar continua funcionando igual).
    map.dragging.disable()
    map.touchZoom.disable()
    map.scrollWheelZoom.disable()
    map.doubleClickZoom.disable()
    mapRef.current = map
    return () => {
      pararMonitor?.()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !divRef.current) return
    return anexarGestoMapa(divRef.current, {
      map,
      getRotation: () => rotationRef.current,
      onRotate: setRotation,
    })
  }, [])

  return (
    <div
      className="absolute"
      style={{ inset: '-80%', transform: `rotate(${rotation}deg)`, transition: 'transform .15s linear', willChange: 'transform' }}
    >
      <div ref={divRef} className="absolute inset-0" />
    </div>
  )
}

export default function LocationPicker({ initial, onClose, onConfirm }: LocationPickerProps) {
  const [step, setStep] = useState<'busca' | 'ajuste'>(initial ? 'ajuste' : 'busca')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EnderecoResultado[]>([])
  const [searching, setSearching] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [ajusteCentro, setAjusteCentro] = useState<Ponto>(initial ?? FALLBACK)
  const [pos, setPos] = useState<Ponto>(initial ?? FALLBACK)
  const [label, setLabel] = useState(initial?.label ?? 'Localizando…')
  const [bairro, setBairro] = useState<string | undefined>(initial?.bairro)
  const [moving, setMoving] = useState(false)
  const [estimate, setEstimate] = useState<ShippingEstimate | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [tilesFailing, setTilesFailing] = useState(false)

  // Campo de endereço editável na tela de ajuste: arrastar o alfinete
  // atualiza o texto (via `label`) e, ao contrário, digitar aqui busca e
  // move o alfinete pro endereço escolhido — sem precisar voltar pra
  // tela de busca.
  const [labelEditing, setLabelEditing] = useState(false)
  const [labelQuery, setLabelQuery] = useState('')
  const [labelResults, setLabelResults] = useState<EnderecoResultado[]>([])
  const [labelSearching, setLabelSearching] = useState(false)
  const labelSeq = useRef(0)

  const seq = useRef(0)

  // Trava o scroll da página por baixo enquanto o mapa em tela cheia está
  // aberto. Só overflow:hidden não é suficiente em Safari/Chrome mobile —
  // eles ainda permitem rubber-band/overscroll no body por baixo de um
  // elemento fixed, o que "vaza" o checkout por um instante lá embaixo.
  // position:fixed no body (técnica padrão) trava de verdade; ao fechar,
  // volta pro scroll exato de onde parou.
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

  // `position: fixed; inset: 0` confia que o "viewport" do CSS bate com o
  // que tá realmente visível — mas no Chrome/Safari mobile a barra de
  // endereço/navegação some e volta o tempo todo, e esse recálculo nem
  // sempre acontece na hora certa, deixando uma fresta embaixo por onde o
  // conteúdo do checkout (por trás) aparece por um instante. window.
  // visualViewport é a API feita pra isso: mede o que tá REALMENTE visível
  // agora, então o overlay é dimensionado em px direto por JS em vez de
  // confiar em vh/dvh/inset. Sem suporte (browser antigo), cai pra
  // innerHeight normal.
  const [viewport, setViewport] = useState(() => ({
    top: window.visualViewport?.offsetTop ?? 0,
    height: window.visualViewport?.height ?? window.innerHeight,
  }))
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setViewport({ top: vv.offsetTop, height: vv.height })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  // Debounce de 500ms na busca — Nominatim só aceita 1 requisição/segundo.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Mesma lógica de busca com debounce, só que pro campo de endereço da
  // tela de ajuste — só busca enquanto o usuário está de fato digitando ali.
  useEffect(() => {
    if (!labelEditing || labelQuery.trim().length < 3) {
      setLabelResults([])
      setLabelSearching(false)
      return
    }
    const id = ++labelSeq.current
    const t = setTimeout(async () => {
      setLabelSearching(true)
      try {
        const r = await buscarEnderecos(labelQuery, pos)
        if (id === labelSeq.current) setLabelResults(r)
      } catch {
        if (id === labelSeq.current) setLabelResults([])
      }
      if (id === labelSeq.current) setLabelSearching(false)
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelQuery, labelEditing])

  // Roda uma vez ao entrar (ou reentrar) na tela de ajuste — a construção
  // do mapa não dispara "moveend" sozinha, então o primeiro endereço/frete
  // precisa ser buscado manualmente aqui.
  useEffect(() => {
    if (step !== 'ajuste') return
    let cancelled = false
    ;(async () => {
      const addr = await enderecoDe(ajusteCentro)
      if (!cancelled) {
        setLabel(addr.label)
        setBairro(addr.bairro)
      }
      try {
        const est = await api.estimateShipping(ajusteCentro.lat, ajusteCentro.lng)
        if (!cancelled) setEstimate(est)
      } catch {
        if (!cancelled) setEstimate(null)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, ajusteCentro])

  function abrirAjuste(centro: Ponto, addr?: { label?: string; bairro?: string }) {
    setAjusteCentro(centro)
    setPos(centro)
    setLabel(addr?.label ?? 'Localizando…')
    setBairro(addr?.bairro)
    setStep('ajuste')
  }

  // Selecionou um resultado ao digitar direto no campo da tela de ajuste —
  // o alfinete pula pro endereço escolhido sem sair dessa tela (remonta o
  // MapaCentro via key, igual abrirAjuste, só que sem trocar de step).
  function selecionarResultadoLabel(r: EnderecoResultado) {
    setLabelEditing(false)
    setLabelQuery('')
    setLabelResults([])
    setAjusteCentro(r)
    setPos(r)
    setLabel(r.titulo)
    setBairro(r.bairro)
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

  // Botão de GPS na tela de ajuste — pula direto pra posição atual do
  // aparelho. O mapa em si já tem liberdade total de arrastar/zoom o
  // tempo todo (nunca recentraliza sozinho), isso aqui é só um atalho.
  async function recentrarNoGps() {
    setErrorMsg(null)
    setGpsLoading(true)
    try {
      const p = await obterLocalizacao()
      abrirAjuste(p)
    } catch {
      setErrorMsg('Não consegui acessar seu GPS.')
    } finally {
      setGpsLoading(false)
    }
  }

  // Debounce de 400ms + guarda de sequência: sem isso, ajustes rápidos e
  // sucessivos do alfinete disparam várias buscas de endereço em paralelo
  // (o Nominatim só aceita 1 req/s, então algumas voltam com erro/429) e,
  // como não há garantia de que respondam na mesma ordem, uma resposta
  // antiga podia sobrescrever uma mais nova com "Local no mapa".
  const moveSeq = useRef(0)
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleMoveEnd(c: Ponto) {
    setPos(c)
    setMoving(false)
    setLabel('…')
    if (moveTimer.current) clearTimeout(moveTimer.current)
    const id = ++moveSeq.current
    moveTimer.current = setTimeout(async () => {
      const [addr, est] = await Promise.allSettled([enderecoDe(c), api.estimateShipping(c.lat, c.lng)])
      if (id !== moveSeq.current) return
      if (addr.status === 'fulfilled') {
        setLabel(addr.value.label)
        setBairro(addr.value.bairro)
      }
      setEstimate(est.status === 'fulfilled' ? est.value : null)
    }, 400)
  }

  const foraDoAlcance = estimate != null && estimate.within_range === false

  async function confirmar() {
    if (foraDoAlcance) {
      setErrorMsg(
        `Esse endereço fica a ${estimate!.km.toFixed(1).replace('.', ',')} km da loja — nosso limite de entrega é ${estimate!
          .max_km!.toFixed(1)
          .replace('.', ',')} km. Escolha um endereço mais próximo ou opte por retirada no local.`
      )
      return
    }
    setErrorMsg(null)
    setConfirming(true)
    try {
      onConfirm({ lat: pos.lat, lng: pos.lng, label, bairro, estimate: estimate ?? undefined })
    } finally {
      setConfirming(false)
    }
  }

  // Portal direto pro <body>: tira o overlay de dentro da árvore do
  // Checkout de vez — assim nenhum ancestral (containers com padding, max-w
  // etc.) pode interferir na altura/posição dele. Combinado com a medida
  // via visualViewport acima, cobre 100% do que tá visível de verdade.
  return createPortal(
    <div className="fixed left-0 z-50 bg-son-black flex flex-col" style={{ top: viewport.top, height: viewport.height, width: '100%' }}>
      {step === 'busca' && (
        <>
          <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
            <Search className="w-4 h-4 text-son-silver-dim flex-none" />
            <input
              autoFocus
              className="flex-1 bg-transparent outline-none text-white placeholder-son-silver-dim text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite sua rua e número..."
            />
            <button onClick={onClose} className="text-son-silver-dim hover:text-white flex-none" aria-label="Fechar">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <button
              type="button"
              onClick={usarLocalizacaoAtual}
              disabled={gpsLoading}
              className="w-full flex items-center gap-3 px-4 py-4 border-b border-white/5 text-left hover:bg-white/5 transition-colors"
            >
              {gpsLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-son-pink flex-none" />
              ) : (
                <LocateFixed className="w-4 h-4 text-son-pink flex-none" />
              )}
              <div>
                <div className="text-sm font-medium text-white">Usar minha localização atual</div>
                <div className="text-xs text-son-silver-dim">Depois dá pra ajustar o alfinete no mapa</div>
              </div>
            </button>

            {errorMsg && <p className="error-msg px-4 pt-3">{errorMsg}</p>}

            {searching && <p className="text-xs text-son-silver-dim px-4 py-3">Buscando endereços…</p>}
            {!searching && query.trim().length >= 3 && results.length === 0 && (
              <p className="text-xs text-son-silver-dim px-4 py-3">Nenhum endereço encontrado. Tente incluir o bairro.</p>
            )}
            {!searching && query.trim().length > 0 && query.trim().length < 3 && (
              <p className="text-xs text-son-silver-dim px-4 py-3">Digite pelo menos 3 letras do endereço…</p>
            )}

            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => abrirAjuste(r, { label: r.titulo, bairro: r.bairro })}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-white/5 text-left hover:bg-white/5 transition-colors"
              >
                <MapPin className="w-4 h-4 text-son-silver-dim flex-none" />
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">{r.titulo}</div>
                  <div className="text-xs text-son-silver-dim truncate">{r.subtitulo}</div>
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
              <div className="absolute top-28 left-1/2 -translate-x-1/2 z-[500] bg-red-950/90 border border-red-500/40 text-red-200 text-xs px-3 py-1.5 rounded-full whitespace-nowrap">
                Mapa não carregou — verifique sua internet
              </div>
            )}

            <button
              onClick={() => setStep('busca')}
              className="absolute top-4 left-4 z-[500] w-10 h-10 flex items-center justify-center rounded-full bg-son-black/80 border border-white/10 text-white backdrop-blur-sm"
              aria-label="Voltar pra busca"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-[500] w-10 h-10 flex items-center justify-center rounded-full bg-son-black/80 border border-white/10 text-white backdrop-blur-sm"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
            <button
              onClick={recentrarNoGps}
              disabled={gpsLoading}
              className="absolute bottom-4 right-4 z-[500] w-10 h-10 flex items-center justify-center rounded-full bg-son-black/80 border border-white/10 text-white backdrop-blur-sm"
              aria-label="Centralizar na minha localização"
            >
              {gpsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
            </button>

            {/* Barra de endereço fixa no topo (mesmo padrão do Uber/99) —
                editável: digitar aqui busca e move o alfinete pro endereço
                escolhido, arrastar o alfinete atualiza o texto aqui. */}
            <div className="absolute top-16 left-4 right-4 z-[500]">
              {labelEditing && (labelResults.length > 0 || labelSearching) && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-son-black border border-white/10 rounded-xl overflow-hidden max-h-56 overflow-y-auto shadow-lg">
                  {labelSearching && <p className="text-xs text-son-silver-dim px-3 py-2.5">Buscando endereços…</p>}
                  {!labelSearching &&
                    labelResults.map((r, i) => (
                      <button
                        key={i}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selecionarResultadoLabel(r)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/5 last:border-b-0 text-left hover:bg-white/5 transition-colors"
                      >
                        <MapPin className="w-4 h-4 text-son-silver-dim flex-none" />
                        <div className="min-w-0">
                          <div className="text-sm text-white truncate">{r.titulo}</div>
                          <div className="text-xs text-son-silver-dim truncate">{r.subtitulo}</div>
                        </div>
                      </button>
                    ))}
                </div>
              )}
              <div className="flex items-center gap-2 bg-son-black border border-white/15 rounded-2xl px-4 py-3 shadow-lg">
                <MapPin className="w-4 h-4 text-son-pink flex-none" />
                <input
                  className="flex-1 min-w-0 bg-transparent outline-none text-white placeholder-son-silver-dim text-sm truncate"
                  value={labelEditing ? labelQuery : label}
                  onFocus={() => {
                    setLabelEditing(true)
                    setLabelQuery(label)
                  }}
                  onChange={(e) => setLabelQuery(e.target.value)}
                  onBlur={() => setTimeout(() => setLabelEditing(false), 150)}
                  placeholder="Digite a rua e o número…"
                />
                <Pencil className="w-3.5 h-3.5 text-son-silver-dim flex-none" />
              </div>
            </div>

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center z-[400]">
              <MapPin
                className={`w-9 h-9 text-son-pink drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)] transition-transform ${
                  moving ? '-translate-y-2' : 'translate-y-0'
                }`}
                fill="currentColor"
              />
              <div className={`w-2 h-1 rounded-full bg-black/40 -mt-1 transition-opacity ${moving ? 'opacity-30' : 'opacity-60'}`} />
            </div>
          </div>

          <div className="relative border-t border-white/10 px-4 py-4 space-y-3">
            {errorMsg && <p className="error-msg">{errorMsg}</p>}
            {!errorMsg && foraDoAlcance && estimate && (
              <p className="text-xs text-amber-400">
                Fora do raio de entrega ({estimate.km.toFixed(1).replace('.', ',')} km, máximo{' '}
                {estimate.max_km!.toFixed(1).replace('.', ',')} km).
              </p>
            )}

            <button onClick={confirmar} disabled={confirming || moving} className="btn-primary w-full py-3.5">
              {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Confirmar localização
            </button>
          </div>
        </>
      )}
    </div>,
    document.body
  )
}
