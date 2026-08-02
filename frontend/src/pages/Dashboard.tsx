import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  LayoutTemplate,
  Loader2,
  LogOut,
  Percent,
  Plus,
  Save,
  Store,
  Tag,
} from 'lucide-react'
import {
  api,
  ApiError,
  type PlatformContentItem,
  type PlatformPlan,
  type SuperadminCost,
  type SuperadminCoupon,
  type SuperadminOverview,
  type SuperadminStore,
} from '../lib/api'
import { authStore, useAuthReady, useIsAuthenticated } from '../lib/authStore'
import { formatBRL } from '../lib/plans'

type Section = 'relatorios' | 'lojas' | 'layout' | 'cupons'

const NAV: { id: Section; label: string; icon: typeof BarChart3 }[] = [
  { id: 'relatorios', label: 'Relatórios', icon: BarChart3 },
  { id: 'lojas', label: 'Lojas', icon: Store },
  { id: 'layout', label: 'Layout', icon: LayoutTemplate },
  { id: 'cupons', label: 'Cupons', icon: Tag },
]

const LANDING_KEYS = [
  'landing.hero.headline',
  'landing.hero.sub',
  'landing.pricing.title',
  'landing.pricing.sub',
]

export default function Dashboard() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const navigate = useNavigate()
  const [section, setSection] = useState<Section>('relatorios')
  const [guard, setGuard] = useState<'loading' | 'ok' | 'denied'>('loading')
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [overview, setOverview] = useState<SuperadminOverview | null>(null)
  const [costs, setCosts] = useState<SuperadminCost[]>([])
  const [newCostLabel, setNewCostLabel] = useState('')
  const [newCostAmount, setNewCostAmount] = useState('')

  const [stores, setStores] = useState<SuperadminStore[]>([])
  const [expandedStore, setExpandedStore] = useState<string | null>(null)
  const [storeCoupons, setStoreCoupons] = useState<Record<string, string>>({})

  const [content, setContent] = useState<PlatformContentItem[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [plans, setPlans] = useState<PlatformPlan[]>([])
  const [planPrices, setPlanPrices] = useState<Record<string, string>>({})

  const [coupons, setCoupons] = useState<SuperadminCoupon[]>([])
  const [couponForm, setCouponForm] = useState({
    code: '',
    discount_type: 'percent' as 'fixed' | 'percent',
    discount_value: '10',
    duration_kind: 'lifetime_current_plan' as 'timed' | 'lifetime_current_plan',
    duration_days: '30',
    max_redemptions: '',
    notes: '',
  })

  useEffect(() => {
    if (!isAuthenticated) return
    api
      .superadminWhoami()
      .then((w) => {
        setAdminEmail(w.email)
        setGuard('ok')
      })
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          setGuard('denied')
        } else {
          setError(e instanceof ApiError ? e.message : 'Não foi possível verificar acesso.')
          setGuard('denied')
        }
      })
  }, [isAuthenticated])

  const loadRelatorios = useCallback(async () => {
    const [ov, cs] = await Promise.all([api.superadminOverview(), api.superadminCosts()])
    setOverview(ov)
    setCosts(cs)
  }, [])

  const loadLojas = useCallback(async () => {
    setStores(await api.superadminStores())
  }, [])

  const loadLayout = useCallback(async () => {
    const [ct, pl] = await Promise.all([api.listPublicContent(), api.superadminPlans()])
    setContent(ct)
    setPlans(pl)
    setPlanPrices(Object.fromEntries(pl.map((p) => [p.code, String(p.price_monthly)])))
  }, [])

  const loadCupons = useCallback(async () => {
    setCoupons(await api.superadminCoupons())
  }, [])

  useEffect(() => {
    if (guard !== 'ok') return
    setError(null)
    const load =
      section === 'relatorios'
        ? loadRelatorios
        : section === 'lojas'
          ? loadLojas
          : section === 'layout'
            ? loadLayout
            : loadCupons
    load().catch((e) => setError(e instanceof ApiError ? e.message : 'Erro ao carregar dados.'))
  }, [guard, section, loadRelatorios, loadLojas, loadLayout, loadCupons])

  if (!ready) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (guard === 'loading') {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (guard === 'denied') return <Navigate to="/meu-plano" replace />

  const handleLogout = async () => {
    await authStore.signOut()
    navigate('/')
  }

  const handleCreateCost = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseFloat(newCostAmount.replace(',', '.'))
    if (!newCostLabel.trim() || Number.isNaN(amount)) return
    setBusy(true)
    try {
      await api.superadminCreateCost({ label: newCostLabel.trim(), amount_monthly: amount })
      setNewCostLabel('')
      setNewCostAmount('')
      await loadRelatorios()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao criar custo.')
    } finally {
      setBusy(false)
    }
  }

  const handleApplyStoreCoupon = async (storeId: string) => {
    const code = storeCoupons[storeId]?.trim()
    if (!code) return
    setBusy(true)
    try {
      await api.superadminApplyStoreCoupon(storeId, code)
      await loadLojas()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao aplicar cupom.')
    } finally {
      setBusy(false)
    }
  }

  const saveContent = async (key: string, value: string) => {
    setBusy(true)
    try {
      await api.superadminUpsertContent(key, value)
      setContent((prev) => prev.map((c) => (c.key === key ? { ...c, value } : c)))
      setEditingKey(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao salvar texto.')
    } finally {
      setBusy(false)
    }
  }

  const savePlanPrice = async (code: string) => {
    const price = parseFloat(planPrices[code]?.replace(',', '.') ?? '')
    if (Number.isNaN(price) || price <= 0) return
    setBusy(true)
    try {
      await api.superadminUpdatePlan(code, { price_monthly: price })
      await loadLayout()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao salvar plano.')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.superadminCreateCoupon({
        code: couponForm.code,
        discount_type: couponForm.discount_type,
        discount_value: parseFloat(couponForm.discount_value.replace(',', '.')),
        duration_kind: couponForm.duration_kind,
        duration_days: couponForm.duration_kind === 'timed' ? parseInt(couponForm.duration_days, 10) : undefined,
        max_redemptions: couponForm.max_redemptions ? parseInt(couponForm.max_redemptions, 10) : undefined,
        notes: couponForm.notes || undefined,
      })
      setCouponForm({ code: '', discount_type: 'percent', discount_value: '10', duration_kind: 'lifetime_current_plan', duration_days: '30', max_redemptions: '', notes: '' })
      await loadCupons()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao criar cupom.')
    } finally {
      setBusy(false)
    }
  }

  const landingContent = LANDING_KEYS.map((key) => content.find((c) => c.key === key) ?? { key, value: '' })

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex">
      <aside className="w-56 shrink-0 border-r border-white/5 p-4 flex flex-col gap-1">
        <Link to="/" className="text-lg font-black uf-text px-3 py-2 mb-4 block">
          Resolutoo
        </Link>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-left transition-colors ${
              section === id ? 'bg-white/10 text-white' : 'text-uf-silver-dim hover:text-uf-silver hover:bg-white/5'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </button>
        ))}
        <div className="mt-auto pt-4 border-t border-white/5">
          {adminEmail && <p className="text-[10px] text-uf-silver-dim px-3 mb-2 truncate">{adminEmail}</p>}
          <button onClick={handleLogout} className="btn-ghost text-sm w-full justify-start px-3">
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </aside>

      <div className="flex-1 overflow-auto">
        <header className="border-b border-white/5 px-6 py-4">
          <h1 className="text-xl font-black">{NAV.find((n) => n.id === section)?.label}</h1>
        </header>

        <div className="p-6 max-w-4xl">
          {error && <p className="error-msg mb-4">{error}</p>}

          {section === 'relatorios' && overview && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { label: 'MRR', value: `R$ ${formatBRL(overview.mrr)}` },
                  { label: 'Custos/mês', value: `R$ ${formatBRL(overview.custos_mensais)}` },
                  { label: 'Lucro est.', value: `R$ ${formatBRL(overview.lucro_estimado)}` },
                ].map((s) => (
                  <div key={s.label} className="uf-glass rounded-2xl p-5">
                    <p className="text-xs text-uf-silver-dim uppercase tracking-wide">{s.label}</p>
                    <p className="text-2xl font-black mt-1">{s.value}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm text-uf-silver-dim">
                {overview.lojas_ativas} lojas ativas · {overview.lojas_total} total
              </p>

              <section className="uf-glass rounded-2xl p-5">
                <h2 className="font-bold text-sm mb-4">Custos operacionais</h2>
                <ul className="space-y-2 mb-4">
                  {costs.map((c) => (
                    <li key={c.id} className="flex justify-between text-sm py-2 border-b border-white/5 last:border-0">
                      <span>
                        {c.label}
                        {!c.active && <span className="text-uf-silver-dim ml-2">(inativo)</span>}
                      </span>
                      <span className="font-semibold">R$ {formatBRL(c.amount_monthly)}/mês</span>
                    </li>
                  ))}
                  {costs.length === 0 && <li className="text-sm text-uf-silver-dim">Nenhum custo cadastrado.</li>}
                </ul>
                <form onSubmit={handleCreateCost} className="flex flex-wrap gap-2 items-end">
                  <div className="flex-1 min-w-[140px]">
                    <label className="label text-xs">Descrição</label>
                    <input className="input-field" value={newCostLabel} onChange={(e) => setNewCostLabel(e.target.value)} />
                  </div>
                  <div className="w-32">
                    <label className="label text-xs">R$/mês</label>
                    <input className="input-field" value={newCostAmount} onChange={(e) => setNewCostAmount(e.target.value)} inputMode="decimal" />
                  </div>
                  <button type="submit" disabled={busy} className="btn-primary px-4 py-2.5 text-sm">
                    <Plus className="w-4 h-4" />
                    Adicionar
                  </button>
                </form>
              </section>
            </motion.div>
          )}

          {section === 'lojas' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
              {stores.map((s) => {
                const open = expandedStore === s.id
                return (
                  <div key={s.id} className="uf-glass rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedStore(open ? null : s.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5"
                    >
                      {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{s.loja_nome}</p>
                        <p className="text-xs text-uf-silver-dim truncate">{s.email}</p>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/10">{s.status}</span>
                    </button>
                    {open && (
                      <div className="px-4 pb-4 pt-1 border-t border-white/5 text-sm space-y-2">
                        <p>
                          <span className="text-uf-silver-dim">Plano:</span> {s.plan_code ?? '—'}{' '}
                          {s.valor_mensal != null && `· R$ ${formatBRL(s.valor_mensal)}/mês`}
                        </p>
                        <p>
                          <span className="text-uf-silver-dim">WhatsApp:</span> {s.whatsapp}
                        </p>
                        <p>
                          <span className="text-uf-silver-dim">Slug:</span> {s.slug ?? '—'} · Onboarding: {s.onboarding_status}
                        </p>
                        {s.coupon_code && (
                          <p>
                            <span className="text-uf-silver-dim">Cupom:</span> {s.coupon_code}
                          </p>
                        )}
                        <div className="flex gap-2 pt-2">
                          <input
                            className="input-field flex-1 text-sm"
                            placeholder="Código do cupom"
                            value={storeCoupons[s.id] ?? ''}
                            onChange={(e) => setStoreCoupons((prev) => ({ ...prev, [s.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleApplyStoreCoupon(s.id)}
                            className="btn-secondary text-xs px-3 py-2 shrink-0"
                          >
                            Aplicar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              {stores.length === 0 && <p className="text-sm text-uf-silver-dim">Nenhuma loja cadastrada.</p>}
            </motion.div>
          )}

          {section === 'layout' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <section className="uf-glass rounded-2xl p-5">
                <h2 className="font-bold text-sm mb-3">Textos da landing</h2>
                <p className="text-xs text-uf-silver-dim mb-4">Duplo clique num texto para editar.</p>
                <dl className="space-y-3">
                  {landingContent.map(({ key, value }) => (
                    <div key={key}>
                      <dt className="text-[10px] text-uf-silver-dim font-mono mb-1">{key}</dt>
                      {editingKey === key ? (
                        <div className="flex gap-2">
                          <input
                            className="input-field flex-1 text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveContent(key, editValue)
                              if (e.key === 'Escape') setEditingKey(null)
                            }}
                          />
                          <button type="button" disabled={busy} onClick={() => saveContent(key, editValue)} className="btn-primary px-3 py-2">
                            <Save className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <dd
                          className="text-sm cursor-pointer hover:bg-white/5 rounded-lg px-2 py-1.5 -mx-2"
                          onDoubleClick={() => {
                            setEditingKey(key)
                            setEditValue(value)
                          }}
                        >
                          {value || <span className="text-uf-silver-dim italic">(vazio)</span>}
                        </dd>
                      )}
                    </div>
                  ))}
                </dl>
              </section>

              <section className="uf-glass rounded-2xl p-5">
                <h2 className="font-bold text-sm mb-4">Preços dos planos</h2>
                <div className="space-y-3">
                  {plans.map((p) => (
                    <div key={p.code} className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold text-sm w-28">{p.name}</span>
                      <input
                        className="input-field w-28 text-sm"
                        value={planPrices[p.code] ?? ''}
                        onChange={(e) => setPlanPrices((prev) => ({ ...prev, [p.code]: e.target.value }))}
                        inputMode="decimal"
                      />
                      <span className="text-xs text-uf-silver-dim">R$/mês</span>
                      <button type="button" disabled={busy} onClick={() => savePlanPrice(p.code)} className="btn-secondary text-xs px-3 py-2">
                        Salvar
                      </button>
                    </div>
                  ))}
                  {plans.length === 0 && <p className="text-sm text-uf-silver-dim">Nenhum plano no banco — cadastre via API ou migration.</p>}
                </div>
              </section>
            </motion.div>
          )}

          {section === 'cupons' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <section className="uf-glass rounded-2xl p-5">
                <h2 className="font-bold text-sm mb-4">Cupons ativos</h2>
                <ul className="space-y-2 mb-6">
                  {coupons.map((c) => (
                    <li key={c.id} className="flex flex-wrap justify-between gap-2 text-sm py-2 border-b border-white/5">
                      <span className="font-mono font-semibold">{c.code}</span>
                      <span className="text-uf-silver-dim">
                        {c.discount_type === 'percent' ? `${c.discount_value}%` : `R$ ${formatBRL(c.discount_value)}`} · {c.duration_kind}
                        {c.duration_days != null && ` (${c.duration_days}d)`} · {c.redemptions}
                        {c.max_redemptions != null ? `/${c.max_redemptions}` : ''} usos
                      </span>
                    </li>
                  ))}
                  {coupons.length === 0 && <li className="text-sm text-uf-silver-dim">Nenhum cupom.</li>}
                </ul>

                <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                  <Percent className="w-4 h-4" /> Novo cupom
                </h3>
                <form onSubmit={handleCreateCoupon} className="space-y-3">
                  <input className="input-field" placeholder="Código" value={couponForm.code} onChange={(e) => setCouponForm((f) => ({ ...f, code: e.target.value }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      className="input-field"
                      value={couponForm.discount_type}
                      onChange={(e) => setCouponForm((f) => ({ ...f, discount_type: e.target.value as 'fixed' | 'percent' }))}
                    >
                      <option value="percent">Percentual</option>
                      <option value="fixed">Valor fixo</option>
                    </select>
                    <input
                      className="input-field"
                      placeholder="Valor"
                      value={couponForm.discount_value}
                      onChange={(e) => setCouponForm((f) => ({ ...f, discount_value: e.target.value }))}
                      inputMode="decimal"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      className="input-field"
                      value={couponForm.duration_kind}
                      onChange={(e) => setCouponForm((f) => ({ ...f, duration_kind: e.target.value as 'timed' | 'lifetime_current_plan' }))}
                    >
                      <option value="lifetime_current_plan">Vitalício no plano atual</option>
                      <option value="timed">Por tempo limitado</option>
                    </select>
                    {couponForm.duration_kind === 'timed' && (
                      <input
                        className="input-field"
                        placeholder="Dias"
                        value={couponForm.duration_days}
                        onChange={(e) => setCouponForm((f) => ({ ...f, duration_days: e.target.value }))}
                        inputMode="numeric"
                      />
                    )}
                  </div>
                  <input
                    className="input-field"
                    placeholder="Máx. resgates (opcional)"
                    value={couponForm.max_redemptions}
                    onChange={(e) => setCouponForm((f) => ({ ...f, max_redemptions: e.target.value }))}
                    inputMode="numeric"
                  />
                  <button type="submit" disabled={busy} className="btn-primary w-full py-2.5 text-sm">
                    Criar cupom
                  </button>
                </form>
              </section>
            </motion.div>
          )}
        </div>
      </div>
    </main>
  )
}
