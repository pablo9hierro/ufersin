import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ClipboardList,
  LogOut,
  Megaphone,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'
import Logo from '../ui/Logo'
import OnboardingGate from '../admin/OnboardingGate'
import { useAdminAuth } from '../../store/adminAuth'
import {
  clearDemoStaffSession,
  getDemoStaffSession,
  isDemoModeActive,
  planoAtLeast,
  planoIncludes,
  type PlanoCode,
} from '../../lib/demoMode'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { adminService } from '../../services/adminService'
import { subscribeWhatsAppGateChange } from '../../lib/whatsappGateEvents'
import {
  WA_GATE_CONFIRM_STREAK,
  WA_GATE_POLL_MS,
  WaGateDebouncer,
  classifyWaStatusPayload,
  type WaVerdict,
} from '../../lib/whatsappGate'

const NAV_ITEMS: { href: string; label: string; icon: typeof ClipboardList; requiredPlan: PlanoCode }[] = [
  { href: '/admin/pedidos', label: 'Pedidos', icon: ClipboardList, requiredPlan: 'essential' },
  { href: '/admin/pdv', label: 'PDV', icon: ShoppingCart, requiredPlan: 'essential' },
  { href: '/admin/produtos', label: 'Produtos', icon: Package, requiredPlan: 'essential' },
  { href: '/admin/motoboys', label: 'Funcionários', icon: Truck, requiredPlan: 'management' },
  { href: '/admin/crm', label: 'CRM', icon: Users, requiredPlan: 'premium' },
  { href: '/admin/promocoes', label: 'Promoções', icon: Megaphone, requiredPlan: 'management' },
  { href: '/admin/relatorios', label: 'Relatórios', icon: Wallet, requiredPlan: 'essential' },
  { href: '/admin/conta', label: 'Configurações', icon: Settings, requiredPlan: 'essential' },
]

function planAllows(required: PlanoCode, demo: boolean, tenantPlano: PlanoCode | undefined): boolean {
  if (demo) return planoIncludes(required)
  return planoAtLeast(tenantPlano ?? 'essential', required)
}

export default function AdminLayout() {
  const { token, name, logout } = useAdminAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const demo = isDemoModeActive()
  const demoStaff = getDemoStaffSession()
  const demoAdmin = demo && demoStaff?.role === 'admin'
  const effectiveToken = token || (demoAdmin ? demoStaff!.token : null)
  const effectiveName = demoAdmin ? demoStaff!.name : name
  const tenantConfig = useTenantConfig()
  const tenantPlano = tenantConfig?.plano
  const pedidosLiberado = tenantConfig?.vender_externamente !== false
  const whatsappRequired = tenantConfig?.whatsapp_habilitado === true

  // null = ainda checando; true = gate ativo; false = liberado
  const [gateLocked, setGateLocked] = useState<boolean | null>(demo ? false : null)
  const [hoursDone, setHoursDone] = useState(false)

  const hoursDoneRef = useRef(hoursDone)
  const gateLockedRef = useRef(gateLocked)
  const whatsappRequiredRef = useRef(whatsappRequired)
  const debouncerRef = useRef(new WaGateDebouncer(WA_GATE_CONFIRM_STREAK))

  hoursDoneRef.current = hoursDone
  gateLockedRef.current = gateLocked
  whatsappRequiredRef.current = whatsappRequired

  const applyVerdict = useCallback((verdict: Exclude<WaVerdict, 'pending'>, hours: boolean) => {
    if (!hours) {
      setGateLocked(true)
      return
    }
    if (!whatsappRequiredRef.current) {
      setGateLocked(false)
      return
    }
    // Definitive only: open unlocks, closed locks. Never toggle on pending.
    setGateLocked(verdict !== 'open')
  }, [])

  /** Initial mount + full re-eval. Waits for a definitive WA reading (no false unlock). */
  const bootstrapGate = useCallback(async () => {
    if (demo) {
      setGateLocked(false)
      return
    }
    if (tenantConfig == null) return

    debouncerRef.current.reset()

    // Hours: fail-open if API missing (lojas antigas), fail-closed when false.
    let hours = true
    try {
      const gate = await adminService.onboardingGate.get()
      hours = !!gate.onboarding_hours_done
    } catch {
      hours = true
    }
    setHoursDone(hours)

    if (!hours) {
      setGateLocked(true)
      return
    }
    if (!whatsappRequired) {
      setGateLocked(false)
      return
    }

    // Keep "Carregando…" until a definitive open/closed — never unlock on blip.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const verdict = classifyWaStatusPayload(await adminService.whatsapp.status())
        if (verdict === 'pending') {
          await new Promise((r) => setTimeout(r, 700))
          continue
        }
        applyVerdict(verdict, hours)
        return
      } catch {
        // Network/401 flash — do not lock or unlock; retry.
        await new Promise((r) => setTimeout(r, 700))
      }
    }
    // Still unsettled after retries: stay locked only if we never unlocked before.
    // Prefer keeping the loading spinner (null) over a wrong unlock on reload.
    if (gateLockedRef.current === null) {
      // Conservative: if WA is required and we couldn't confirm open, show reconnect gate.
      // User asked gate to survive reload when disconnected — better lock than unlock.
      setGateLocked(true)
    }
  }, [demo, tenantConfig, whatsappRequired, applyVerdict])

  useEffect(() => {
    void bootstrapGate()
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

  if (!effectiveToken) return <Navigate to="/admin/login" state={{ from: location }} replace />

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
        }}
      />
    )
  }

  const currentItem =
    NAV_ITEMS.find((i) => i.href === location.pathname) ??
    NAV_ITEMS.find((i) => i.href !== '/admin' && location.pathname.startsWith(`${i.href}/`))
  if (currentItem && !planAllows(currentItem.requiredPlan, demo, tenantPlano)) {
    return <Navigate to="/admin/pdv" replace />
  }
  if (location.pathname === '/admin/pedidos' && !pedidosLiberado) {
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
    logout()
    navigate('/admin/login')
  }

  const visibleItems = NAV_ITEMS.filter(
    (i) => planAllows(i.requiredPlan, demo, tenantPlano) && (i.href !== '/admin/pedidos' || pedidosLiberado)
  )

  const lojaLabel = tenantConfig?.loja_nome?.trim() || tenantConfig?.slug || null

  return (
    <div className="min-h-screen bg-son-black text-white flex">
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 bg-son-surface border-r border-white/5 min-h-screen sticky top-0">
        <div className="px-5 py-5 border-b border-white/5">
          <Logo size="sm" />
          {lojaLabel ? <p className="text-xs font-semibold text-white mt-2 truncate">{lojaLabel}</p> : null}
          <p className="text-xs text-son-silver-dim mt-1">Olá, {effectiveName}</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {visibleItems.map(({ href, label, icon: Icon }) => {
            const active = location.pathname === href || location.pathname.startsWith(`${href}/`)
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
          })}
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
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-son-silver-dim hover:text-son-pink text-sm">
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </header>
        <nav className="md:hidden flex gap-2 overflow-x-auto px-4 py-3 bg-son-black border-b border-white/5 scrollbar-hide sticky top-[65px] z-10">
          {visibleItems.map(({ href, label, icon: Icon }) => {
            const active = location.pathname === href || location.pathname.startsWith(`${href}/`)
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
          <Outlet />
        </main>
      </div>
    </div>
  )
}
