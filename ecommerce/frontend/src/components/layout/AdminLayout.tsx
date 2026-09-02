import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Boxes,
  Calendar,
  ChefHat,
  ChevronDown,
  ClipboardList,
  Loader2,
  LogOut,
  MapPinned,
  Megaphone,
  MessageSquareText,
  MessageCircle,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'
import Logo from '../ui/Logo'
import PayrollBell from './PayrollBell'
import OnboardingGate from '../admin/OnboardingGate'
import { useAdminAuth, detectAdminTenantMismatch } from '../../store/adminAuth'
import {
  clearDemoStaffSession,
  getDemoStaffSession,
  isDemoModeActive,
  planoAtLeast,
  planoIncludes,
  type PlanoCode,
} from '../../lib/demoMode'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import {
  LOJA_OFFLINE_MSG,
  resolveTenantSlug,
  stashLojaOfflineMessage,
  withTenantSearch,
} from '../../lib/tenantConfig'
import { adminService } from '../../services/adminService'
import { platformOrigin } from '../../lib/platformUrl'
import { subscribeWhatsAppGateChange } from '../../lib/whatsappGateEvents'
import {
  WA_GATE_CONFIRM_STREAK,
  WA_GATE_POLL_MS,
  WaGateDebouncer,
  classifyWaStatusPayload,
  type WaVerdict,
} from '../../lib/whatsappGate'

type NavItem = {
  href: string
  label: string
  icon: typeof ClipboardList
  requiredPlan: PlanoCode
  /** Hide when tenant is at least this plan (Essential-only Frete vs Management Funcionários). */
  hideAtOrAbove?: PlanoCode
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin/pedidos', label: 'Pedidos', icon: ClipboardList, requiredPlan: 'essential' },
  { href: '/admin/pdv', label: 'PDV', icon: ShoppingCart, requiredPlan: 'essential' },
  { href: '/admin/produtos', label: 'Produtos', icon: Package, requiredPlan: 'essential' },
  { href: '/admin/produtos/servicos', label: 'Serviços', icon: Wrench, requiredPlan: 'essential' },
  { href: '/admin/estoque', label: 'Estoque', icon: Boxes, requiredPlan: 'essential' },
  { href: '/admin/frete', label: 'Frete', icon: MapPinned, requiredPlan: 'essential', hideAtOrAbove: 'management' },
  { href: '/admin/chat', label: 'Chat', icon: MessageCircle, requiredPlan: 'essential' },
  { href: '/admin/agendamentos', label: 'Agendamentos', icon: Calendar, requiredPlan: 'essential' },
  { href: '/admin/template', label: 'Mensagens', icon: MessageSquareText, requiredPlan: 'essential' },
  // requiredPlan aqui é só o "chão": management+ sempre libera. Essential
  // também libera quando o lojista marcou precisar de motoboy/cozinha/
  // vendedor em /meu-plano — ver visibleItems (a necessidade operacional
  // sobrepõe o plano, mesma lógica do sync-feature-flags no backend).
  { href: '/admin/motoboys', label: 'Funcionários', icon: Truck, requiredPlan: 'essential' },
  { href: '/admin/crm', label: 'CRM', icon: Users, requiredPlan: 'premium' },
  { href: '/admin/promocoes', label: 'Promoções', icon: Megaphone, requiredPlan: 'management' },
  { href: '/admin/relatorios', label: 'Relatórios', icon: Wallet, requiredPlan: 'essential' },
  { href: '/admin/conta', label: 'Configurações', icon: Settings, requiredPlan: 'essential' },
]

/** Agrupa alguns itens do menu em dropdowns nativos (<details>) pra encurtar
 * a sidebar — os demais itens ficam soltos no menu normal. */
