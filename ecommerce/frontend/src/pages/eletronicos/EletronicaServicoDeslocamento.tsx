import { useEffect, useState } from 'react'
import { Check, Loader2, MapPin, Navigation, PackageCheck, PackagePlus, Truck } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import { buscarEnderecos } from '../../lib/geo/geocodificacao'

// Port 1:1 de src/app/dashboard/servicodeslocamento/ServicoDeslocamentoClient.tsx
// do vrtech -- mesmos campos/copy/cálculo de exemplo. Geocodificação
// reaproveita lib/geo/geocodificacao.ts (mesmo Nominatim já usado em
// LocationPicker) em vez de inventar outra. Persistência é por tenant
// (eletronicos.shipping_settings), não single-row global como o original.
// Gap disclosed: nada consome esse valor ainda pra estimar frete automático
// no formulário público (equivalente à RPC estimate_shipping do vrtech,
// não portada) -- por ora o frete final continua sendo digitado manualmente
// pelo lojista ao concluir a OS (ServiceOrderPanel).

const INPUT =
  'w-full px-4 py-3 rounded-xl border border-white/10 bg-[#0a0a0b] text-white placeholder-white/25 focus:border-[#e0211a]/60 outline-none transition-all'

type Settings = {
  price_per_km: number
  minutes_per_km: number
  store_lat: number | null
  store_lng: number | null
  store_address: string
  max_km: number | null
  cobrar_coleta: boolean
  cobrar_entrega: boolean
}

