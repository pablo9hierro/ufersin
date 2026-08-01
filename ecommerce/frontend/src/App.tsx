import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import CustomerPageDecorations from './components/CustomerPageDecorations'
import DemoEntrar from './pages/DemoEntrar'
import { isDemoModeActive } from './lib/demoMode'
import { useTenantColor } from './store/tenantColor'
import { deriveAccentTrio } from './lib/colorHarmony'
import { useLayoutStyle, type LayoutStyle } from './store/layoutStyle'
import { useTenantConfig } from './hooks/useTenantConfig'
import DemoPaletteSwitcher from './components/theme/DemoPaletteSwitcher'
import './uiux2/theme.css'
import Uiux2Landing from './uiux2/pages/Landing'
import Uiux2Catalogo from './uiux2/pages/Catalogo'
import Uiux2ProdutoDetalhe from './uiux2/pages/ProdutoDetalhe'
import Uiux2Carrinho from './uiux2/pages/Carrinho'
import Uiux2Checkout from './uiux2/pages/Checkout'
import Uiux2Consultar from './uiux2/pages/Consultar'
import Uiux2RecuperarSenha from './uiux2/pages/RecuperarSenha'
import Uiux2Favoritos from './uiux2/pages/Favoritos'
import Uiux2Cupons from './uiux2/pages/Cupons'
import Uiux2Historico from './uiux2/pages/Historico'
import Uiux2Banner from './uiux2/pages/Banner'
import Uiux2BannerCheckout from './uiux2/pages/BannerCheckout'
import Uiux2Pagamento from './uiux2/pages/Pagamento'
import './uiux3/theme.css'
import Uiux3Landing from './uiux3/pages/Landing'
import Uiux3Catalogo from './uiux3/pages/Catalogo'
import Uiux3ProdutoDetalhe from './uiux3/pages/ProdutoDetalhe'
import Uiux3Carrinho from './uiux3/pages/Carrinho'
import Uiux3Checkout from './uiux3/pages/Checkout'
import Uiux3Consultar from './uiux3/pages/Consultar'
import Uiux3RecuperarSenha from './uiux3/pages/RecuperarSenha'
import Uiux3Favoritos from './uiux3/pages/Favoritos'
import Uiux3Cupons from './uiux3/pages/Cupons'
import Uiux3Historico from './uiux3/pages/Historico'
import Uiux3Banner from './uiux3/pages/Banner'
import Uiux3BannerCheckout from './uiux3/pages/BannerCheckout'
import Uiux3Pagamento from './uiux3/pages/Pagamento'
import './uiux4/theme.css'
import Uiux4Landing from './uiux4/pages/Landing'
import Uiux4Catalogo from './uiux4/pages/Catalogo'
import Uiux4ProdutoDetalhe from './uiux4/pages/ProdutoDetalhe'
import Uiux4Carrinho from './uiux4/pages/Carrinho'
import Uiux4Checkout from './uiux4/pages/Checkout'
import Uiux4Consultar from './uiux4/pages/Consultar'
import Uiux4RecuperarSenha from './uiux4/pages/RecuperarSenha'
import Uiux4Favoritos from './uiux4/pages/Favoritos'
import Uiux4Cupons from './uiux4/pages/Cupons'
import Uiux4Historico from './uiux4/pages/Historico'
import Uiux4Banner from './uiux4/pages/Banner'
import Uiux4BannerCheckout from './uiux4/pages/BannerCheckout'
import Uiux4Pagamento from './uiux4/pages/Pagamento'
import AdminLogin from './pages/admin/AdminLogin'
import FuncionarioLogin from './pages/admin/FuncionarioLogin'
import AdminPedidos from './pages/admin/AdminPedidos'
import AdminProdutos from './pages/admin/AdminProdutos'
import AdminMotoboys from './pages/admin/AdminMotoboys'
import AdminFinanceiro from './pages/admin/AdminFinanceiro'
import AdminSenha from './pages/admin/AdminSenha'
import AdminPromocoes from './pages/admin/AdminPromocoes'
import AdminLayoutCliente from './pages/admin/AdminLayoutCliente'
import AdminCrm from './pages/admin/AdminCrm'
import MotoboyFila from './pages/motoboy/MotoboyFila'
import MotoboyCorrida from './pages/motoboy/MotoboyCorrida'
import MotoboyFinanceiro from './pages/motoboy/MotoboyFinanceiro'
import MotoboyConta from './pages/motoboy/MotoboyConta'
import AdminLayout from './components/layout/AdminLayout'
import VendedorLayout from './components/layout/VendedorLayout'
import MotoboyLayout from './components/layout/MotoboyLayout'