const NAV_GROUPS: Record<string, { id: string; label: string }> = {
  '/admin/pedidos': { id: 'solicitacoes', label: 'Solicitações' },
  '/admin/cozinha': { id: 'solicitacoes', label: 'Solicitações' },
  '/admin/agendamentos': { id: 'solicitacoes', label: 'Solicitações' },
  '/admin/produtos': { id: 'cadastros', label: 'Cadastros' },
  '/admin/produtos/servicos': { id: 'cadastros', label: 'Cadastros' },
  '/admin/estoque': { id: 'cadastros', label: 'Cadastros' },
  '/admin/frete': { id: 'cadastros', label: 'Cadastros' },
  '/admin/template': { id: 'cadastros', label: 'Cadastros' },
  '/admin/motoboys': { id: 'cadastros', label: 'Cadastros' },
}
/** Avoid re-running the full WA gate after every tenantConfig object refresh. */
const GATE_SESSION_TTL_MS = 60_000
type GateSession = { slug: string; locked: boolean; hoursDone: boolean; at: number }
let gateSession: GateSession | null = null

function planAllows(required: PlanoCode, demo: boolean, tenantPlano: PlanoCode | undefined): boolean {
  if (demo) return planoIncludes(required)
  return planoAtLeast(tenantPlano ?? 'essential', required)
}

/** requiredPlan unlocks; hideAtOrAbove hides Essential-only items once Motoboy plans kick in. */
function navVisible(item: NavItem, demo: boolean, tenantPlano: PlanoCode | undefined): boolean {
  if (!planAllows(item.requiredPlan, demo, tenantPlano)) return false
  if (!item.hideAtOrAbove) return true
  if (demo) return !planoIncludes(item.hideAtOrAbove)
  return !planoAtLeast(tenantPlano ?? 'essential', item.hideAtOrAbove)
}

function AdminRouteFallback() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
    </div>
  )
}

