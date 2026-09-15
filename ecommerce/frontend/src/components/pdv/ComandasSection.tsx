import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Loader2, Plus, Printer, QrCode, Search, Settings, Trash2, X } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { pdvService } from '../../services/pdvService'
import { adminService } from '../../services/adminService'
import { orderService } from '../../services/orderService'
import { filterPdvProducts } from '../../lib/pdvHelpers'
import { tenantHasOnlinePix } from '../../lib/tenantConfig'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import type { Comanda, ImpressaoModo, KitchenTicket, Order, PaymentMethod, Product, RestaurantTable } from '../../types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// ponytail: porta do agente local hardcoded (padrão de agentes tipo QZ Tray)
// -- torna configurável se algum tenant precisar de porta diferente.
const LOCAL_PRINT_AGENT_URL = 'ws://localhost:8181'

/** Cupom em texto puro, 80mm, monoespaçado -- serve tanto pro agente local
 * (texto puro, a maioria aceita) quanto pra janela de impressão do navegador. */
function formatKitchenTicketText(ticket: KitchenTicket) {
  const lines = [
    '=== COZINHA ===',
    `Comanda: ${ticket.comanda_label}`,
    `Atendente: ${ticket.employee_name}`,
    `Hora: ${new Date().toLocaleString('pt-BR')}`,
    '--------------------------------',
    ...ticket.items.map((i) => `${i.quantity}x ${i.product_name}`),
    '--------------------------------',
  ]
  return lines.join('\n')
}

function printInBrowser(ticket: KitchenTicket) {
  const win = window.open('', '_blank', 'width=320,height=600')
  if (!win) throw new Error('Não foi possível abrir a janela de impressão (pop-up bloqueado?).')
  const text = formatKitchenTicketText(ticket)
  win.document.write(`<!doctype html><html><head><title>Cupom cozinha</title><style>
    @media print { @page { size: 80mm auto; margin: 0; } }
    body { width: 80mm; margin: 0; padding: 8px; font-family: 'Courier New', monospace; font-size: 12px; color: #000; background: #fff; white-space: pre-wrap; }
  </style></head><body>${text.replace(/</g, '&lt;')}</body></html>`)
  win.document.close()
  win.onafterprint = () => win.close()
  win.focus()
  win.print()
}

/** Se o agente não estiver rodando, o `onerror`/timeout do WebSocket rejeita
 * com mensagem clara em vez de travar silenciosamente. */
function printViaLocalAgent(ticket: KitchenTicket): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const ws = new WebSocket(LOCAL_PRINT_AGENT_URL)
    const fail = () => {
      if (settled) return
      settled = true
      reject(new Error('Agente de impressão local não encontrado — verifique se está instalado e rodando.'))
      ws.close()
    }
    const timer = setTimeout(fail, 2500)
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'print', content: formatKitchenTicketText(ticket) }))
      clearTimeout(timer)
      settled = true
      resolve()
      ws.close()
    }
    ws.onerror = () => {
      clearTimeout(timer)
      fail()
    }
  })
}

/** Comanda de PDV: cliente consumindo no local, paga o total no final.
 * Fica abaixo do form de venda avulsa em /admin/pdv e /funcionarios/vendedor/pdv
 * — todo form aqui é toggle caixa de diálogo, igual pedido pelo lojista. */
