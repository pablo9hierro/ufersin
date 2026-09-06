import { useEffect, useState } from 'react'
import { Loader2, Plus, RefreshCw, Store, Trash2 } from 'lucide-react'
import Card from '../ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { PointPos, PointStore, PointTerminal } from '../../lib/api'

const EMPTY_STORE = {
  name: '',
  street_name: '',
  street_number: '',
  city_name: '',
  state_name: '',
  reference: '',
}

/** Bolinha de status colorida -- mesmo padrão de indicador on/off já usado
 * em StoreHoursCard.tsx, reaproveitado aqui pra POS/terminal. */
function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'off' }) {
  const color = tone === 'ok' ? 'bg-emerald-400' : tone === 'warn' ? 'bg-amber-400' : 'bg-son-silver-dim'
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
}

/** Beta: Mercado Pago Point/POS, atrás de Feature::MercadoPagoPoint
 * (feature_flags). Reaproveita o MESMO token OAuth já conectado em Meu
 * Plano → Financeiro (Pix/Cartão) -- não pede pra conectar de novo. */
export default function MercadoPagoPointCard({ className = 'p-4 mb-6' }: { className?: string }) {
  const [stores, setStores] = useState<PointStore[]>([])
  const [pos, setPos] = useState<PointPos[]>([])
  const [terminals, setTerminals] = useState<PointTerminal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [storeForm, setStoreForm] = useState(EMPTY_STORE)
  const [creatingStore, setCreatingStore] = useState(false)
  const [showStoreForm, setShowStoreForm] = useState(false)

  const [posName, setPosName] = useState('')
  const [posStoreId, setPosStoreId] = useState('')
  const [creatingPos, setCreatingPos] = useState(false)

  const [syncingTerminals, setSyncingTerminals] = useState(false)

  const load = async () => {
    setError(null)
    try {
      const [s, p, t] = await Promise.all([
        adminService.point.listStores(),
        adminService.point.listPos(),
        adminService.point.listTerminals(),
      ])
      setStores(s)
      setPos(p)
      setTerminals(t)
      setPosStoreId((prev) => prev || s[0]?.id || '')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar o Mercado Pago Point.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const createStore = async () => {
    const f = storeForm
    if (!f.name.trim() || !f.street_name.trim() || !f.street_number.trim() || !f.city_name.trim() || !f.state_name.trim()) {
      setError('Preencha nome, rua, número, cidade e UF da loja.')
      return
    }
    setCreatingStore(true)
    setError(null)
    try {
      await adminService.point.syncStore({
        name: f.name.trim(),
        street_name: f.street_name.trim(),
        street_number: f.street_number.trim(),
        city_name: f.city_name.trim(),
        state_name: f.state_name.trim(),
        reference: f.reference.trim() || undefined,
      })
      setStoreForm(EMPTY_STORE)
      setShowStoreForm(false)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível criar a loja física.')
    } finally {
      setCreatingStore(false)
    }
  }

  const createPos = async () => {
    if (!posName.trim() || !posStoreId) return
    setCreatingPos(true)
    setError(null)
    try {
      await adminService.point.createPos({ name: posName.trim(), store_id: posStoreId })
      setPosName('')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível criar o caixa (POS).')
    } finally {
      setCreatingPos(false)
    }
  }

  const removePos = async (id: string) => {
    setError(null)
    try {
      await adminService.point.deletePos(id)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível remover o caixa (POS).')
    }
  }

  const syncTerminals = async () => {
    setSyncingTerminals(true)
    setError(null)
    try {
      const t = await adminService.point.syncTerminals()
      setTerminals(t)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível sincronizar os terminais.')
    } finally {
      setSyncingTerminals(false)
    }
  }

  return (
    <Card className={className}>
      <p className="label mb-3 flex items-center gap-1.5">
        <Store className="w-3.5 h-3.5" /> Mercado Pago Point / POS (beta)
      </p>
      <p className="text-xs text-son-silver-dim mb-4">
        Cobrança via maquininha. Usa a MESMA conexão Mercado Pago já feita em Meu Plano → Financeiro — não precisa
        conectar de novo. A associação da maquininha física a um caixa (POS) é feita no app oficial do Mercado Pago;
        aqui você só cadastra a loja e o caixa, e sincroniza o que já foi configurado lá.
      </p>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
      ) : (
        <div className="space-y-6">
          {/* Lojas físicas */}
          <div>
            <p className="text-xs font-semibold text-son-silver-dim mb-2">Lojas físicas (Store)</p>
            {stores.length === 0 && !showStoreForm && (
              <p className="text-xs text-son-silver-dim mb-2">Nenhuma loja cadastrada ainda.</p>
            )}
            {stores.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {stores.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 bg-son-surface-light rounded-lg px-3 py-2"
                  >
                    <span className="text-sm text-son-silver flex items-center gap-2">
                      <StatusDot tone={s.status === 'active' ? 'ok' : 'off'} />
                      {s.name}
                    </span>
                    <span className="text-xs text-son-silver-dim sm:text-right">{s.address}</span>
                  </li>
                ))}
              </ul>
            )}
            {showStoreForm ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-white/10 p-3">
                <div className="sm:col-span-2">
                  <label className="label">Nome da loja</label>
                  <input
                    className="input-field"
                    value={storeForm.name}
                    onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })}
                    placeholder="Ex: Loja Centro"
                  />
                </div>
                <div>
                  <label className="label">Rua</label>
                  <input
                    className="input-field"
                    value={storeForm.street_name}
                    onChange={(e) => setStoreForm({ ...storeForm, street_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Número</label>
                  <input
                    className="input-field"
                    value={storeForm.street_number}
                    onChange={(e) => setStoreForm({ ...storeForm, street_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Cidade</label>
                  <input
                    className="input-field"
                    value={storeForm.city_name}
                    onChange={(e) => setStoreForm({ ...storeForm, city_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">UF</label>
                  <input
                    className="input-field"
                    maxLength={2}
                    value={storeForm.state_name}
                    onChange={(e) => setStoreForm({ ...storeForm, state_name: e.target.value.toUpperCase() })}
                    placeholder="PB"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Referência (opcional)</label>
                  <input
                    className="input-field"
                    value={storeForm.reference}
                    onChange={(e) => setStoreForm({ ...storeForm, reference: e.target.value })}
                    placeholder="Ex: perto do mercado"
                  />
                </div>
                <div className="sm:col-span-2 flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowStoreForm(false)
                      setStoreForm(EMPTY_STORE)
                    }}
                    className="btn-secondary flex-1 text-sm py-2"
                  >
                    Cancelar
                  </button>
                  <button onClick={createStore} disabled={creatingStore} className="btn-primary flex-1 text-sm py-2">
                    {creatingStore ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Criar loja
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowStoreForm(true)} className="btn-secondary text-sm py-2 px-4">
                <Plus className="w-4 h-4" /> Nova loja física
              </button>
            )}
          </div>

          {/* Caixas (POS) */}
          <div>
            <p className="text-xs font-semibold text-son-silver-dim mb-2">Caixas (POS)</p>
            {pos.length === 0 && <p className="text-xs text-son-silver-dim mb-2">Nenhum caixa cadastrado ainda.</p>}
            {pos.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {pos.map((p) => (
                  <li key={p.id} className="flex items-center justify-between bg-son-surface-light rounded-lg px-3 py-2">
                    <span className="text-sm text-son-silver flex items-center gap-2">
                      <StatusDot tone={p.status === 'active' ? 'ok' : 'off'} />
                      {p.name}
                    </span>
                    <button onClick={() => removePos(p.id)} className="text-son-silver-dim hover:text-red-400 flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {stores.length > 0 ? (
              <div className="flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-3">
                <div className="flex-1 min-w-0">
                  <label className="label">Nome do caixa</label>
                  <input
                    className="input-field"
                    value={posName}
                    onChange={(e) => setPosName(e.target.value)}
                    placeholder="Ex: Caixa 01"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="label">Loja</label>
                  <select className="input-field" value={posStoreId} onChange={(e) => setPosStoreId(e.target.value)}>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <button onClick={createPos} disabled={creatingPos} className="btn-secondary text-sm py-2 px-4 sm:flex-shrink-0">
                  {creatingPos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Criar caixa
                </button>
              </div>
            ) : (
              <p className="text-xs text-son-silver-dim">Cadastre uma loja física primeiro pra poder criar um caixa.</p>
            )}
          </div>

          {/* Terminais */}
          <div>
            <p className="text-xs font-semibold text-son-silver-dim mb-2">Terminais (maquininhas)</p>
            {terminals.length === 0 ? (
              <p className="text-xs text-son-silver-dim mb-2">Nenhum terminal sincronizado ainda.</p>
            ) : (
              <ul className="space-y-1.5 mb-3">
                {terminals.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm text-son-silver bg-son-surface-light rounded-lg px-3 py-2">
                    <StatusDot tone={t.operating_mode ? 'ok' : 'warn'} />
                    <span className="truncate">{t.mp_terminal_id}</span>
                    <span className="text-xs text-son-silver-dim ml-auto flex-shrink-0">
                      {t.operating_mode ?? 'modo não informado'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={syncTerminals} disabled={syncingTerminals} className="btn-secondary text-sm py-2 px-4">
              {syncingTerminals ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sincronizar terminais
            </button>
            <p className="text-xs text-son-silver-dim mt-2">
              Associar a maquininha física a um caixa é feito no app oficial do Mercado Pago pelo lojista/colaborador
              — não é uma etapa que dá pra automatizar por aqui.
            </p>
          </div>

          {error && <p className="error-msg">{error}</p>}
        </div>
      )}
    </Card>
  )
}