export default function AdminLayout() {
  const { token, name, tenantSlug, logout } = useAdminAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const demo = isDemoModeActive()
  const demoStaff = getDemoStaffSession()
  const demoAdmin = demo && demoStaff?.role === 'admin'
  const effectiveToken = token || (demoAdmin ? demoStaff!.token : null)
  const effectiveName = demoAdmin ? demoStaff!.name : name
  // BUG-015: token de um tenant ficava "válido" ao navegar/clicar pra
  // outro tenant sem logout explícito, porque a sessão de admin é um único
  // registro global no localStorage. Ver detectAdminTenantMismatch.
  const tenantMismatch = !demo && detectAdminTenantMismatch(token, tenantSlug)

  useEffect(() => {
    if (tenantMismatch) {
      gateSession = null
      logout()
    }
  }, [tenantMismatch, logout])
  const tenantConfig = useTenantConfig()
  const tenantPlano = tenantConfig?.plano
  const pedidosLiberado = tenantConfig?.vender_externamente !== false
  const whatsappRequired = tenantConfig?.whatsapp_habilitado === true
  // Cobrança manual (store-wide) deixou de existir — toda loja precisa de
  // Mercado Pago conectado. Dinheiro continua valendo por pedido
  // (PDV/retirada), isso aqui é só sobre ter Pix/cartão online disponíveis.
  // Mercado Pago exige ter vindo do fluxo OAuth novo — uma conexão do
  // modelo antigo (Access Token colado à mão, antes desta feature) tem
  // forma_pagamento='plataforma' mas não é mais aceita como "conectado":
  // o lojista precisa reconectar pra loja voltar a funcionar.
  const paymentGatewayConnected =
    tenantConfig?.forma_pagamento === 'plataforma' &&
    (tenantConfig?.plataforma_pagamento !== 'mercado_pago' || tenantConfig?.plataforma_oauth === true)
  const tenantReady = tenantConfig != null
  const lojaOffline = !demo && tenantReady && tenantConfig?.ativa === false

  // Assinatura não ativa (cancelado / sem config Resolutoo): derruba sessão
  // mesmo com JWT antigo ainda no localStorage.
  useEffect(() => {
    if (!lojaOffline) return
    stashLojaOfflineMessage(LOJA_OFFLINE_MSG)
    gateSession = null
    logout()
  }, [lojaOffline, logout])

  // Ramo eletrônicos tem painel PRÓPRIO (visual dedicado, nunca a chrome de
  // ecommerce deste layout) -- migrado de app externo (vrtech-jp.vercel.app,
  // via proxy /loja/eletronica-admin) pro nativo /admin-eletronica dentro
  // deste mesmo app React. BUG CRÍTICO original que essa checagem evita
  // continua valendo: um tenant eletronicos acessando /loja/admin caía
  // neste painel de produto/pedido/PDV, que não é o dele.
  useEffect(() => {
    if (demo || !tenantReady) return
    if (tenantConfig?.vertical === 'eletronicos' && !window.location.pathname.startsWith('/loja/admin-eletronica')) {
      navigate(`/admin-eletronica${withTenantSearch()}`, { replace: true })
    }
  }, [demo, tenantReady, tenantConfig?.vertical, navigate])

  // null = ainda checando; true = gate ativo; false = liberado
  const [gateLocked, setGateLocked] = useState<boolean | null>(() => {
    if (demo) return false
    const slug = resolveTenantSlug()
    if (
      gateSession &&
      gateSession.slug === slug &&
      Date.now() - gateSession.at < GATE_SESSION_TTL_MS
    ) {
      return gateSession.locked
    }
    return null
  })
  const [hoursDone, setHoursDone] = useState(() => gateSession?.hoursDone ?? false)

  const hoursDoneRef = useRef(hoursDone)
  const gateLockedRef = useRef(gateLocked)
  const whatsappRequiredRef = useRef(whatsappRequired)
  const debouncerRef = useRef(new WaGateDebouncer(WA_GATE_CONFIRM_STREAK))

  hoursDoneRef.current = hoursDone
  gateLockedRef.current = gateLocked
  whatsappRequiredRef.current = whatsappRequired

  const persistGate = useCallback((locked: boolean, hours: boolean) => {
    gateSession = {
      slug: resolveTenantSlug(),
      locked,
      hoursDone: hours,
      at: Date.now(),
    }
  }, [])

  const applyVerdict = useCallback(
    (verdict: Exclude<WaVerdict, 'pending'>, hours: boolean) => {
      if (!hours) {
        setGateLocked(true)
        persistGate(true, hours)
        return
      }
      if (!whatsappRequiredRef.current) {
        setGateLocked(false)
        persistGate(false, hours)
        return
      }
      // Definitive only: open unlocks, closed locks. Never toggle on pending.
      const locked = verdict !== 'open'
      setGateLocked(locked)
      persistGate(locked, hours)
    },
    [persistGate],
  )

  /** Initial mount + full re-eval. Waits for a definitive WA reading (no false unlock). */
  const bootstrapGate = useCallback(
    async (signal?: AbortSignal) => {
      if (demo) {
        setGateLocked(false)
        return
      }
      if (!tenantReady) return

      const slug = resolveTenantSlug()
      if (
        gateSession &&
        gateSession.slug === slug &&
        Date.now() - gateSession.at < GATE_SESSION_TTL_MS &&
        gateLockedRef.current !== null
      ) {
        // Fresh session cache — skip Railway round-trip on StrictMode remount / soft refresh.
        return
      }

      debouncerRef.current.reset()

      // Hours + WA status in parallel (independent endpoints).
      const hoursPromise = adminService.onboardingGate
        .get()
        .then((gate) => !!gate.onboarding_hours_done)
        .catch(() => true)

      const waPromise = whatsappRequired
        ? adminService.whatsapp
            .status()
            .then((payload) => classifyWaStatusPayload(payload))
            .catch(() => 'pending' as const)
        : Promise.resolve('open' as const)

      const [hours, firstWa] = await Promise.all([hoursPromise, waPromise])
      if (signal?.aborted) return

      setHoursDone(hours)

      if (!hours) {
        setGateLocked(true)
        persistGate(true, hours)
        return
      }
      if (!whatsappRequired) {
        setGateLocked(false)
        persistGate(false, hours)
        return
      }

      if (firstWa !== 'pending') {
        applyVerdict(firstWa, hours)
        return
      }

      // Keep "Carregando…" until a definitive open/closed — never unlock on blip.
      for (let attempt = 0; attempt < 4; attempt++) {
        if (signal?.aborted) return
        await new Promise((r) => setTimeout(r, 500))
        if (signal?.aborted) return
        try {
          const verdict = classifyWaStatusPayload(await adminService.whatsapp.status())
          if (verdict === 'pending') continue
          applyVerdict(verdict, hours)
          return
        } catch {
          // Network/401 flash — do not lock or unlock; retry.
        }
      }
      // Still unsettled after retries: stay locked only if we never unlocked before.
      // Prefer keeping the loading spinner (null) over a wrong unlock on reload.
      if (gateLockedRef.current === null) {
        // Conservative: if WA is required and we couldn't confirm open, show reconnect gate.
        setGateLocked(true)
        persistGate(true, hours)
      }
    },
    [demo, tenantReady, whatsappRequired, applyVerdict, persistGate],
  )

  useEffect(() => {
    const ac = new AbortController()
    void bootstrapGate(ac.signal)
    return () => ac.abort()
  }, [bootstrapGate])

  // Manual disconnect is authoritative (immediate lock). Connected events only hint —
  // we re-fetch and still require a definitive `open` (no optimistic unlock).
  useEffect(() => {
    if (demo || !whatsappRequired) return
    return subscribeWhatsAppGateChange((connected) => {
      if (!connected) {
        debouncerRef.current.force('closed')
        applyVerdict('closed', hoursDoneRef.current)
        return
      }
      // Hint only — confirm with live status (single read is enough after explicit connect).
      void (async () => {
        try {
          const verdict = classifyWaStatusPayload(await adminService.whatsapp.status())
          if (verdict === 'open') {
            debouncerRef.current.force('open')
            applyVerdict('open', hoursDoneRef.current)
          }
          // pending/closed: ignore event; poll / gate UI will settle.
        } catch {
          /* ignore blip */
        }
      })()
    })
  }, [demo, whatsappRequired, applyVerdict])

  // While unlocked: poll for definitive disconnect only (debounced).
  // While locked: OnboardingGate owns unlock-on-open; avoid dual poll fight.
  useEffect(() => {
    if (demo || !whatsappRequired || gateLocked !== false) return

    const checkWa = async () => {
      try {
        const verdict = classifyWaStatusPayload(await adminService.whatsapp.status())
        const confirmed = debouncerRef.current.observe(verdict)
        if (confirmed === 'closed') {
          applyVerdict('closed', hoursDoneRef.current)
        }
        // confirmed open while unlocked: no-op
        // pending: ignore
      } catch {
        /* ignore transient errors — do NOT lock */
      }
    }

    const t = setInterval(checkWa, WA_GATE_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkWa()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [demo, whatsappRequired, gateLocked, applyVerdict])

  if (!effectiveToken || tenantMismatch) return <Navigate to="/admin/login" state={{ from: location }} replace />

  // Wait for Resolutoo tenant-config before rendering the shell — cancelado
  // must not flash the painel from a warm WA-gate session cache.
  if (!demo && !tenantReady) {
    return (
      <div className="min-h-screen bg-son-black flex items-center justify-center text-son-silver-dim text-sm">
        Carregando…
      </div>
    )
  }

  if (lojaOffline) {
    return <Navigate to="/admin/login" state={{ from: location, offline: true }} replace />
  }

  if (gateLocked === null) {
    return (
      <div className="min-h-screen bg-son-black flex items-center justify-center text-son-silver-dim text-sm">
        Carregando…
      </div>
    )
  }

  if (gateLocked) {
    return (
      <OnboardingGate
        whatsappRequired={whatsappRequired}
        hoursDone={hoursDone}
        onHoursSaved={() => {
          setHoursDone(true)
          hoursDoneRef.current = true
        }}
        onUnlocked={() => {
          debouncerRef.current.force('open')
          setGateLocked(false)
          persistGate(false, true)
        }}
      />
    )
  }

  if (!demo && tenantReady && !paymentGatewayConnected) {
    return (
      <div className="min-h-screen bg-son-black text-white flex flex-col items-center">
        <header className="w-full px-5 py-8 sm:py-10 border-b border-white/5 bg-son-surface">
          <div className="max-w-lg mx-auto text-center space-y-2">
            <p className="text-xs text-son-silver-dim uppercase tracking-wide">Mercado Pago desconectado</p>
            <h1 className="text-xl sm:text-2xl font-black leading-snug">Conecte o Mercado Pago da loja para continuar</h1>
            <p className="text-sm text-son-silver-dim">O painel fica bloqueado enquanto não houver um gateway de pagamento conectado.</p>
          </div>
        </header>
        <main className="flex-1 w-full flex flex-col items-center justify-center px-5 py-10">
          <div className="bg-son-surface border border-white/10 rounded-2xl p-6 max-w-sm w-full text-center space-y-4">
            <Wallet className="w-8 h-8 mx-auto text-son-pink" />
            <p className="text-son-silver-dim text-sm">
              A conexão é feita no painel da assinatura, fora dessa loja. Depois de conectar, volte aqui e recarregue a página.
            </p>
            <a
              href={`${platformOrigin()}/meu-plano/financeiro`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary w-full py-2.5 text-sm inline-flex items-center justify-center gap-2"
            >
              Conectar Mercado Pago
            </a>
          </div>
        </main>
      </div>
    )
  }

  const currentItem =
    NAV_ITEMS.find((i) => i.href === location.pathname) ??
    NAV_ITEMS.find((i) => i.href !== '/admin' && location.pathname.startsWith(`${i.href}/`))
  if (currentItem && !navVisible(currentItem, demo, tenantPlano)) {
    return <Navigate to="/admin/pdv" replace />
  }
  if (
    (location.pathname === '/admin/pedidos' || location.pathname === '/admin/frete') &&
    !pedidosLiberado
  ) {
    return <Navigate to="/admin/pdv" replace />
  }

  const handleLogout = () => {
    // Demo pública: limpa só sessionStorage da aba — nunca useAdminAuth.logout()
    // (isso apagaria o JWT real do lojista no localStorage compartilhado).
    if (demo) {
      clearDemoStaffSession()
      navigate('/', { replace: true })
      return
    }
    gateSession = null
    logout()
    navigate('/admin/login')
  }

  const visibleItems = NAV_ITEMS.filter((i) => {
    if (!navVisible(i, demo, tenantPlano)) return false
    // Pedidos + Frete (Essential) share venda externa — same flag as storefront.
    if ((i.href === '/admin/pedidos' || i.href === '/admin/frete') && !pedidosLiberado) return false
    // Loja só retirada — sem entrega, não existe frete pra configurar.
    if (i.href === '/admin/frete' && tenantConfig?.apenas_retirada) return false
    // Funcionários (motoboy/vendedor/cozinha): management+ sempre libera;
    // essential libera só se o lojista marcou precisar de algum desses em
    // /meu-plano (mesma necessidade que libera o backend via feature_flags).
    if (
      i.href === '/admin/motoboys' &&
      !planoAtLeast(tenantPlano ?? 'essential', 'management') &&
      !tenantConfig?.tem_motoboy_proprio &&
      !tenantConfig?.precisa_tela_cozinha &&
      !tenantConfig?.precisa_vendedor
    )
      return false
    return true
  }).map((i) =>
    // Loja com tela de cozinha: pedidos avançam por lá, não pelo painel de
    // Pedidos -- só a URL muda, o rótulo continua "Pedidos" (é a mesma
    // ideia pro lojista, só que atendida na tela de cozinha).
    i.href === '/admin/pedidos' && tenantConfig?.precisa_tela_cozinha
      ? { ...i, href: '/admin/cozinha', icon: ChefHat }
      : i
  )

  // Item ativo do menu: precisa ser o match MAIS ESPECÍFICO (maior href que
  // bate), não "qualquer item cujo href seja prefixo do path atual" -- senão
  // /admin/produtos/servicos casava com "Produtos" (/admin/produtos) E
  // "Serviços" (/admin/produtos/servicos) ao mesmo tempo, os dois ficavam
  // destacados juntos na sidebar.
  const activeHref = visibleItems.reduce<string | null>((best, i) => {
    const matches = location.pathname === i.href || location.pathname.startsWith(`${i.href}/`)
    if (!matches) return best
    if (best === null || i.href.length > best.length) return i.href
    return best
  }, null)

  const lojaLabel = tenantConfig?.loja_nome?.trim() || tenantConfig?.slug || null

  const groupActiveIds = new Set(
    visibleItems.filter((i) => i.href === activeHref && NAV_GROUPS[i.href]).map((i) => NAV_GROUPS[i.href].id)
  )

  return (
    <div className="min-h-screen bg-son-black text-white flex">
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 bg-son-surface border-r border-white/5 min-h-screen sticky top-0">
        <div className="px-5 py-5 border-b border-white/5">
          <div className="flex items-center justify-between">
            <Logo size="sm" />
            {!demo && <PayrollBell mode="admin" />}
          </div>
          {lojaLabel ? <p className="text-xs font-semibold text-white mt-2 truncate">{lojaLabel}</p> : null}
          <p className="text-xs text-son-silver-dim mt-1">Olá, {effectiveName}</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {(() => {
            const renderedGroups = new Set<string>()
            return visibleItems.map((item) => {
              const group = NAV_GROUPS[item.href]
              if (group) {
                if (renderedGroups.has(group.id)) return null
                renderedGroups.add(group.id)
                const groupItems = visibleItems.filter((i) => NAV_GROUPS[i.href]?.id === group.id)
                return (
                  <details key={group.id} open={groupActiveIds.has(group.id)} className="group">
                    <summary className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-son-silver-dim hover:bg-white/5 hover:text-white cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180" />
                      {group.label}
                    </summary>
                    <div className="ml-2 pl-4 border-l border-white/10 space-y-1 mt-1">
                      {groupItems.map(({ href, label, icon: Icon }) => {
                        const active = href === activeHref
                        return (
                          <Link
                            key={href}
                            to={href}
                            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                              active ? 'sunset-bg text-white' : 'text-son-silver-dim hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            {label}
                          </Link>
                        )
                      })}
                    </div>
                  </details>
                )
              }
              const { href, label, icon: Icon } = item
              const active = href === activeHref
              return (
                <Link
                  key={href}
                  to={href}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    active ? 'sunset-bg text-white' : 'text-son-silver-dim hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              )
            })
          })()}
        </nav>
        <div className="px-3 py-4 border-t border-white/5">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-son-silver-dim hover:text-son-pink transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="md:hidden bg-son-surface border-b border-white/5 px-4 py-4 flex items-center justify-between sticky top-0 z-10">
          <Logo size="sm" />
          <div className="flex items-center gap-2">
            {!demo && <PayrollBell mode="admin" />}
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-son-silver-dim hover:text-son-pink text-sm">
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </header>
        <nav className="md:hidden flex gap-2 overflow-x-auto px-4 py-3 bg-son-black border-b border-white/5 scrollbar-hide sticky top-[65px] z-10">
          {visibleItems.map(({ href, label, icon: Icon }) => {
            const active = href === activeHref
            return (
              <Link
                key={href}
                to={href}
                className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  active ? 'sunset-bg text-white' : 'bg-son-surface border border-white/5 text-son-silver hover:bg-son-surface-light'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </Link>
            )
          })}
        </nav>
        <main className="p-5 sm:p-8 max-w-6xl mx-auto">
          <Suspense fallback={<AdminRouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
