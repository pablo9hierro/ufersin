import { useEffect, useState } from 'react'
import { Check, Eye, Loader2, MapPinned, Pencil, Plus, Save, Store, Trash2, Truck, Wallet, X } from 'lucide-react'
import Card from '../../components/ui/Card'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { api, ApiError } from '../../lib/api'
import type { Motoboy, PaymentMethod, Vendedor } from '../../lib/types'

const EMPTY_MOTOBOY_FORM = { name: '', phone: '', email: '', password: '', whatsapp: '' }
const EMPTY_VENDEDOR_FORM = { name: '', email: '', password: '', commission_active: false, commission_percent: '' }

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function FreteSettingsCard() {
  const [pricePerKm, setPricePerKm] = useState('')
  const [maxKm, setMaxKm] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.shippingSettings.get().then((settings) => {
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
      const updated = await api.admin.shippingSettings.update(value, maxValue)
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
    <Card className="p-4 mb-6">
      <p className="label mb-3 flex items-center gap-1.5">
        <MapPinned className="w-3.5 h-3.5" /> Frete
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

export default function AdminMotoboys() {
  const { askConfirm, confirmDialogElement } = useConfirmDialog()
  const [tab, setTab] = useState<'motoboys' | 'vendedores'>('motoboys')

  const [motoboys, setMotoboys] = useState<Motoboy[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_MOTOBOY_FORM)
  const [editingMotoboy, setEditingMotoboy] = useState<Motoboy | null>(null)
  const [saving, setSaving] = useState(false)

  // Ver a senha atual (não é um reset) — só o admin acessa essa tela, e
  // funcionário nenhum tem tela própria de "trocar senha": quem define/
  // reseta/mostra a senha de um motoboy ou vendedor é exclusivamente o
  // admin, aqui.
  const [passwordPopup, setPasswordPopup] = useState<{ name: string; password: string | null; loading: boolean } | null>(null)
  const viewPassword = async (kind: 'motoboy' | 'vendedor', id: string, name: string) => {
    setPasswordPopup({ name, password: null, loading: true })
    try {
      const password = kind === 'motoboy' ? await api.admin.motoboys.getPassword(id) : await api.admin.vendedores.getPassword(id)
      setPasswordPopup({ name, password, loading: false })
    } catch {
      setPasswordPopup({ name, password: null, loading: false })
    }
  }

  const [payingMotoboy, setPayingMotoboy] = useState<Motoboy | null>(null)
  const [pendingAmount, setPendingAmount] = useState<number | null>(null)
  const [pendingLoading, setPendingLoading] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [vendedoresLoading, setVendedoresLoading] = useState(true)
  const [showVendedorForm, setShowVendedorForm] = useState(false)
  const [vendedorForm, setVendedorForm] = useState(EMPTY_VENDEDOR_FORM)
  const [editingVendedor, setEditingVendedor] = useState<Vendedor | null>(null)
  const [savingVendedor, setSavingVendedor] = useState(false)

  const load = () => {
    setLoading(true)
    api.admin.motoboys.list().then(setMotoboys).finally(() => setLoading(false))
  }
  const loadVendedores = () => {
    setVendedoresLoading(true)
    api.admin.vendedores.list().then(setVendedores).finally(() => setVendedoresLoading(false))
  }
  useEffect(() => {
    load()
    loadVendedores()
  }, [])

  const openNewMotoboy = () => {
    setEditingMotoboy(null)
    setForm(EMPTY_MOTOBOY_FORM)
    setShowForm(true)
  }
  const openEditMotoboy = (m: Motoboy) => {
    setEditingMotoboy(m)
    setForm({ name: m.name, phone: m.phone, email: m.email, password: '', whatsapp: m.whatsapp ?? '' })
    setShowForm(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      if (editingMotoboy) {
        await api.admin.motoboys.update(editingMotoboy.id, { ...form, active: editingMotoboy.active })
      } else {
        await api.admin.motoboys.create(form)
      }
      setShowForm(false)
      setEditingMotoboy(null)
      setForm(EMPTY_MOTOBOY_FORM)
      load()
    } finally {
      setSaving(false)
    }
  }

  const remove = (id: string) =>
    askConfirm('Remover este motoboy?', async () => {
      await api.admin.motoboys.delete(id)
      load()
    })

  const toggleActive = async (m: Motoboy) => {
    await api.admin.motoboys.update(m.id, { active: !m.active })
    load()
  }

  const openPay = async (m: Motoboy) => {
    setPayingMotoboy(m)
    setPayError(null)
    setPaymentMethod('pix')
    setPendingAmount(null)
    setPendingLoading(true)
    try {
      const data = await api.admin.motoboys.pending(m.id)
      setPendingAmount(data.pending_amount)
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : 'Não foi possível consultar o valor acumulado.')
    } finally {
      setPendingLoading(false)
    }
  }

  const confirmPay = async () => {
    if (!payingMotoboy) return
    setPaying(true)
    setPayError(null)
    try {
      await api.admin.motoboys.pay(payingMotoboy.id, paymentMethod)
      setPayingMotoboy(null)
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : 'Não foi possível registrar o pagamento.')
    } finally {
      setPaying(false)
    }
  }

  const openNewVendedor = () => {
    setEditingVendedor(null)
    setVendedorForm(EMPTY_VENDEDOR_FORM)
    setShowVendedorForm(true)
  }
  const openEditVendedor = (v: Vendedor) => {
    setEditingVendedor(v)
    setVendedorForm({
      name: v.name,
      email: v.email,
      password: '',
      commission_active: v.commission_active,
      commission_percent: v.commission_percent != null ? String(v.commission_percent) : '',
    })
    setShowVendedorForm(true)
  }

  const saveVendedor = async () => {
    setSavingVendedor(true)
    try {
      const payload = {
        name: vendedorForm.name,
        email: vendedorForm.email,
        commission_active: vendedorForm.commission_active,
        commission_percent: vendedorForm.commission_active ? Number(vendedorForm.commission_percent) : undefined,
      }
      if (editingVendedor) {
        await api.admin.vendedores.update(editingVendedor.id, {
          ...payload,
          active: editingVendedor.active,
          password: vendedorForm.password || undefined,
        })
      } else {
        await api.admin.vendedores.create({ ...payload, password: vendedorForm.password })
      }
      setShowVendedorForm(false)
      setEditingVendedor(null)
      setVendedorForm(EMPTY_VENDEDOR_FORM)
      loadVendedores()
    } finally {
      setSavingVendedor(false)
    }
  }

  const removeVendedor = (id: string) =>
    askConfirm('Remover este vendedor?', async () => {
      await api.admin.vendedores.delete(id)
      loadVendedores()
    })

  const toggleVendedorActive = async (v: Vendedor) => {
    await api.admin.vendedores.update(v.id, {
      name: v.name,
      email: v.email,
      active: !v.active,
      commission_active: v.commission_active,
      commission_percent: v.commission_percent ?? undefined,
    })
    loadVendedores()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black">Cadastrar funcionários</h1>
        <button
          onClick={() => (tab === 'motoboys' ? openNewMotoboy() : openNewVendedor())}
          className="btn-primary text-sm py-2 px-4"
        >
          <Plus className="w-4 h-4" /> {tab === 'motoboys' ? 'Novo motoboy' : 'Novo vendedor'}
        </button>
      </div>

      <FreteSettingsCard />

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('motoboys')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            tab === 'motoboys' ? 'sunset-bg text-white' : 'bg-son-surface border border-white/5 text-son-silver-dim'
          }`}
        >
          <Truck className="w-3.5 h-3.5" /> Motoboys
        </button>
        <button
          onClick={() => setTab('vendedores')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            tab === 'vendedores' ? 'sunset-bg text-white' : 'bg-son-surface border border-white/5 text-son-silver-dim'
          }`}
        >
          <Store className="w-3.5 h-3.5" /> Vendedores
        </button>
      </div>

      {tab === 'motoboys' &&
        (loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
          </div>
        ) : motoboys.length === 0 ? (
          <div className="text-center py-16 text-son-silver-dim">
            <Truck className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Nenhum motoboy cadastrado.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {motoboys.map((m) => (
              <Card key={m.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{m.name}</p>
                  <p className="text-xs text-son-silver-dim truncate">{m.email}</p>
                  <p className="text-xs text-son-silver-dim">{m.phone}</p>
                  {m.whatsapp && <p className="text-xs text-son-silver-dim">WhatsApp: {m.whatsapp}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => viewPassword('motoboy', m.id, m.name)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Ver senha de ${m.name}`}
                    title="Ver senha atual"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEditMotoboy(m)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Editar ${m.name}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openPay(m)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-son-pink/15 text-son-pink hover:bg-son-pink/25 transition-colors"
                    aria-label={`Pagar ${m.name}`}
                  >
                    <Wallet className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => toggleActive(m)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                      m.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/10 text-son-silver-dim'
                    }`}
                  >
                    {m.active ? 'Ativo' : 'Inativo'}
                  </button>
                  <button onClick={() => remove(m.id)} className="text-son-silver-dim hover:text-son-pink">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {tab === 'vendedores' &&
        (vendedoresLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
          </div>
        ) : vendedores.length === 0 ? (
          <div className="text-center py-16 text-son-silver-dim">
            <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Nenhum vendedor cadastrado.</p>
            <p className="text-xs mt-1">Vendedor acessa só a tela de PDV e Financeiro (suas vendas), com login próprio.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {vendedores.map((v) => (
              <Card key={v.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{v.name}</p>
                  <p className="text-xs text-son-silver-dim truncate">{v.email}</p>
                  {v.commission_active && (
                    <p className="text-xs text-son-gold">Comissão: {v.commission_percent}%</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => viewPassword('vendedor', v.id, v.name)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Ver senha de ${v.name}`}
                    title="Ver senha atual"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEditVendedor(v)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Editar ${v.name}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => toggleVendedorActive(v)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                      v.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/10 text-son-silver-dim'
                    }`}
                  >
                    {v.active ? 'Ativo' : 'Inativo'}
                  </button>
                  <button onClick={() => removeVendedor(v.id)} className="text-son-silver-dim hover:text-son-pink">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{editingMotoboy ? 'Editar motoboy' : 'Novo motoboy'}</h3>
              <button onClick={() => setShowForm(false)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Nome</label>
                <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Telefone</label>
                <input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="label">E-mail</label>
                <input className="input-field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="label">WhatsApp (pra conectar a instância dele)</label>
                <input className="input-field" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
              </div>
              <div>
                <label className="label">Senha{editingMotoboy && ' (deixe em branco pra manter a atual)'}</label>
                <input
                  className="input-field"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <button onClick={save} disabled={saving} className="btn-primary w-full mt-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {showVendedorForm && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowVendedorForm(false)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{editingVendedor ? 'Editar vendedor' : 'Novo vendedor'}</h3>
              <button onClick={() => setShowVendedorForm(false)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Nome</label>
                <input
                  className="input-field"
                  value={vendedorForm.name}
                  onChange={(e) => setVendedorForm({ ...vendedorForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">E-mail</label>
                <input
                  className="input-field"
                  type="email"
                  value={vendedorForm.email}
                  onChange={(e) => setVendedorForm({ ...vendedorForm, email: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Senha{editingVendedor && ' (deixe em branco pra manter a atual)'}</label>
                <input
                  className="input-field"
                  type="password"
                  value={vendedorForm.password}
                  onChange={(e) => setVendedorForm({ ...vendedorForm, password: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-son-silver">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-son-pink"
                  checked={vendedorForm.commission_active}
                  onChange={(e) => setVendedorForm({ ...vendedorForm, commission_active: e.target.checked })}
                />
                Comissão sobre as vendas
              </label>
              {vendedorForm.commission_active && (
                <div>
                  <label className="label">Percentual de comissão (%)</label>
                  <input
                    className="input-field"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={vendedorForm.commission_percent}
                    onChange={(e) => setVendedorForm({ ...vendedorForm, commission_percent: e.target.value })}
                  />
                  <p className="text-xs text-son-silver-dim mt-1">Aplicado sobre o valor de cada venda feita por ele no PDV.</p>
                </div>
              )}
              <p className="text-xs text-son-silver-dim">
                O vendedor loga em /funcionarios/login (login próprio, separado do admin) e cai no próprio painel em
                /funcionarios/vendedor, com Pedidos, PDV e Financeiro (suas vendas).
              </p>
              <button onClick={saveVendedor} disabled={savingVendedor} className="btn-primary w-full mt-2">
                {savingVendedor ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {payingMotoboy && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setPayingMotoboy(null)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Pagar {payingMotoboy.name}</h3>
              <button onClick={() => setPayingMotoboy(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {pendingLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center py-3">
                  <p className="text-xs text-son-silver-dim mb-1">Valor acumulado (frete, 100% do motoboy)</p>
                  <p className="sunset-text font-black text-3xl">{currency(pendingAmount ?? 0)}</p>
                </div>

                {payError && <p className="error-msg">{payError}</p>}

                {(pendingAmount ?? 0) > 0 ? (
                  <>
                    <div>
                      <label className="label">Forma de pagamento</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['pix', 'dinheiro'] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setPaymentMethod(value)}
                            className={`py-3 rounded-2xl border text-sm font-medium transition-all capitalize ${
                              paymentMethod === value
                                ? 'sunset-bg text-white border-transparent'
                                : 'bg-son-surface border-white/10 text-son-silver hover:border-son-pink/30'
                            }`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button onClick={confirmPay} disabled={paying} className="btn-primary w-full">
                      {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Confirmar pagamento
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-son-silver-dim text-center">Nada pendente pra pagar agora.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {passwordPopup && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPasswordPopup(null)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Senha de {passwordPopup.name}</h3>
              <button onClick={() => setPasswordPopup(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {passwordPopup.loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
              </div>
            ) : passwordPopup.password ? (
              <p className="text-center font-mono text-lg tracking-wide bg-son-surface-light rounded-xl py-3">
                {passwordPopup.password}
              </p>
            ) : (
              <p className="text-sm text-son-silver-dim text-center">
                Nenhuma senha salva pra visualizar ainda — edite e defina uma senha nova pra poder vê-la depois.
              </p>
            )}
          </div>
        </div>
      )}
      {confirmDialogElement}
    </div>
  )
}
