import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ClipboardList,
  Layers,
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
import { isDemoModeActive, planoAtLeast, planoIncludes, type PlanoCode } from '../../lib/demoMode'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { adminService } from '../../services/adminService'
import { subscribeWhatsAppGateChange } from '../../lib/whatsappGateEvents'

const NAV_ITEMS: { href: string; label: string; icon: typeof ClipboardList; requiredPlan: PlanoCode }[] = [
  { href: '/admin/pedidos', label: 'Pedidos', icon: ClipboardList, requiredPlan: 'essential' },
  { href: '/admin/pdv', label: 'PDV', icon: ShoppingCart, requiredPlan: 'essential' },
  { href: '/admin/produtos', label: 'Produtos', icon: Package, requiredPlan: 'essential' },
  { href: '/admin/motoboys', label: 'Funcionários', icon: Truck, requiredPlan: 'management' },
  { href: '/admin/crm', label: 'CRM', icon: Users, requiredPlan: 'premium' },
  { href: '/admin/promocoes', label: 'Promoções', icon: Megaphone, requiredPlan: 'management' },
  { href: '/admin/layout-cliente', label: 'Layout', icon: Layers, requiredPlan: 'essential' },
  { href: '/admin/relatorios', label: 'Relatórios', icon: Wallet, requiredPlan: 'essential' },
  { href: '/admin/conta', label: 'Configurações', icon: Settings, requiredPlan: 'essential' },
]

/** How often to re-check WA while the panel is unlocked (auto-disconnect). */
const WA_STATUS_POLL_MS = 8_000

function planAllows(required: PlanoCode, demo: boolean, tenantPlano: PlanoCode | undefined): boolean {
  if (demo) return planoIncludes(required)
  return planoAtLeast(tenantPlano ?? 'essential', required)
}

function extractWaState(status: unknown): string {
  const s = status as { instance?: { state?: string }; state?: string } | null
  return s?.instance?.state ?? s?.state ?? 'desconhecido'
}

export default function AdminLayout() {
  const { token, name, logout } = useAdminAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const demo = isDemoModeActive()
  const tenantConfig = useTenantConfig()
  const tenantPlano = tenantConfig?.plano
  const pedidosLiberado = tenantConfig?.vender_externamente !== false
  // Skip WA gate entirely when WhatsApp is disabled for the tenant.
  const whatsappRequired = tenantConfig?.whatsapp_habilitado === true

  // null = ainda checando; true = gate ativo; false = liberado
  const [gateLocked, setGateLocked] = useState<boolean | null>(demo ? false : null)

  const recheckGate = useCallback(async () => {
    if (demo) {
      setGateLocked(false)
      return
    }
    // Espera tenantConfig pra saber se WhatsApp é obrigatório.
    if (tenantConfig == null) return
    try {
      const gate = await adminService.onboardingGate.get()
      const hoursDone = !!gate.onboarding_hours_done
      let waOk = !whatsappRequired
      if (whatsappRequired) {
        try {
          waOk = extractWaState(await adminService.whatsapp.status()) === 'open'
        } catch {
          waOk = false
        }
      }
      setGateLocked(!(hoursDone && waOk))
    } catch {
      // Se a API falhar, não trava o painel pra lojas já existentes.
      setGateLocked(false)
    }
  }, [demo, tenantConfig, whatsappRequired])

  useEffect(() => {
    recheckGate()
  }, [recheckGate])

  // Manual disconnect (Configurações) or status flip from WhatsAppConnection
  // must re-lock immediately — do not wait for the poll.
  useEffect(() => {
    if (demo || !whatsappRequired) return
    return subscribeWhatsAppGateChange((connected) => {
      if (!connected) {
        setGateLocked(true)
        return
      }
      // Reconnected elsewhere — re-evaluate hours + WA together.
      void recheckGate()
    })
  }, [demo, whatsappRequired, recheckGate])

  // Auto-disconnect: poll while unlocked so the full-screen gate returns
  // without a full page reload. Also recheck on tab focus.
  useEffect(() => {
    if (demo || !whatsappRequired || gateLocked !== false) return

    const checkWa = async () => {
      try {
        const s = extractWaState(await adminService.whatsapp.status())
        if (s !== 'open') setGateLocked(true)
      } catch {
        /* ignore transient errors */
      }
    }

    const t = setInterval(checkWa, WA_STATUS_POLL_MS)
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
  }, [demo, whatsappRequired, gateLocked])

  if (!token) return <Navigate to="/admin/login" state={{ from: location }} replace />

  if (gateLocked === null) {
    return (
      <div className="min-h-screen bg-son-black flex items-center justify-center text-son-silver-dim text-sm">
        Carregando…
      </div>
    )
  }

  // Full-screen gate replaces the entire admin shell (all /admin/* routes).
  if (gateLocked) {
    return (
      <OnboardingGate
        whatsappRequired={whatsappRequired}
        onUnlocked={() => setGateLocked(false)}
      />
    )
  }

  const currentItem = NAV_ITEMS.find((i) => i.href === location.pathname)
  if (currentItem && !planAllows(currentItem.requiredPlan, demo, tenantPlano)) {
    return <Navigate to="/admin/pdv" replace />
  }
  if (location.pathname === '/admin/pedidos' && !pedidosLiberado) {
    return <Navigate to="/admin/pdv" replace />
  }

  const handleLogout = () => {
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
          <p className="text-xs text-son-silver-dim mt-1">Olá, {name}</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {visibleItems.map(({ href, label, icon: Icon }) => {
            const active = location.pathname === href
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
            const active = location.pathname === href
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