const AdminPdv = lazy(() => import('./pages/admin/AdminPdv'))

function PdvFallback() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
    </div>
  )
}

// ÚNICOS estilos de vitrine Resolutoo: ufersin | burgerbite | burgerhouse
// (os 3 botões do DemoPaletteSwitcher). Padrão = ufersin (1º botão).
// Layout Sunset / pôr-do-sol foi REMOVIDO — não é fallback.
function DemoBrandScope() {
  const location = useLocation()
  const tenantColor = useTenantColor()
  const demo = isDemoModeActive()
  const isStaffPage = location.pathname.startsWith('/admin') || location.pathname.startsWith('/funcionarios')

  useEffect(() => {
    const root = document.documentElement
    root.dataset.brand = demo ? 'demo' : ''
    if (!isStaffPage && tenantColor.color1) {
      const trio = deriveAccentTrio(tenantColor.color1, tenantColor.color2)
      root.style.setProperty('--tenant-accent-1', trio.accent1)
      root.style.setProperty('--tenant-accent-2', trio.accent2)
      root.style.setProperty('--tenant-accent-3', trio.accent3)
    } else {
      root.style.removeProperty('--tenant-accent-1')
      root.style.removeProperty('--tenant-accent-2')
      root.style.removeProperty('--tenant-accent-3')
    }
  }, [demo, isStaffPage, tenantColor.color1, tenantColor.color2])

  return demo && !isStaffPage ? <DemoPaletteSwitcher /> : null
}

function LojaSemVendaExterna() {
  return (
    <main className="min-h-screen bg-son-black text-white flex items-center justify-center px-5 text-center">
      <div>
        <p className="text-6xl font-black text-white/10 mb-3">404</p>
        <p className="text-son-silver-dim text-sm">Esta página não existe.</p>
      </div>
    </main>
  )
}

function resolveStorefrontStyle(demoStyle: LayoutStyle, tenantStyle: string | undefined): LayoutStyle {
  if (isDemoModeActive()) return demoStyle
  if (tenantStyle === 'burgerbite' || tenantStyle === 'burgerhouse' || tenantStyle === 'ufersin') {
    return tenantStyle
  }
  return 'ufersin'
}

function StyleAware({
  ufersin,
  burgerbite,
  burgerhouse,
}: {
  ufersin: React.ReactNode
  burgerbite: React.ReactNode
  burgerhouse: React.ReactNode
}) {
  const demoStyle = useLayoutStyle((s) => s.style)
  const tenantConfig = useTenantConfig()
  if (tenantConfig?.vender_externamente === false) return <LojaSemVendaExterna />

  const style = resolveStorefrontStyle(demoStyle, tenantConfig?.layout_style)
  if (style === 'burgerbite') return <>{burgerbite}</>
  if (style === 'burgerhouse') return <>{burgerhouse}</>
  return <>{ufersin}</>
}

