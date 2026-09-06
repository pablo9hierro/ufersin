import { useEffect, useState } from 'react'
import { Loader2, Plus, RefreshCw, Store, Trash2 } from 'lucide-react'
import Card from '../ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { PointPos, PointStore, PointTerminal } from '../../lib/api'

/** Beta: Mercado Pago Point/POS, atrás de Feature::MercadoPagoPoint
 * (feature_flags). Reaproveita o MESMO token OAuth já conectado em Meu
 * Plano → Financeiro (Pix/Cartão) -- não pede pra conectar de novo. */
export default function MercadoPagoPointCard({ className = 'p-4 mb-6' }: { className?: string }) {
  const [stores, setStores] = useState<PointStore[]>([])
  const [pos, setPos] = useState<PointPos[]>([])
  const [terminals, setTerminals] = useState<PointTerminal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [storeName, setStoreName] = useState('')
  const [storeAddress, setStoreAddress] = useState('')
  const [creatingStore, setCreatingStore] = useState(false)

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
      if (s.length > 0 && !posStoreId) setPosStoreId(s[0].id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar o Mercado Pago Point.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createStore = async () => {
    if (!storeName.trim() || !storeAddress.trim()) return
    setCreatingStore(true)
    setError(null)
    try {
      await adminService.point.syncStore({ name: storeName.trim(), address: storeAddress.trim() })
      setStoreName('')
      setStoreAddress('')
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
          <div>
            <p className="text-xs font-semibold text-son-silver-dim mb-2">Lojas físicas (Store)</p>
            {stores.length === 0 && <p className="text-xs text-son-silver-dim mb-2">Nenhuma loja cadastrada ainda.</p>}
            <ul className="space-y-1 mb-2">
              {stores.map((s) => (
                <li key={s.id} className="text-sm text-son-silver flex items-center justify-between bg-son-surface-light rounded-lg px-3 py-2">
                  <span>{s.name}</span>
                  <span className="text-xs text-son-silver-dim">{s.address}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">Nome da loja</label>
                <input className="input-field w-48 py-2 text-sm" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
              </div>
              <div>
                <label className="label">Endereço</label>
                <input className="input-field w-56 py-2 text-sm" value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} />
              </div>
              <button onClick={createStore} disabled={creatingStore} className="btn-secondary text-sm py-2 px-4">
                {creatingStore ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Criar loja
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-son-silver-dim mb-2">Caixas (POS)</p>
            {pos.length === 0 && <p className="text-xs text-son-silver-dim mb-2">Nenhum caixa cadastrado ainda.</p>}
            <ul className="space-y-1 mb-2">
              {pos.map((p) => (
                <li key={p.id} className="text-sm text-son-silver flex items-center justify-between bg-son-surface-light rounded-lg px-3 py-2">
                  <span>{p.name}</span>
                  <button onClick={() => removePos(p.id)} className="text-son-silver-dim hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            {stores.length > 0 && (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="label">Nome do caixa</label>
                  <input className="input-field w-40 py-2 text-sm" value={posName} onChange={(e) => setPosName(e.target.value)} placeholder="Ex: Caixa 01" />
                </div>
                <div>
                  <label className="label">Loja</label>
                  <select className="input-field w-40 py-2 text-sm" value={posStoreId} onChange={(e) => setPosStoreId(e.target.value)}>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <button onClick={createPos} disabled={creatingPos} className="btn-secondary text-sm py-2 px-4">
                  {creatingPos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Criar caixa
                </button>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-son-silver-dim mb-2">Terminais (maquininhas)</p>
            {terminals.length === 0 && <p className="text-xs text-son-silver-dim mb-2">Nenhum terminal sincronizado ainda.</p>}
            <ul className="space-y-1 mb-2">
              {terminals.map((t) => (
                <li key={t.id} className="text-sm text-son-silver bg-son-surface-light rounded-lg px-3 py-2">
                  {t.mp_terminal_id} — {t.operating_mode ?? 'modo não informado'}
                </li>
              ))}
            </ul>
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
