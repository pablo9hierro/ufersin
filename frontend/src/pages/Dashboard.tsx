import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CreditCard,
  LayoutTemplate,
  Loader2,
  LogOut,
  Pencil,
  Percent,
  Plus,
  Store,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import {
  api,
  ApiError,
  type PlatformContentItem,
  type PlatformPlan,
  type SuperadminAiEngine,
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

type Section = 'relatorios' | 'lojas' | 'layout' | 'cupons' | 'financeiro' | 'ia'

const NAV: { id: Section; label: string; icon: typeof BarChart3; path: string }[] = [
  { id: 'relatorios', label: 'Relatórios', icon: BarChart3, path: '/dashboard' },
  { id: 'lojas', label: 'Lojas', icon: Store, path: '/lojas' },
  { id: 'layout', label: 'Layout', icon: LayoutTemplate, path: '/layout' },
  { id: 'cupons', label: 'Cupons', icon: Tag, path: '/cupons' },
  { id: 'financeiro', label: 'Financeiro', icon: CreditCard, path: '/financeiro' },
  { id: 'ia', label: 'Motores de IA', icon: Bot, path: '/motores-ia' },
]

const PATH_TO_SECTION: Record<string, Section> = {
  '/dashboard': 'relatorios',
  '/lojas': 'lojas',
  '/layout': 'layout',
  '/cupons': 'cupons',
  '/financeiro': 'financeiro',
  '/motores-ia': 'ia',
}

const SECTION_PATH: Record<Section, string> = {
  relatorios: '/dashboard',
  lojas: '/lojas',
  layout: '/layout',
  cupons: '/cupons',
  financeiro: '/financeiro',
  ia: '/motores-ia',
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

  // Conta Mercado Pago DA RESOLUTOO (recebe as assinaturas dos lojistas) —
  // nunca a conta MP de um lojista individual (essa fica em /onboarding e
  // /meu-plano/financeiro, separada de propósito).
  const [mpConnected, setMpConnected] = useState(false)
  const [mpConnecting, setMpConnecting] = useState(false)
  const [mpDisconnecting, setMpDisconnecting] = useState(false)

  const [stores, setStores] = useState<SuperadminStore[]>([])
  const [expandedStore, setExpandedStore] = useState<string | null>(null)
  const [storeCoupons, setStoreCoupons] = useState<Record<string, string>>({})

  const [content, setContent] = useState<PlatformContentItem[]>([])
  const [contentMap, setContentMap] = useState<Record<string, string>>({ ...CONTENT_DEFAULTS })
  const [plans, setPlans] = useState<PlatformPlan[]>([])
  const [planPrices, setPlanPrices] = useState<Record<string, string>>({})

  const [aiEngines, setAiEngines] = useState<SuperadminAiEngine[]>([])
  const [newEngineLabel, setNewEngineLabel] = useState('')
  const [newEngineProvider, setNewEngineProvider] = useState<'openai' | 'openrouter'>('openrouter')
  const [newEngineModel, setNewEngineModel] = useState('')

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
  const [editingCouponId, setEditingCouponId] = useState<string | null>(null)
  const [editCouponForm, setEditCouponForm] = useState({
    discount_type: 'percent' as 'fixed' | 'percent',
    discount_value: '10',
    duration_kind: 'lifetime_current_plan' as 'timed' | 'lifetime_current_plan',
    duration_days: '30',
    max_redemptions: '',
    notes: '',
    active: true,
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

  const loadFinanceiro = useCallback(async () => {
    const status = await api.superadminMercadoPagoStatus()
    setMpConnected(status.connected)
  }, [])

  const loadCupons = useCallback(async () => {
    setCoupons(await api.superadminCoupons())
  }, [])

  const loadAiEngines = useCallback(async () => {
    setAiEngines(await api.superadminAiEngines())
  }, [])

  const handleConnectMp = async () => {
    setError(null)
    setMpConnecting(true)
    try {
      const { authorize_url } = await api.superadminMercadoPagoOAuthStart()
      window.location.href = authorize_url
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível conectar o Mercado Pago.')
      setMpConnecting(false)
    }
  }

  const handleDisconnectMp = async () => {
    setError(null)
    setMpDisconnecting(true)
    try {
      await api.superadminMercadoPagoOAuthDisconnect()
      setMpConnected(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível desconectar o Mercado Pago.')
    } finally {
      setMpDisconnecting(false)
    }
  }

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
            : section === 'financeiro'
              ? loadFinanceiro
              : section === 'ia'
                ? loadAiEngines
                : loadCupons
    load().catch((e) => setError(e instanceof ApiError ? e.message : 'Erro ao carregar dados.'))
  }, [guard, section, loadRelatorios, loadLojas, loadLayout, loadFinanceiro, loadAiEngines, loadCupons])

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
    try {
      await authStore.signOut('superadmin')
    } finally {
      navigate('/')
    }
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

  const handleCreateAiEngine = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEngineLabel.trim() || !newEngineModel.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.superadminCreateAiEngine({ label: newEngineLabel.trim(), provider: newEngineProvider, model: newEngineModel.trim() })
      setNewEngineLabel('')
      setNewEngineModel('')
      await loadAiEngines()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao criar motor de IA.')
    } finally {
      setBusy(false)
    }
  }

  const handleToggleAiEngine = async (id: string, enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await api.superadminUpdateAiEngine(id, { enabled })
      await loadAiEngines()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao atualizar motor de IA.')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteAiEngine = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.superadminDeleteAiEngine(id)
      await loadAiEngines()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao remover motor de IA.')
    } finally {
      setBusy(false)
    }
  }

  /** Sobe/desce o motor no ranking — troca de posição com o vizinho e manda a lista inteira reordenada. */
  const handleMoveAiEngine = async (id: string, direction: 'up' | 'down') => {
    const idx = aiEngines.findIndex((e) => e.id === id)
    const swapWith = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swapWith < 0 || swapWith >= aiEngines.length) return
    const reordered = [...aiEngines]
    ;[reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]]
    setAiEngines(reordered) // otimista — evita esperar round-trip só pra ver a lista mexer
    setBusy(true)
    setError(null)
    try {
      await api.superadminReorderAiEngines(reordered.map((e) => e.id))
      await loadAiEngines()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao reordenar motores de IA.')
      await loadAiEngines().catch(() => {})
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
    const maxUsesRaw = couponForm.max_redemptions.trim()
    const maxUses = maxUsesRaw ? parseInt(maxUsesRaw, 10) : null
    if (isTimed && (!Number.isFinite(days) || days <= 0)) {
      setError('Informe a duração em dias para cupom por tempo limitado.')
      return
    }
    if (maxUsesRaw && (!Number.isFinite(maxUses) || (maxUses ?? 0) <= 0)) {
      setError('Máx. resgates deve ser um número positivo.')
      return
    }
    setBusy(true)
    try {
      await api.superadminCreateCoupon({
        code: couponForm.code,
        discount_type: couponForm.discount_type,
        discount_value: parseFloat(couponForm.discount_value.replace(',', '.')),
        duration_kind: couponForm.duration_kind,
        // Vitalício: sem janela — API força null também. Máx. resgates vale
        // pra qualquer tipo de cupom agora, é sempre opcional.
        duration_days: isTimed ? days : null,
        max_redemptions: maxUses,
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

  const startEditCoupon = (c: SuperadminCoupon) => {
    setError(null)
    setEditingCouponId(c.id)
    setEditCouponForm({
      discount_type: c.discount_type as 'fixed' | 'percent',
      discount_value: String(c.discount_value),
      duration_kind: c.duration_kind as 'timed' | 'lifetime_current_plan',
      duration_days: c.duration_days != null ? String(c.duration_days) : '30',
      max_redemptions: c.max_redemptions != null ? String(c.max_redemptions) : '',
      notes: c.notes ?? '',
      active: c.active,
    })
  }

  const cancelEditCoupon = () => {
    setEditingCouponId(null)
  }

  const handleUpdateCoupon = async (id: string) => {
    setError(null)
    const isTimed = editCouponForm.duration_kind === 'timed'
    const days = parseInt(editCouponForm.duration_days, 10)
    const maxUsesRaw = editCouponForm.max_redemptions.trim()
    const maxUses = maxUsesRaw ? parseInt(maxUsesRaw, 10) : null
    if (isTimed && (!Number.isFinite(days) || days <= 0)) {
      setError('Informe a duração em dias para cupom por tempo limitado.')
      return
    }
    if (maxUsesRaw && (!Number.isFinite(maxUses) || (maxUses ?? 0) <= 0)) {
      setError('Máx. resgates deve ser um número positivo.')
      return
    }
    setBusy(true)
    try {
      await api.superadminUpdateCoupon(id, {
        discount_type: editCouponForm.discount_type,
        discount_value: parseFloat(editCouponForm.discount_value.replace(',', '.')),
        duration_kind: editCouponForm.duration_kind,
        duration_days: isTimed ? days : null,
        max_redemptions: maxUses,
        notes: editCouponForm.notes || undefined,
        active: editCouponForm.active,
      })
      setEditingCouponId(null)
      await loadCupons()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao atualizar cupom.')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteCoupon = async (c: SuperadminCoupon) => {
    if (!window.confirm(`Excluir o cupom "${c.code}"? Essa ação não pode ser desfeita.`)) return
    setError(null)
    setBusy(true)
    try {
      await api.superadminDeleteCoupon(c.id)
      await loadCupons()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao excluir cupom.')
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

          {section === 'financeiro' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <section className="uf-glass rounded-2xl p-5">
                <h2 className="font-bold text-sm mb-1">Mercado Pago da Resolutoo</h2>
                <p className="text-xs text-uf-silver-dim mb-4">
                  Conta que RECEBE as assinaturas pagas pelos lojistas — nunca a conta Mercado Pago de uma loja
                  específica (essa cada lojista conecta na conta dele, em Onboarding/Meu Plano).
                </p>
                {mpConnected ? (
                  <div className="flex items-center justify-between gap-3 uf-glass rounded-xl p-4 border border-white/10">
                    <span className="text-sm text-uf-silver flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Mercado Pago conectado.
                    </span>
                    <div className="flex items-center gap-3 flex-none">
                      <button
                        type="button"
                        onClick={handleConnectMp}
                        disabled={mpConnecting || mpDisconnecting}
                        className="text-xs text-uf-silver-dim hover:text-uf-silver underline"
                      >
                        Reconectar
                      </button>
                      <button
                        type="button"
                        onClick={handleDisconnectMp}
                        disabled={mpConnecting || mpDisconnecting}
                        className="text-xs text-red-400/80 hover:text-red-400 underline flex items-center gap-1"
                      >
                        {mpDisconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        Desconectar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="uf-glass rounded-xl p-4 border border-white/10">
                    <p className="label flex items-center gap-1.5 mb-1">
                      <CreditCard className="w-3.5 h-3.5" /> Conecte a conta Mercado Pago da Resolutoo
                    </p>
                    <p className="text-[11px] text-uf-silver-dim mb-3">
                      Sem isso, novas cobranças de assinatura ficam em modo mock (sem cobrança de verdade).
                    </p>
                    <button
                      type="button"
                      onClick={handleConnectMp}
                      disabled={mpConnecting}
                      className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2"
                    >
                      {mpConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                      Conectar Mercado Pago
                    </button>
                  </div>
                )}
                {error && <p className="error-msg mt-3">{error}</p>}
              </section>
            </motion.div>
          )}

          {section === 'ia' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <section className="uf-glass rounded-2xl p-5">
                <h2 className="font-bold text-sm mb-1">Ranking de motores de IA</h2>
                <p className="text-xs text-uf-silver-dim mb-4">
                  Vale pra TODAS as assistentes de IA, de qualquer loja/ramo — não é configuração por tenant. O motor
                  no topo (#1) responde primeiro; se ele cair ou não responder, cai automaticamente pro próximo
                  habilitado da lista, sem o cliente perceber. Use as setas pra promover um motor a padrão.
                </p>
                <ul className="space-y-2 mb-4">
                  {aiEngines.map((eng, idx) => (
                    <li
                      key={eng.id}
                      className={`flex items-center gap-3 rounded-xl border p-3 ${
                        idx === 0 ? 'border-uf-blue/40 bg-uf-blue/5' : 'border-white/10'
                      } ${!eng.enabled ? 'opacity-50' : ''}`}
                    >
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          type="button"
                          disabled={busy || idx === 0}
                          onClick={() => handleMoveAiEngine(eng.id, 'up')}
                          className="p-0.5 rounded hover:bg-white/10 disabled:opacity-20"
                          aria-label="Subir no ranking"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy || idx === aiEngines.length - 1}
                          onClick={() => handleMoveAiEngine(eng.id, 'down')}
                          className="p-0.5 rounded hover:bg-white/10 disabled:opacity-20"
                          aria-label="Descer no ranking"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="text-xs font-mono text-uf-silver-dim w-5 text-center shrink-0">#{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {eng.label} {idx === 0 && <span className="text-[10px] text-uf-blue ml-1">PADRÃO ATUAL</span>}
                        </p>
                        <p className="text-xs text-uf-silver-dim truncate">
                          {eng.provider} · {eng.model}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleToggleAiEngine(eng.id, !eng.enabled)}
                        className="text-xs px-2 py-1 rounded-lg border border-white/10 hover:bg-white/5 shrink-0"
                      >
                        {eng.enabled ? 'Habilitado' : 'Desabilitado'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDeleteAiEngine(eng.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400/80 hover:text-red-400 shrink-0"
                        aria-label="Remover motor"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                  {aiEngines.length === 0 && <li className="text-sm text-uf-silver-dim">Nenhum motor cadastrado.</li>}
                </ul>
                <form onSubmit={handleCreateAiEngine} className="flex flex-wrap gap-2 items-end">
                  <div className="flex-1 min-w-[140px]">
                    <label className="label text-xs">Nome</label>
                    <input
                      className="input-field"
                      placeholder="Ex: GPT-5.4 Nano"
                      value={newEngineLabel}
                      onChange={(e) => setNewEngineLabel(e.target.value)}
                    />
                  </div>
                  <div className="w-36">
                    <label className="label text-xs">Provedor</label>
                    <select
                      className="input-field"
                      value={newEngineProvider}
                      onChange={(e) => setNewEngineProvider(e.target.value as 'openai' | 'openrouter')}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="label text-xs">Model id</label>
                    <input
                      className="input-field"
                      placeholder="Ex: openai/gpt-5.4-nano"
                      value={newEngineModel}
                      onChange={(e) => setNewEngineModel(e.target.value)}
                    />
                  </div>
                  <button type="submit" disabled={busy} className="btn-primary px-4 py-2.5 text-sm">
                    <Plus className="w-4 h-4" />
                    Adicionar
                  </button>
                </form>
                {error && <p className="error-msg mt-3">{error}</p>}
              </section>
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
                    const usesLabel = `${c.redemptions}${c.max_redemptions != null ? `/${c.max_redemptions}` : ''} usos`
                    if (editingCouponId === c.id) {
                      return (
                        <li key={c.id} className="rounded-xl border border-uf-blue/40 bg-white/[0.03] p-3 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              className="input-field"
                              value={editCouponForm.discount_type}
                              onChange={(e) =>
                                setEditCouponForm((f) => ({ ...f, discount_type: e.target.value as 'fixed' | 'percent' }))
                              }
                            >
                              <option value="percent">Percentual</option>
                              <option value="fixed">Valor fixo</option>
                            </select>
                            <input
                              className="input-field"
                              value={editCouponForm.discount_value}
                              onChange={(e) => setEditCouponForm((f) => ({ ...f, discount_value: e.target.value }))}
                              inputMode="decimal"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              className="input-field"
                              value={editCouponForm.duration_kind}
                              onChange={(e) =>
                                setEditCouponForm((f) => ({ ...f, duration_kind: e.target.value as 'timed' | 'lifetime_current_plan' }))
                              }
                            >
                              <option value="lifetime_current_plan">Vitalício no plano atual</option>
                              <option value="timed">Por tempo limitado</option>
                            </select>
                            {editCouponForm.duration_kind === 'timed' && (
                              <input
                                className="input-field"
                                placeholder="Dias de validade"
                                value={editCouponForm.duration_days}
                                onChange={(e) => setEditCouponForm((f) => ({ ...f, duration_days: e.target.value }))}
                                inputMode="numeric"
                              />
                            )}
                          </div>
                          <input
                            className="input-field"
                            placeholder="Máx. resgates (opcional, vale pra qualquer tipo)"
                            value={editCouponForm.max_redemptions}
                            onChange={(e) => setEditCouponForm((f) => ({ ...f, max_redemptions: e.target.value }))}
                            inputMode="numeric"
                          />
                          <label className="flex items-center gap-2 text-xs text-uf-silver-dim">
                            <input
                              type="checkbox"
                              checked={editCouponForm.active}
                              onChange={(e) => setEditCouponForm((f) => ({ ...f, active: e.target.checked }))}
                            />
                            Ativo
                          </label>
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={cancelEditCoupon}
                              className="p-1.5 rounded-lg text-uf-silver-dim hover:text-uf-silver hover:bg-white/5"
                              aria-label="Cancelar"
                            >
                              <X className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleUpdateCoupon(c.id)}
                              className="p-1.5 rounded-lg text-uf-blue hover:bg-uf-blue/15"
                              aria-label="Salvar"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          </div>
                        </li>
                      )
                    }
                    return (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm py-2 border-b border-white/5">
                        <span className="font-mono font-semibold">
                          {c.code}
                          {!c.active && <span className="ml-2 text-[10px] uppercase text-uf-silver-dim">inativo</span>}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-uf-silver-dim">
                            {c.discount_type === 'percent' ? `${c.discount_value}%` : `R$ ${formatBRL(c.discount_value)}`} · {kindLabel} ·{' '}
                            {usesLabel}
                          </span>
                          <button
                            type="button"
                            onClick={() => startEditCoupon(c)}
                            className="p-1 rounded text-uf-silver-dim hover:text-uf-silver hover:bg-white/5"
                            aria-label={`Editar cupom ${c.code}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCoupon(c)}
                            className="p-1 rounded text-uf-silver-dim hover:text-red-400 hover:bg-red-500/10"
                            aria-label={`Excluir cupom ${c.code}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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
                      Desconto enquanto o lojista permanecer no plano do resgate. Sem prazo definido.
                    </p>
                  ) : (
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
                  )}
                  <div>
                    <label className="label" htmlFor="coupon-max-redemptions">
                      Máx. resgates (opcional)
                    </label>
                    <input
                      id="coupon-max-redemptions"
                      className="input-field"
                      placeholder="Deixe em branco para ilimitado"
                      value={couponForm.max_redemptions}
                      onChange={(e) => setCouponForm((f) => ({ ...f, max_redemptions: e.target.value }))}
                      inputMode="numeric"
                    />
                  </div>
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
