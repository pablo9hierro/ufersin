import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
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
import { authStore, useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
import { contentMapFromItems, CONTENT_DEFAULTS } from '../lib/cms'
import { isKnownPlatformAdminEmail } from '../lib/platformAdmin'
import { fetchPlans, formatBRL, invalidatePlansCache } from '../lib/plans'
import LayoutCmsEditor, { defaultPlansSeed } from '../components/cms/LayoutCmsEditor'

type Section = 'relatorios' | 'lojas' | 'layout' | 'cupons'

const NAV: { id: Section; label: string; icon: typeof BarChart3; path: string }[] = [
  { id: 'relatorios', label: 'Relatórios', icon: BarChart3, path: '/dashboard' },
  { id: 'lojas', label: 'Lojas', icon: Store, path: '/lojas' },
  { id: 'layout', label: 'Layout', icon: LayoutTemplate, path: '/layout' },
  { id: 'cupons', label: 'Cupons', icon: Tag, path: '/cupons' },
]

const PATH_TO_SECTION: Record<string, Section> = {
  '/dashboard': 'relatorios',
  '/lojas': 'lojas',
  '/layout': 'layout',
  '/cupons': 'cupons',
}

const SECTION_PATH: Record<Section, string> = {
  relatorios: '/dashboard',
  lojas: '/lojas',
  layout: '/layout',
  cupons: '/cupons',
}

export default function Dashboard() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const section: Section = PATH_TO_SECTION[location.pathname] ?? 'relatorios'
  const [guard, setGuard] = useState<'loading' | 'ok' | 'denied' | 'api_error'>('loading')
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
  const [contentMap, setContentMap] = useState<Record<string, string>>({ ...CONTENT_DEFAULTS })
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

  // Legacy `/dashboard?tab=lojas|layout|cupons|relatorios` → real paths
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (!tab) return
    if (tab === 'relatorios' || tab === 'lojas' || tab === 'layout' || tab === 'cupons') {
      navigate(SECTION_PATH[tab], { replace: true })
    }
  }, [searchParams, navigate])

  useEffect(() => {
    if (!isAuthenticated) return
    const sessionEmail = session?.user?.email ?? null
    if (isKnownPlatformAdminEmail(sessionEmail)) {
      setAdminEmail(sessionEmail)
    }
    api
      .superadminWhoami()
      .then((w) => {
        setAdminEmail(w.email)
        setGuard('ok')
      })
      .catch((e) => {
        // Known platform owner: never bounce to lojista hub, even if whoami 404.
        if (isKnownPlatformAdminEmail(sessionEmail)) {
          setError(
            e instanceof ApiError && e.status === 404
              ? 'API do painel ainda não publicou as rotas de superadmin. Aguarde o deploy do backend.'
              : e instanceof ApiError
                ? e.message
                : 'Não foi possível carregar dados do painel.',
          )
          setGuard('api_error')
          return
        }
        // Só lojista autenticado (403) vai pro hub. 401 → login.
        // 404/5xx = API sem rota superadmin / fora do ar — NÃO mostrar UI de lojista.
        if (e instanceof ApiError && e.status === 403) {
          setGuard('denied')
        } else if (e instanceof ApiError && e.status === 401) {
          setGuard('denied')
        } else {
          setError(
            e instanceof ApiError
              ? e.status === 404
                ? 'API do painel ainda não publicou as rotas de superadmin. Aguarde o deploy do backend.'
                : e.message
              : 'Não foi possível verificar acesso de superadmin.',
          )
          setGuard('api_error')
        }
      })
  }, [isAuthenticated, session?.user?.email])

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
    setContentMap(contentMapFromItems(ct))
    setPlans(pl)
    setPlanPrices(Object.fromEntries(pl.map((p) => [p.code, String(p.price_monthly)])))
    invalidatePlansCache()
    await fetchPlans()
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
  if (guard === 'api_error') {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <div>
          <p className="text-lg font-black mb-2">Painel Resolutoo (superadmin)</p>
          <p className="text-uf-silver-dim mb-4">{error || 'Falha ao verificar permissão.'}</p>
          <button type="button" className="btn-secondary text-sm px-4 py-2" onClick={() => window.location.reload()}>
            Tentar de novo
          </button>
        </div>
      </main>
    )
  }

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
      setContent((prev) => {
        const idx = prev.findIndex((c) => c.key === key)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], value }
          return next
        }
        return [...prev, { key, value }]
      })
      setContentMap((prev) => ({ ...prev, [key]: value }))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao salvar texto.')
      throw e
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

  const savePlanName = async (code: string, name: string) => {
    setBusy(true)
    try {
      await api.superadminUpdatePlan(code, { name })
      await loadLayout()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao salvar nome do plano.')
    } finally {
      setBusy(false)
    }
  }

  const togglePlanActive = async (code: string, active: boolean) => {
    // Optimistic per-code update — never share a single `active` across rows.
    setPlans((prev) => prev.map((p) => (p.code === code ? { ...p, active } : p)))
    setBusy(true)
    setError(null)
    try {
      const updated = await api.superadminUpdatePlan(code, { active })
      setPlans((prev) =>
        prev.map((p) =>
          p.code === code
            ? {
                ...p,
                active: updated.active,
                name: updated.name,
                price_monthly: updated.price_monthly,
                highlight: updated.highlight,
              }
            : p,
        ),
      )
      invalidatePlansCache()
      await fetchPlans()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao atualizar plano.')
      try {
        await loadLayout()
      } catch {
        /* keep optimistic until next refresh */
      }
    } finally {
      setBusy(false)
    }
  }

  const seedDefaultPlans = async () => {
    setBusy(true)
    setError(null)
    try {
      for (const p of defaultPlansSeed()) {
        await api.superadminCreatePlan({
          code: p.code,
          name: p.name,
          price_monthly: p.price,
          tagline: p.tagline,
          features: p.features,
          highlight: !!p.highlight,
          sort_order: p.sort_order,
        })
      }
      // Ensure CMS keys exist for demo/assinar tabs.
      for (const [key, value] of Object.entries(CONTENT_DEFAULTS)) {
        if (!content.find((c) => c.key === key)) {
          await api.superadminUpsertContent(key, value)
        }
      }
      await loadLayout()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao criar planos padrão.')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const isTimed = couponForm.duration_kind === 'timed'
    const days = parseInt(couponForm.duration_days, 10)
    const maxUses = parseInt(couponForm.max_redemptions, 10)
    if (isTimed && (!Number.isFinite(days) || days <= 0)) {
      setError('Informe a duração em dias para cupom por tempo limitado.')
      return
    }
    if (isTimed && (!Number.isFinite(maxUses) || maxUses <= 0)) {
      setError('Informe o máximo de resgates para cupom por tempo limitado.')
      return
    }
    setBusy(true)
    try {
      await api.superadminCreateCoupon({
        code: couponForm.code,
        discount_type: couponForm.discount_type,
        discount_value: parseFloat(couponForm.discount_value.replace(',', '.')),
        duration_kind: couponForm.duration_kind,
        // Vitalício: sem janela e sem teto — API força null também.
        duration_days: isTimed ? days : null,
        max_redemptions: isTimed ? maxUses : null,
        notes: couponForm.notes || undefined,
      })
      setCouponForm({
        code: '',
        discount_type: 'percent',
        discount_value: '10',
        duration_kind: 'lifetime_current_plan',
        duration_days: '30',
        max_redemptions: '',
        notes: '',
      })
      await loadCupons()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao criar cupom.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex">
      <aside className="w-56 shrink-0 border-r border-white/5 p-4 flex flex-col gap-1">
        <Link to="/" className="text-lg font-black uf-text px-3 py-2 mb-1 block">
          Resolutoo
        </Link>
        <p className="text-[10px] uppercase tracking-wider text-uf-silver-dim px-3 mb-4">Painel superadmin</p>
        {NAV.map(({ id, label, icon: Icon, path }) => (
          <Link
            key={id}
            to={path}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-left transition-colors ${
              section === id ? 'bg-white/10 text-white' : 'text-uf-silver-dim hover:text-uf-silver hover:bg-white/5'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        ))}
        <div className="mt-auto min-h-[72px] py-6 border-t border-white/5 flex flex-col justify-center">
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
          {section === 'layout' && (
            <p className="text-xs text-uf-silver-dim mt-1">Visual CMS — preview 1:1 com edição inline</p>
          )}
        </header>

        <div className={`p-6 ${section === 'layout' ? 'max-w-6xl' : 'max-w-4xl'}`}>
          {error && section !== 'layout' && <p className="error-msg mb-4">{error}</p>}

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
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <LayoutCmsEditor
                content={contentMap}
                onContentChange={(key, value) => setContentMap((prev) => ({ ...prev, [key]: value }))}
                onSaveContent={saveContent}
                plans={plans}
                planPrices={planPrices}
                onPlanPriceChange={(code, value) => setPlanPrices((prev) => ({ ...prev, [code]: value }))}
                onSavePlan={savePlanPrice}
                onToggleActive={togglePlanActive}
                onSavePlanName={savePlanName}
                onSeedDefaultPlans={seedDefaultPlans}
                busy={busy}
                error={error}
              />
            </motion.div>
          )}

          {section === 'cupons' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <section className="uf-glass rounded-2xl p-5">
                <h2 className="font-bold text-sm mb-4">Cupons ativos</h2>
                <ul className="space-y-2 mb-6">
                  {coupons.map((c) => {
                    const kindLabel =
                      c.duration_kind === 'lifetime_current_plan'
                        ? 'Vitalício no plano atual'
                        : `Tempo limitado${c.duration_days != null ? ` (${c.duration_days}d)` : ''}`
                    const usesLabel =
                      c.duration_kind === 'lifetime_current_plan'
                        ? `${c.redemptions} usos (ilimitado)`
                        : `${c.redemptions}${c.max_redemptions != null ? `/${c.max_redemptions}` : ''} usos`
                    return (
                      <li key={c.id} className="flex flex-wrap justify-between gap-2 text-sm py-2 border-b border-white/5">
                        <span className="font-mono font-semibold">{c.code}</span>
                        <span className="text-uf-silver-dim">
                          {c.discount_type === 'percent' ? `${c.discount_value}%` : `R$ ${formatBRL(c.discount_value)}`} · {kindLabel} ·{' '}
                          {usesLabel}
                        </span>
                      </li>
                    )
                  })}
                  {coupons.length === 0 && <li className="text-sm text-uf-silver-dim">Nenhum cupom.</li>}
                </ul>

                <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                  <Percent className="w-4 h-4" /> Novo cupom
                </h3>
                <form onSubmit={handleCreateCoupon} className="space-y-3">
                  <div>
                    <label className="label" htmlFor="coupon-code">
                      Código
                    </label>
                    <input
                      id="coupon-code"
                      className="input-field"
                      placeholder="Ex.: VITALICIO10"
                      value={couponForm.code}
                      onChange={(e) => setCouponForm((f) => ({ ...f, code: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label" htmlFor="coupon-discount-type">
                        Tipo de desconto
                      </label>
                      <select
                        id="coupon-discount-type"
                        className="input-field"
                        value={couponForm.discount_type}
                        onChange={(e) =>
                          setCouponForm((f) => ({ ...f, discount_type: e.target.value as 'fixed' | 'percent' }))
                        }
                      >
                        <option value="percent">Percentual</option>
                        <option value="fixed">Valor fixo</option>
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="coupon-discount-value">
                        Valor
                      </label>
                      <input
                        id="coupon-discount-value"
                        className="input-field"
                        placeholder={couponForm.discount_type === 'percent' ? '10' : '50'}
                        value={couponForm.discount_value}
                        onChange={(e) => setCouponForm((f) => ({ ...f, discount_value: e.target.value }))}
                        inputMode="decimal"
                        required
                      />
                    </div>
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="label mb-0">Duração do desconto</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Duração do desconto">
                      <button
                        type="button"
                        role="radio"
                        className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                          couponForm.duration_kind === 'lifetime_current_plan'
                            ? 'border-uf-blue bg-uf-blue/15 text-uf-silver'
                            : 'border-white/10 bg-white/[0.03] text-uf-silver-dim hover:border-white/20'
                        }`}
                        aria-checked={couponForm.duration_kind === 'lifetime_current_plan'}
                        onClick={() =>
                          setCouponForm((f) => ({
                            ...f,
                            duration_kind: 'lifetime_current_plan',
                            max_redemptions: '',
                          }))
                        }
                      >
                        <span className="block font-semibold text-uf-silver">Vitalício no plano atual</span>
                        <span className="block text-[11px] mt-0.5 text-uf-silver-dim">Sem prazo e sem limite de resgates</span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                          couponForm.duration_kind === 'timed'
                            ? 'border-uf-blue bg-uf-blue/15 text-uf-silver'
                            : 'border-white/10 bg-white/[0.03] text-uf-silver-dim hover:border-white/20'
                        }`}
                        aria-checked={couponForm.duration_kind === 'timed'}
                        onClick={() => setCouponForm((f) => ({ ...f, duration_kind: 'timed' }))}
                      >
                        <span className="block font-semibold text-uf-silver">Por tempo limitado</span>
                        <span className="block text-[11px] mt-0.5 text-uf-silver-dim">Define dias e máx. resgates</span>
                      </button>
                    </div>
                    {/* Hidden select keeps both values in the DOM for QA / crawlers / older muscle memory. */}
                    <select
                      id="coupon-duration-kind"
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                      value={couponForm.duration_kind}
                      onChange={(e) =>
                        setCouponForm((f) => ({
                          ...f,
                          duration_kind: e.target.value as 'timed' | 'lifetime_current_plan',
                          max_redemptions: e.target.value === 'lifetime_current_plan' ? '' : f.max_redemptions,
                        }))
                      }
                    >
                      <option value="lifetime_current_plan">Vitalício no plano atual</option>
                      <option value="timed">Por tempo limitado</option>
                    </select>
                  </fieldset>
                  {couponForm.duration_kind === 'lifetime_current_plan' ? (
                    <p className="text-[11px] text-uf-silver-dim">
                      Desconto enquanto o lojista permanecer no plano do resgate. Sem prazo e sem limite de resgates.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label" htmlFor="coupon-duration-days">
                          Dias de validade
                        </label>
                        <input
                          id="coupon-duration-days"
                          className="input-field"
                          placeholder="30"
                          value={couponForm.duration_days}
                          onChange={(e) => setCouponForm((f) => ({ ...f, duration_days: e.target.value }))}
                          inputMode="numeric"
                          required
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor="coupon-max-redemptions">
                          Máx. resgates
                        </label>
                        <input
                          id="coupon-max-redemptions"
                          className="input-field"
                          placeholder="100"
                          value={couponForm.max_redemptions}
                          onChange={(e) => setCouponForm((f) => ({ ...f, max_redemptions: e.target.value }))}
                          inputMode="numeric"
                          required
                        />
                      </div>
                    </div>
                  )}
                  {error && section === 'cupons' && <p className="text-sm text-red-400">{error}</p>}
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