export default function App() {
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined
  return (
    <BrowserRouter basename={basename}>
      <DemoBrandScope />
      <CustomerPageDecorations />
      <Routes>
        <Route path="/" element={<StyleAware ufersin={<Uiux2Landing />} burgerbite={<Uiux3Landing />} burgerhouse={<Uiux4Landing />} />} />
        <Route path="/demo-entrar" element={<DemoEntrar />} />
        <Route path="/catalogo" element={<StyleAware ufersin={<Uiux2Catalogo />} burgerbite={<Uiux3Catalogo />} burgerhouse={<Uiux4Catalogo />} />} />
        <Route path="/produto/:id" element={<StyleAware ufersin={<Uiux2ProdutoDetalhe />} burgerbite={<Uiux3ProdutoDetalhe />} burgerhouse={<Uiux4ProdutoDetalhe />} />} />
        <Route path="/carrinho" element={<StyleAware ufersin={<Uiux2Carrinho />} burgerbite={<Uiux3Carrinho />} burgerhouse={<Uiux4Carrinho />} />} />
        <Route path="/checkout" element={<StyleAware ufersin={<Uiux2Checkout />} burgerbite={<Uiux3Checkout />} burgerhouse={<Uiux4Checkout />} />} />
        <Route path="/banner" element={<StyleAware ufersin={<Uiux2Banner />} burgerbite={<Uiux3Banner />} burgerhouse={<Uiux4Banner />} />} />
        <Route path="/banner/checkout" element={<StyleAware ufersin={<Uiux2BannerCheckout />} burgerbite={<Uiux3BannerCheckout />} burgerhouse={<Uiux4BannerCheckout />} />} />
        <Route path="/pagamento/:orderId" element={<StyleAware ufersin={<Uiux2Pagamento />} burgerbite={<Uiux3Pagamento />} burgerhouse={<Uiux4Pagamento />} />} />
        <Route path="/consultar" element={<StyleAware ufersin={<Uiux2Consultar />} burgerbite={<Uiux3Consultar />} burgerhouse={<Uiux4Consultar />} />} />
        <Route path="/recuperar-senha" element={<StyleAware ufersin={<Uiux2RecuperarSenha />} burgerbite={<Uiux3RecuperarSenha />} burgerhouse={<Uiux4RecuperarSenha />} />} />
        <Route path="/cliente/favoritos" element={<StyleAware ufersin={<Uiux2Favoritos />} burgerbite={<Uiux3Favoritos />} burgerhouse={<Uiux4Favoritos />} />} />
        <Route path="/cliente/cupons" element={<StyleAware ufersin={<Uiux2Cupons />} burgerbite={<Uiux3Cupons />} burgerhouse={<Uiux4Cupons />} />} />
        <Route path="/cliente/resgatarcupom" element={<Navigate to="/cliente/cupons" replace />} />
        <Route path="/cliente/historico" element={<StyleAware ufersin={<Uiux2Historico />} burgerbite={<Uiux3Historico />} burgerhouse={<Uiux4Historico />} />} />

        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/funcionarios/login" element={<FuncionarioLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/pedidos" replace />} />
          <Route path="pedidos" element={<AdminPedidos />} />
          <Route
            path="pdv"
            element={
              <Suspense fallback={<PdvFallback />}>
                <AdminPdv />
              </Suspense>
            }
          />
          <Route path="produtos" element={<AdminProdutos />} />
          <Route path="motoboys" element={<AdminMotoboys />} />
          <Route path="crm" element={<AdminCrm />} />
          <Route path="promocoes" element={<AdminPromocoes />} />
          <Route path="layout-cliente" element={<AdminLayoutCliente />} />
          <Route path="financeiro" element={<AdminFinanceiro />} />
          <Route path="conta" element={<AdminSenha />} />
        </Route>
        <Route path="/funcionarios/vendedor" element={<VendedorLayout />}>
          <Route index element={<Navigate to="/funcionarios/vendedor/pdv" replace />} />
          <Route
            path="pdv"
            element={
              <Suspense fallback={<PdvFallback />}>
                <AdminPdv />
              </Suspense>
            }
          />
          <Route path="financeiro" element={<AdminFinanceiro />} />
        </Route>
        <Route path="/funcionarios/motoboy" element={<MotoboyLayout />}>
          <Route index element={<Navigate to="/funcionarios/motoboy/fila" replace />} />
          <Route path="fila" element={<MotoboyFila />} />
          <Route path="corrida" element={<MotoboyCorrida />} />
          <Route path="financeiro" element={<MotoboyFinanceiro />} />
          <Route path="conta" element={<MotoboyConta />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