export default function EletronicaServicoDeslocamento() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    eletronicosAdmin.shippingSettings
      .get()
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : 'erro ao carregar configurações'))
  }, [])

  const handleSave = async () => {
    if (!settings) return
    setError(null)
    if (settings.price_per_km < 0) {
      setError('Preço por km não pode ser negativo')
      return
    }
    if (settings.max_km !== null && settings.max_km <= 0) {
      setError('Distância máxima deve ser positiva')
      return
    }
    if (!settings.store_address.trim()) {
      setError('Informe o endereço da loja')
      return
    }

    setSaving(true)
    let lat = settings.store_lat
    let lng = settings.store_lng
    try {
      const results = await buscarEnderecos(settings.store_address)
      if (results.length === 0) {
        setError('Endereço não encontrado. Tente ser mais específico.')
        setSaving(false)
        return
      }
      lat = results[0].lat
      lng = results[0].lng
    } catch {
      setError('Erro ao buscar coordenadas. Verifique sua conexão.')
      setSaving(false)
      return
    }

    try {
      await eletronicosAdmin.shippingSettings.update({ ...settings, store_lat: lat, store_lng: lng })
      setSettings((s) => (s ? { ...s, store_lat: lat, store_lng: lng } : s))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[#e0211a]" />
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-lg font-bold text-white flex items-center gap-2">
        <Truck className="w-5 h-5 text-[#e0211a]" />
        Serviço de deslocamento
      </h1>
      <p className="text-sm text-[#d4d4d8]/50">
        Coleta e entrega do aparelho são pernas independentes — o cliente pode escolher só coleta, só entrega, as
        duas ou nenhuma (leva e busca na loja), como passagens separadas. O preço por km abaixo é cobrado por PERNA
        escolhida, calculado pela distância em linha reta até o endereço do cliente (fórmula de Haversine) — nunca
        em dobro caso o cliente escolha só uma perna.
      </p>

      <div className="bg-[#161618] border border-white/5 rounded-2xl p-5 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-[#d4d4d8]/80 mb-1.5">
            Preço por km <span className="text-[#d4d4d8]/40 font-normal">(R$/km, por perna)</span>
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#d4d4d8]/50 text-sm font-medium">R$</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.10"
              min="0"
              value={settings.price_per_km}
              onChange={(e) => setSettings((s) => (s ? { ...s, price_per_km: Number(e.target.value) } : s))}
              className={`${INPUT} pl-10`}
              placeholder="2.00"
            />
          </div>
          <p className="text-xs text-[#d4d4d8]/40 mt-1.5">
            Ex: cliente pede só entrega, 5 km → R$ {(5 * settings.price_per_km).toFixed(2)}. Se pedir coleta + entrega,
            5 km cada → R$ {(10 * settings.price_per_km).toFixed(2)} no total.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-[#d4d4d8]/80 mb-1.5">
            Tempo de deslocamento <span className="text-[#d4d4d8]/40 font-normal">(minutos por km)</span>
          </label>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              value={settings.minutes_per_km}
              onChange={(e) => setSettings((s) => (s ? { ...s, minutes_per_km: Number(e.target.value) } : s))}
              className={`${INPUT} pr-16`}
              placeholder="3"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#d4d4d8]/40 text-sm">min/km</span>
          </div>
          <p className="text-xs text-[#d4d4d8]/40 mt-1.5">
            Usado pra informar ao cliente quanto tempo leva a coleta/entrega (ex: 5 km → ~{(5 * settings.minutes_per_km).toFixed(0)} min).
          </p>
        </div>

        <div className="border-t border-white/5 pt-4 space-y-3">
          <p className="text-sm font-semibold text-[#d4d4d8]/80">Pernas cobradas</p>
          <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-[#0a0a0b] cursor-pointer">
            <input
              type="checkbox"
              checked={settings.cobrar_coleta}
              onChange={(e) => setSettings((s) => (s ? { ...s, cobrar_coleta: e.target.checked } : s))}
              className="w-4 h-4 accent-[#e0211a]"
            />
            <PackagePlus className="w-4 h-4 text-[#e0211a] shrink-0" />
            <span className="text-sm text-[#d4d4d8]/80">Cobrar coleta do aparelho na casa do cliente</span>
          </label>
          <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-[#0a0a0b] cursor-pointer">
            <input
              type="checkbox"
              checked={settings.cobrar_entrega}
              onChange={(e) => setSettings((s) => (s ? { ...s, cobrar_entrega: e.target.checked } : s))}
              className="w-4 h-4 accent-[#e0211a]"
            />
            <PackageCheck className="w-4 h-4 text-[#e0211a] shrink-0" />
            <span className="text-sm text-[#d4d4d8]/80">Cobrar entrega do aparelho pronto na casa do cliente</span>
          </label>
          <p className="text-xs text-[#d4d4d8]/40">
            Desmarcada, aquela perna fica cortesia (grátis) mesmo com km rodado. Retirada na loja pelo cliente nunca é cobrada.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-[#d4d4d8]/80 mb-1.5">
            Raio máximo de atendimento <span className="text-[#d4d4d8]/40 font-normal">(km) — deixe vazio = sem limite</span>
          </label>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              step="1"
              min="1"
              value={settings.max_km ?? ''}
              onChange={(e) => setSettings((s) => (s ? { ...s, max_km: e.target.value === '' ? null : Number(e.target.value) } : s))}
              className={`${INPUT} pr-12`}
              placeholder="Sem limite"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#d4d4d8]/40 text-sm">km</span>
          </div>
        </div>

        <div className="border-t border-white/5 pt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#d4d4d8]/80">
            <MapPin className="w-4 h-4 text-[#e0211a]" />
            Endereço da loja (ponto de partida do deslocamento)
          </div>
          <div>
            <input
              type="text"
              value={settings.store_address}
              onChange={(e) => setSettings((s) => (s ? { ...s, store_address: e.target.value } : s))}
              className={INPUT}
              placeholder="Ex: Rua das Trincheiras, 500 — João Pessoa, PB"
            />
            <p className="text-xs text-[#d4d4d8]/40 mt-1.5">
              Digite o endereço como no Google Maps. As coordenadas serão calculadas automaticamente ao salvar.
            </p>
          </div>
          {settings.store_lat != null && settings.store_lng != null && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${settings.store_lat},${settings.store_lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[#e0211a]/70 hover:text-[#e0211a] transition-colors"
            >
              <Navigation className="w-3 h-3" />
              Ver localização atual no mapa
            </a>
          )}
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className={`w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all ${
          saved ? 'bg-green-600 text-white' : 'bg-[#e0211a] text-white hover:bg-[#a3140f]'
        }`}
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
        {saving ? 'Salvando…' : saved ? 'Salvo!' : 'Salvar configurações'}
      </button>
    </div>
  )
}
