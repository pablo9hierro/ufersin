import { useEffect, useState } from 'react'
import { Check, Loader2, Save, Send, Zap } from 'lucide-react'
import Card from '../ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { DeliverySettings } from '../../lib/api'

/** Beta: Uber Direct só, atrás de Feature::EntregaTerceirizada (feature_flags). */
export default function EntregasTerceirizadasCard({ className = 'p-4 mb-6' }: { className?: string }) {
  const [settings, setSettings] = useState<DeliverySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [mode, setMode] = useState<'manual' | 'automatico'>('manual')
  const [maxAutoDiff, setMaxAutoDiff] = useState('')
  const [pickupCity, setPickupCity] = useState('')
  const [pickupState, setPickupState] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [savedSettings, setSavedSettings] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null)

  const load = async () => {
    setError(null)
    try {
      const s = await adminService.delivery.getSettings()
      setSettings(s)
      setMode(s.mode)
      setMaxAutoDiff(s.max_auto_diff != null ? String(s.max_auto_diff) : '')
      setPickupCity(s.pickup_city ?? '')
      setPickupState(s.pickup_state ?? '')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar as configurações de entrega.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const uberStatus = settings?.providers.find((p) => p.provider === 'uber_direct')
  const uberConnected = uberStatus?.status === 'conectado'

  const saveSettings = async () => {
    const diff = maxAutoDiff.trim() === '' ? null : Number(maxAutoDiff)
    if (diff != null && (Number.isNaN(diff) || diff < 0)) return
    setError(null)
    setSavingSettings(true)
    try {
      const updated = await adminService.delivery.updateSettings({
        mode,
        primary_provider: uberConnected ? 'uber_direct' : null,
        fallback_provider: null,
        max_auto_diff: diff,
        pickup_city: pickupCity.trim() || null,
        pickup_state: pickupState.trim() || null,
      })
      setSettings(updated)
      setSavedSettings(true)
      setTimeout(() => setSavedSettings(false), 1500)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar as configurações.')
    } finally {
      setSavingSettings(false)
    }
  }


  const testConnection = async () => {
    setError(null)
    setTesting(true)
    setTestResult(null)
    try {
      await adminService.delivery.testConnection('uber_direct')
      setTestResult('ok')
    } catch (e) {
      setTestResult('error')
      setError(e instanceof ApiError ? e.message : 'Falha ao testar a conexão.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card className={className}>
      <p className="label mb-3 flex items-center gap-1.5">
        <Send className="w-3.5 h-3.5" /> Entregas terceirizadas (beta)
      </p>
      <p className="text-xs text-son-silver-dim mb-4">
        Despache entregas via Uber Direct pros pedidos de lojas sem motoboy próprio. Recurso em beta.
      </p>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold text-son-silver-dim mb-2">
              Uber Direct — {uberConnected ? <span className="text-emerald-400">conectado</span> : 'desconectado'}
            </p>
            {!uberConnected && (
              <p className="text-xs text-son-silver-dim bg-black/20 border border-white/5 rounded-xl p-3 mb-2">
                A conexão com o Uber Direct (Client ID/Secret/Customer ID) é feita em{' '}
                <b>Meu Plano → Integrações</b>, no painel de assinatura da Resolutoo — não aqui. Depois de conectar
                lá, ela aparece como "conectado" nesta tela.
              </p>
            )}
            {uberConnected && (
              <button onClick={testConnection} disabled={testing} className="btn-secondary text-sm py-2 px-4">
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Testar conexão
              </button>
            )}
            {testResult === 'ok' && <p className="text-xs text-emerald-400 mt-2">Conexão OK.</p>}
          </div>

          <div>
            <p className="text-xs font-semibold text-son-silver-dim mb-2">Localização da loja</p>
            <p className="text-xs text-son-silver-dim mb-2">
              Obrigatório pra Uber Direct calcular a rota certo — sem isso a cotação pode sair errada.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">Cidade</label>
                <input className="input-field w-40 py-2 text-sm" value={pickupCity} onChange={(e) => setPickupCity(e.target.value)} placeholder="Ex: Joao Pessoa" />
              </div>
              <div>
                <label className="label">Estado (UF)</label>
                <input className="input-field w-20 py-2 text-sm" maxLength={2} value={pickupState} onChange={(e) => setPickupState(e.target.value.toUpperCase())} placeholder="PB" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Modo de acionamento</label>
              <select className="input-field w-40 py-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as 'manual' | 'automatico')}>
                <option value="manual">Manual</option>
                <option value="automatico">Automático</option>
              </select>
            </div>
            <div>
              <label className="label">Diferença máxima absorvida (R$)</label>
              <input
                className="input-field w-40 py-2 text-sm"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="Sem limite"
                value={maxAutoDiff}
                onChange={(e) => setMaxAutoDiff(e.target.value)}
              />
            </div>
            <button onClick={saveSettings} disabled={savingSettings} className="btn-secondary text-sm py-2 px-4">
              {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : savedSettings ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4" />}
              Salvar
            </button>
          </div>

          {error && <p className="error-msg">{error}</p>}
        </div>
      )}
    </Card>
  )
}