export default function ComandasSection({ products }: { products: Product[] }) {
  const tenantConfig = useTenantConfig()
  const onlinePix = tenantHasOnlinePix(tenantConfig)
  const [comandas, setComandas] = useState<Comanda[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openComanda, setOpenComanda] = useState<Comanda | null>(null)

  // Mesas (Parte 3) -- só quando a loja liga `usa_mesas` (preferência de
  // funcionários, /admin/funcionarios). O dado não está na TenantConfig
  // pública, então lê de `/api/pdv/employee-config` (proxy pra plataforma,
  // liberado tanto pra admin quanto vendedor/garçom).
  const [usaMesas, setUsaMesas] = useState(false)
  const [impressaoModo, setImpressaoModo] = useState<ImpressaoModo>('nenhuma')
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [tablesLoading, setTablesLoading] = useState(false)
  const [tableError, setTableError] = useState<string | null>(null)
  const [showTablesAdmin, setShowTablesAdmin] = useState(false)
  const [openingTableId, setOpeningTableId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    pdvService.comandas.list().then(setComandas).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const loadTables = () => {
    setTablesLoading(true)
    pdvService.restaurantTables
      .list()
      .then(setTables)
      .catch(() => {})
      .finally(() => setTablesLoading(false))
  }

  useEffect(() => {
    pdvService
      .employeeConfig()
      .then((cfg) => {
        setUsaMesas(cfg.usa_mesas)
        setImpressaoModo(cfg.impressao_modo)
        if (cfg.usa_mesas) loadTables()
      })
      .catch(() => {})
  }, [])

  const openTable = async (table: RestaurantTable) => {
    setTableError(null)
    setOpeningTableId(table.id)
    try {
      const c = await pdvService.restaurantTables.openComanda(table.id)
      loadTables()
      load()
      setOpenComanda(c)
    } catch (err) {
      setTableError(err instanceof ApiError ? err.message : 'Não foi possível abrir a mesa.')
    } finally {
      setOpeningTableId(null)
    }
  }

  const createComanda = async () => {
    setError(null)
    if (!newLabel.trim()) {
      setError('Diga o nome do dono da comanda.')
      return
    }
    setCreating(true)
    try {
      const c = await pdvService.comandas.create(newLabel.trim())
      setComandas((prev) => [...prev, c])
      setShowNewForm(false)
      setNewLabel('')
      setOpenComanda(c)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a comanda.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-white">Comandas</h2>
        <div className="flex items-center gap-2">
          {usaMesas && (
            <button
              type="button"
              onClick={() => setShowTablesAdmin(true)}
              className="btn-secondary text-sm py-2 px-3"
              title="Gerenciar mesas"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={() => setShowNewForm(true)} className="btn-primary text-sm py-2 px-4">
            <Plus className="w-4 h-4" /> Comanda avulsa
          </button>
        </div>
      </div>

      {usaMesas && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-son-silver-dim mb-2">Mesas</h3>
          {tablesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-son-pink" />
            </div>
          ) : tables.length === 0 ? (
            <p className="text-sm text-son-silver-dim">Nenhuma mesa cadastrada ainda.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {tables.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={openingTableId === t.id}
                  onClick={() => openTable(t)}
                  className={`rounded-2xl p-4 text-center border transition-colors ${
                    t.status === 'ocupada'
                      ? 'bg-son-pink/10 border-son-pink/40 text-white'
                      : 'bg-son-surface border-white/5 text-son-silver hover:border-son-pink/30'
                  }`}
                >
                  {openingTableId === t.id ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : (
                    <>
                      <p className="font-bold">Mesa {t.numero}</p>
                      <p className="text-xs mt-0.5">{t.status === 'ocupada' ? 'Ocupada' : 'Livre'}</p>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
          {tableError && <p className="error-msg mt-2">{tableError}</p>}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
        </div>
      ) : comandas.length === 0 ? (
        <p className="text-sm text-son-silver-dim">Nenhuma comanda aberta.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {comandas.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenComanda(c)}
              className="bg-son-surface border border-white/5 rounded-2xl p-4 text-left hover:border-son-pink/30 transition-colors"
            >
              <p className="font-semibold text-white">{c.label}</p>
              <p className="text-xs text-son-silver-dim">{c.items.length} {c.items.length === 1 ? 'item' : 'itens'}</p>
              <p className="text-son-gold font-bold mt-1">{currency(c.total)}</p>
            </button>
          ))}
        </div>
      )}

      {showNewForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowNewForm(false)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Nova comanda</h3>
              <button onClick={() => setShowNewForm(false)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="label">Nome do cliente</label>
            <input className="input-field" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} autoFocus />
            {error && <p className="error-msg mt-2">{error}</p>}
            <button type="button" onClick={createComanda} disabled={creating} className="btn-primary w-full mt-4">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Criar
            </button>
          </div>
        </div>
      )}

      {openComanda && (
        <ComandaDialog
          comanda={openComanda}
          products={products}
          onlinePix={onlinePix}
          impressaoModo={impressaoModo}
          onClose={() => setOpenComanda(null)}
          onChange={(updated) => {
            setOpenComanda(updated)
            setComandas((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
          }}
          onClosed={() => {
            setOpenComanda(null)
            setComandas((prev) => prev.filter((c) => c.id !== openComanda.id))
            if (usaMesas) loadTables()
          }}
        />
      )}

      {showTablesAdmin && (
        <TablesAdminDialog
          tables={tables}
          onClose={() => setShowTablesAdmin(false)}
          onChange={loadTables}
        />
      )}
    </div>
  )
}

/** CRUD de cadastro de mesa -- só admin de fato consegue salvar (backend
 * recusa POST/PUT/DELETE de vendedor com 403); abrir o dialog não tem custo
 * pra quem não pode usar, o erro do backend já é claro. */
function TablesAdminDialog({
  tables,
  onClose,
  onChange,
}: {
  tables: RestaurantTable[]
  onClose: () => void
  onChange: () => void
}) {
  const [newNumero, setNewNumero] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; numero: string } | null>(null)

  const create = async () => {
    if (!newNumero.trim()) return
    setBusy(true)
    setError(null)
    try {
      await adminService.restaurantTables.create(newNumero.trim())
      setNewNumero('')
      onChange()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a mesa.')
    } finally {
      setBusy(false)
    }
  }

  const save = async (id: string, numero: string) => {
    if (!numero.trim()) return
    setBusy(true)
    setError(null)
    try {
      await adminService.restaurantTables.update(id, numero.trim())
      setEditing(null)
      onChange()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a mesa.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await adminService.restaurantTables.delete(id)
      onChange()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível remover a mesa.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass rounded-2xl p-6 max-w-sm w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">Gerenciar mesas</h3>
          <button onClick={onClose} className="text-son-silver-dim hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 mb-4">
          {tables.map((t) =>
            editing?.id === t.id ? (
              <div key={t.id} className="flex items-center gap-2">
                <input
                  className="input-field flex-1"
                  value={editing.numero}
                  onChange={(e) => setEditing({ id: t.id, numero: e.target.value })}
                  autoFocus
                />
                <button type="button" disabled={busy} onClick={() => save(t.id, editing.numero)} className="btn-primary py-2 px-3 text-sm">
                  Salvar
                </button>
              </div>
            ) : (
              <div key={t.id} className="flex items-center justify-between bg-son-surface-light rounded-xl px-3 py-2">
                <span className="text-sm text-white">
                  Mesa {t.numero} {t.status === 'ocupada' && <span className="text-son-pink text-xs">(ocupada)</span>}
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setEditing({ id: t.id, numero: t.numero })} className="text-xs text-son-silver-dim hover:text-white">
                    editar
                  </button>
                  <button type="button" disabled={busy || t.status === 'ocupada'} onClick={() => remove(t.id)} className="text-son-silver-dim hover:text-son-pink disabled:opacity-30">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            className="input-field flex-1"
            placeholder="Número da mesa"
            value={newNumero}
            onChange={(e) => setNewNumero(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={create} className="btn-primary py-2 px-3 text-sm">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {error && <p className="error-msg mt-2">{error}</p>}
      </div>
    </div>
  )
}

function ComandaDialog({
  comanda,
  products,
  onlinePix,
  impressaoModo,
  onClose,
  onChange,
  onClosed,
}: {
  comanda: Comanda
  products: Product[]
  onlinePix: boolean
  impressaoModo: ImpressaoModo
  onClose: () => void
  onChange: (c: Comanda) => void
  onClosed: () => void
}) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPay, setShowPay] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [choosingPrintMethod, setChoosingPrintMethod] = useState(false)

  const runPrint = async (mode: 'navegador' | 'agente_local') => {
    setPrinting(true)
    setError(null)
    setChoosingPrintMethod(false)
    try {
      const ticket = await pdvService.comandas.printKitchenTicket(comanda.id)
      if (mode === 'navegador') {
        printInBrowser(ticket)
      } else {
        await printViaLocalAgent(ticket)
      }
      const refreshed = await pdvService.comandas.get(comanda.id)
      onChange(refreshed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível imprimir o cupom da cozinha.')
    } finally {
      setPrinting(false)
    }
  }

  const printAndSendToKitchen = () => {
    if (impressaoModo === 'ambos') {
      setChoosingPrintMethod(true)
      return
    }
    runPrint(impressaoModo === 'agente_local' ? 'agente_local' : 'navegador')
  }

  const results = filterPdvProducts(products, query)

  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)

  const addItem = async (product: Product) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await pdvService.comandas.addItem(comanda.id, product.id, 1, comanda.version)
      onChange(updated)
      setQuery('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível adicionar o item.')
    } finally {
      setBusy(false)
    }
  }

  const removeItem = async (itemId: string, reason: string) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await pdvService.comandas.removeItem(comanda.id, itemId, reason, comanda.version)
      onChange(updated)
      setRemoveTarget(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível remover o item.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass rounded-2xl p-6 max-w-md w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">{comanda.label}</h3>
          <button onClick={onClose} className="text-son-silver-dim hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative mb-3">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-son-silver-dim" />
          <input
            className="input-field pl-9"
            placeholder="Buscar produto pra adicionar"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {results.length > 0 && (
          <div className="space-y-1 mb-4 max-h-40 overflow-y-auto">
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => addItem(p)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-son-surface-light hover:bg-white/10 text-left text-sm"
              >
                <span className="text-white truncate">{p.name}</span>
                <span className="text-son-gold flex-shrink-0 ml-2">{currency(p.price)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2 mb-4">
          {comanda.items.length === 0 ? (
            <p className="text-sm text-son-silver-dim text-center py-4">Nenhum item ainda.</p>
          ) : (
            comanda.items.map((i) => (
              <div key={i.id} className="flex items-center justify-between bg-son-surface-light rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">
                    {i.quantity}x {i.product_name}
                  </p>
                  <p className="text-xs text-son-silver-dim">{currency(i.unit_price)} cada</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRemoveTarget({ id: i.id, name: `${i.quantity}x ${i.product_name}` })}
                  disabled={busy}
                  className="text-son-silver-dim hover:text-son-pink flex-shrink-0 ml-2"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {error && <p className="error-msg mb-3">{error}</p>}

        <div className="flex items-center justify-between border-t border-white/10 pt-3">
          <span className="text-son-silver-dim text-sm">Total</span>
          <span className="text-son-gold font-black text-xl">{currency(comanda.total)}</span>
        </div>

        {impressaoModo !== 'nenhuma' && (
          <button
            type="button"
            onClick={printAndSendToKitchen}
            disabled={printing || comanda.items.every((i) => i.sent_to_kitchen_at)}
            className="btn-secondary w-full mt-4"
          >
            {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            Imprimir e mandar pra cozinha
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowPay(true)}
          disabled={comanda.items.length === 0}
          className="btn-primary w-full mt-2"
        >
          Pagar conta
        </button>
      </div>

      {choosingPrintMethod && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4" onClick={() => setChoosingPrintMethod(false)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-white mb-4">Imprimir por onde?</h3>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => runPrint('agente_local')} className="btn-primary w-full">
                Imprimir pelo agente local
              </button>
              <button type="button" onClick={() => runPrint('navegador')} className="btn-secondary w-full">
                Imprimir pelo navegador
              </button>
            </div>
          </div>
        </div>
      )}

      {showPay && (
        <PayComandaDialog
          comanda={comanda}
          onlinePix={onlinePix}
          onClose={() => setShowPay(false)}
          onPaid={onClosed}
        />
      )}

      {removeTarget && (
        <RemoveItemReasonDialog
          itemLabel={removeTarget.name}
          busy={busy}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={(reason) => removeItem(removeTarget.id, reason)}
        />
      )}
    </div>
  )
}

/** Remoção nunca é silenciosa -- exige justificativa não-vazia antes de
 * confirmar, sempre registrada no histórico da comanda. */
function RemoveItemReasonDialog({
  itemLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  itemLabel: string
  busy: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-white mb-1">Remover item</h3>
        <p className="text-sm text-son-silver-dim mb-4">Você está removendo: {itemLabel}</p>
        <label className="label">Justificativa obrigatória</label>
        <textarea
          className="input-field min-h-[80px]"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
          placeholder="Ex: cliente desistiu do item, item enviado errado..."
        />
        {reason.length > 0 && !trimmed && (
          <p className="error-msg mt-1">Informe uma justificativa para remover este item.</p>
        )}
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(trimmed)}
            disabled={busy || !trimmed}
            className="btn-primary flex-1"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Confirmar remoção
          </button>
        </div>
      </div>
    </div>
  )
}

function PayComandaDialog({
  comanda,
  onlinePix,
  onClose,
  onPaid,
}: {
  comanda: Comanda
  onlinePix: boolean
  onClose: () => void
  onPaid: () => void
}) {
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [pixOrder, setPixOrder] = useState<Order | null>(null)

  const pay = async () => {
    setBusy(true)
    setError(null)
    try {
      const order = await pdvService.comandas.pay(comanda.id, { payment_method: method, expected_version: comanda.version })
      if (method === 'pix' && onlinePix) {
        try {
          const withPix = await orderService.createPixPayment(order.id)
          setPixOrder(withPix)
        } catch {
          setError('Comanda fechada, mas não foi possível gerar o QR Pix. Confirme o pagamento manualmente em Pedidos.')
          onPaid()
        }
      } else {
        onPaid()
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível fechar a comanda.')
    } finally {
      setBusy(false)
    }
  }

  const confirmCash = async () => {
    if (!pixOrder) return
    setBusy(true)
    try {
      await orderService.refreshPayment(pixOrder.id)
      onPaid()
    } catch {
      /* segue mesmo se falhar -- comanda já fechou, pagamento é acompanhado normalmente em Pedidos */
      onPaid()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">Pagar conta</h3>
          <button onClick={onClose} className="text-son-silver-dim hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {pixOrder ? (
          <div className="text-center">
            {pixOrder.pix_copia_cola ? (
              <div className="bg-white rounded-2xl p-3 inline-block mb-3">
                <QRCodeSVG value={pixOrder.pix_copia_cola} size={200} />
              </div>
            ) : (
              <QrCode className="w-16 h-16 mx-auto text-son-gold mb-3" />
            )}
            <p className="text-son-gold font-bold text-lg mb-4">{currency(comanda.total)}</p>
            <button type="button" onClick={confirmCash} disabled={busy} className="btn-secondary w-full mb-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Já recebi o Pix
            </button>
            <button type="button" onClick={onPaid} className="text-xs text-son-silver-dim hover:text-white">
              Fechar (acompanhar pagamento depois em Pedidos)
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-son-silver-dim mb-4">
              Total: <span className="text-son-gold font-semibold">{currency(comanda.total)}</span>
            </p>
            <label className="label">Forma de pagamento</label>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {(['pix', 'cartao', 'dinheiro'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`py-2 rounded-xl border text-sm font-medium capitalize transition-all ${
                    method === m ? 'sunset-bg text-white border-transparent' : 'bg-son-surface border-white/10 text-son-silver'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {method !== 'pix' && (
              <label className="flex items-center gap-2 text-sm text-son-silver mb-4">
                <input type="checkbox" className="w-4 h-4 accent-son-pink" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                Confirmo que recebi o pagamento em {method}
              </label>
            )}
            {error && <p className="error-msg mb-3">{error}</p>}
            <button
              type="button"
              onClick={pay}
              disabled={busy || (method !== 'pix' && !confirmed)}
              className="btn-primary w-full"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {method === 'pix' ? 'Gerar Pix e fechar comanda' : 'Fechar comanda'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
