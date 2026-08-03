import { useEffect, useState } from 'react'
import { Check, Loader2, MapPinned, Save } from 'lucide-react'
import Card from '../ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import { shippingService } from '../../services/shippingService'

/** R$/km + distância máxima — shared by Essential `/admin/frete` and Management Funcionários. */
export default function FreteSettingsCard({ className = 'p-4 mb-6' }: { className?: string }) {
  const [pricePerKm, setPricePerKm] = useState('')
  const [maxKm, setMaxKm] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    shippingService.getSettings().then((settings) => {
      setPricePerKm(String(settings.price_per_km))
      setMaxKm(settings.max_km != null ? String(settings.max_km) : '')
      setLoading(false)
    })
  }, [])

  const save = async () => {
    const value = Number(pricePerKm)
    if (Number.isNaN(value) || value < 0) return
    const maxValue = maxKm.trim() === '' ? null : Number(maxKm)
    if (maxValue != null && (Number.isNaN(maxValue) || maxValue <= 0)) return
    setError(null)
    setSaving(true)
    try {
      const updated = await adminService.shippingSettings.update(value, maxValue)
      setPricePerKm(String(updated.price_per_km))
      setMaxKm(updated.max_km != null ? String(updated.max_km) : '')
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar o frete.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className={className}>
      <p className="label mb-3 flex items-center gap-1.5">
        <MapPinned className="w-3.5 h-3.5" /> Frete
      </p>
      <p className="text-xs text-son-silver-dim mb-4">
        Valor cobrado do cliente na entrega e raio máximo (km) a partir da loja.
      </p>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">R$ por km</label>
            <input
              className="input-field w-32 py-2 text-sm"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={pricePerKm}
              onChange={(e) => setPricePerKm(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Distância máxima (km)</label>
            <input
              className="input-field w-32 py-2 text-sm"
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              placeholder="Sem limite"
              value={maxKm}
              onChange={(e) => setMaxKm(e.target.value)}
            />
          </div>
          <button
            onClick={save}
            disabled={saving || pricePerKm === ''}
            className="btn-secondary text-sm py-2 px-4"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4" />}
            Salvar
          </button>
          {error && <p className="error-msg w-full">{error}</p>}
        </div>
      )}
    </Card>
  )
}
