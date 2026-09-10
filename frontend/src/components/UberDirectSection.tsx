import { useEffect, useState } from 'react'
import { Bike, CheckCircle2, ExternalLink, Loader2, Save } from 'lucide-react'
import { api, ApiError, type DeliveryStatus, type UberDirectInput } from '../lib/api'

const EMPTY: UberDirectInput = { client_id: '', client_secret: '', customer_id: '', pickup_city: '', pickup_state: '' }

/** Meu Plano -> Financeiro (Integrações): conecta o Uber Direct. A API da
 * Uber Direct é server-to-server (client_credentials) -- não existe um
 * fluxo "Conectar com Uber" delegado como o do Mercado Pago (confirmado na
 * documentação oficial). O lojista tira as credenciais sozinho, em
 * autoatendimento, no próprio painel da Uber -- passo a passo abaixo. */
export default function UberDirectSection() {
  const [status, setStatus] = useState<DeliveryStatus | null>(null)
  const [form, setForm] = useState<UberDirectInput>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    api.getDeliveryStatus().then(setStatus).catch(() => setStatus({ connected: false, connected_at: null }))
  }, [])

  const set = <K extends keyof UberDirectInput>(k: K, v: UberDirectInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const result = await api.conectarUberDirect(form)
      setStatus(result)
      setForm(EMPTY)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível conectar o Uber Direct.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="uf-glass rounded-2xl p-6 space-y-4">
      <p className="text-xs text-uf-silver-dim flex items-center gap-1.5">
        <Bike className="w-3.5 h-3.5" /> Uber Direct — chame entregador direto do painel da loja, sem app terceiro.
      </p>

      {status?.connected ? (
        <p className="text-sm text-uf-silver flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Uber Direct conectado.
        </p>
      ) : status === null ? (
        <Loader2 className="w-4 h-4 animate-spin text-uf-silver-dim" />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="text-xs text-uf-blue hover:underline"
          >
            {showHelp ? 'Esconder' : 'Onde encontro essas credenciais?'}
          </button>
          {showHelp && (
            <div className="text-xs text-uf-silver-dim bg-white/5 rounded-xl p-4 space-y-2">
              <p>Autoatendimento, direto no site da Uber (sem precisar falar com vendedor):</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Acesse{' '}
                  <a
                    href="https://direct.uber.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-uf-blue hover:underline inline-flex items-center gap-1"
                  >
                    direct.uber.com <ExternalLink className="w-3 h-3" />
                  </a>{' '}
                  e crie a conta Uber Direct da sua loja (aceita os termos e cadastra um cartão de crédito).
                </li>
                <li>
                  No painel, vá em <b>Management → Developer</b>.
                </li>
                <li>Copie o Customer ID, Client ID e Client Secret que aparecem lá e cole abaixo.</li>
              </ol>
              <p className="text-amber-300">
                As credenciais iniciais valem pra ambiente de teste. Pra produção, a Uber pede dados de faturamento e
                leva um tempo pra aprovar — não é instantâneo.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">Customer ID *</label>
              <input className="input-field" value={form.customer_id} onChange={(e) => set('customer_id', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">Client ID *</label>
              <input className="input-field" value={form.client_id} onChange={(e) => set('client_id', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">Client Secret *</label>
              <input
                type="password"
                className="input-field"
                value={form.client_secret}
                onChange={(e) => set('client_secret', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Cidade da loja (retirada)</label>
              <input className="input-field" value={form.pickup_city} onChange={(e) => set('pickup_city', e.target.value)} />
            </div>
            <div>
              <label className="label">UF da loja</label>
              <input
                className="input-field"
                maxLength={2}
                value={form.pickup_state}
                onChange={(e) => set('pickup_state', e.target.value.toUpperCase())}
                placeholder="PB"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving || !form.client_id || !form.client_secret || !form.customer_id}
            className="btn-primary w-full py-3 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Conectar Uber Direct
          </button>
          {error && <p className="error-msg">{error}</p>}
        </>
      )}
    </div>
  )
}
