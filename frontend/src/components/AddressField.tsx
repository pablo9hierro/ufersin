import { useEffect, useRef, useState } from 'react'
import { Loader2, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { buscarEnderecos } from '../lib/geo/geocodificacao'
import { obterLocalizacao } from '../lib/geo/localizacao'
import type { EnderecoResultado } from '../lib/geo/tipos'
import AddressPicker from './AddressPicker'

interface AddressFieldProps {
  endereco: string
  numero: string
  onEnderecoChange: (v: string) => void
  onNumeroChange: (v: string) => void
}

/** Barra de busca de rua + N° opcional + botão de geolocalização/mapa. */
export default function AddressField({ endereco, numero, onEnderecoChange, onNumeroChange }: AddressFieldProps) {
  const [query, setQuery] = useState(endereco)
  const [results, setResults] = useState<EnderecoResultado[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [mapInitial, setMapInitial] = useState<{ lat: number; lng: number; label?: string } | null>(null)
  const seq = useRef(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(endereco)
  }, [endereco])

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([])
      setSearching(false)
      return
    }
    if (query === endereco && !open) return
    const id = ++seq.current
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await buscarEnderecos(query)
        if (id === seq.current) {
          setResults(r)
          setOpen(true)
        }
      } catch {
        if (id === seq.current) setResults([])
      }
      if (id === seq.current) setSearching(false)
    }, 500)
    return () => clearTimeout(t)
  }, [query, endereco, open])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (r: EnderecoResultado) => {
    onEnderecoChange(r.titulo)
    setQuery(r.titulo)
    setOpen(false)
    setResults([])
  }

  const openMapFromGps = async () => {
    setGpsLoading(true)
    try {
      const p = await obterLocalizacao()
      setMapInitial({ ...p })
      setMapOpen(true)
    } catch {
      setMapInitial(null)
      setMapOpen(true)
    } finally {
      setGpsLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="label">Endereço *</label>
      <div className="flex gap-2 items-start">
        <div className="relative flex-1 min-w-0" ref={wrapRef}>
          <div className="flex items-center gap-2 input-field !py-0 !px-3">
            <Search className="w-4 h-4 text-uf-silver-dim flex-none" />
            <input
              className="flex-1 min-w-0 bg-transparent outline-none py-2.5 text-sm"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                onEnderecoChange(e.target.value)
                setOpen(true)
              }}
              onFocus={() => results.length > 0 && setOpen(true)}
              placeholder="Buscar rua, bairro, cidade…"
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  onEnderecoChange('')
                  setResults([])
                }}
                className="text-uf-silver-dim hover:text-uf-silver"
                aria-label="Limpar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={openMapFromGps}
              disabled={gpsLoading}
              className="text-uf-blue hover:text-uf-silver flex-none p-1"
              title="Usar minha localização"
              aria-label="Geolocalização"
            >
              {gpsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
            </button>
          </div>
          {open && (searching || results.length > 0) && (
            <div className="absolute z-20 left-0 right-0 mt-1 uf-glass rounded-xl border border-white/10 overflow-hidden max-h-56 overflow-y-auto shadow-lg">
              {searching && <p className="text-xs text-uf-silver-dim px-3 py-2.5">Buscando…</p>}
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(r)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 border-b border-white/5 last:border-0"
                >
                  <MapPin className="w-3.5 h-3.5 text-uf-silver-dim flex-none" />
                  <div className="min-w-0">
                    <div className="text-sm text-uf-silver truncate">{r.titulo}</div>
                    <div className="text-[11px] text-uf-silver-dim truncate">{r.subtitulo}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="w-24 shrink-0">
          <input
            className="input-field"
            value={numero}
            onChange={(e) => onNumeroChange(e.target.value)}
            placeholder="Opcional"
            aria-label="Número"
          />
          <p className="text-[10px] text-uf-silver-dim mt-1 text-center">N°</p>
        </div>
      </div>

      {mapOpen && (
        <AddressPicker
          initial={mapInitial}
          onClose={() => setMapOpen(false)}
          onConfirm={(r) => {
            onEnderecoChange(r.label)
            setQuery(r.label)
            setMapOpen(false)
          }}
        />
      )}
    </div>
  )
}
