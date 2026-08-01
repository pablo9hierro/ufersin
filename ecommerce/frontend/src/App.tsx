import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import SunsetBackdrop from './components/SunsetBackdrop'
import CustomerPageDecorations from './components/CustomerPageDecorations'
import Landing from './pages/Landing'
import DemoEntrar from './pages/DemoEntrar'
import { isDemoModeActive } from './lib/demoMode'
import { useTenantColor } from './store/tenantColor'
import { deriveAccentTrio } from './lib/colorHarmony'
import { useLayoutStyle } from './store/layoutStyle'
import { useTenantConfig } from './hooks/useTenantConfig'
import DemoPaletteSwitcher from './components/theme/DemoPaletteSwitcher'
import Catalogo from './pages/Catalogo'
import ProdutoDetalhe from './pages/ProdutoDetalhe'
import Carrinho from './pages/Carrinho'
import Checkout from './pages/Checkout'
import Banner from './pages/Banner'
import BannerCheckout from './pages/BannerCheckout'
import Pagamento from './pages/Pagamento'
import Consultar from './pages/Consultar'
import RecuperarSenha from './pages/RecuperarSenha'
import FavoritosCliente from './pages/cliente/FavoritosCliente'
import CuponsCliente from './pages/cliente/CuponsCliente'
import HistoricoCliente from './pages/cliente/HistoricoCliente'
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

// Só essa página puxa a lib de leitura de código de barras (~500KB) — carrega
// sob demanda, pra quem visita a loja como cliente nunca baixar esse peso
// (só admin/vendedor, logados, acessam PDV).
const AdminPdv = lazy(() => import('./pages/admin/AdminPdv'))

function PdvFallback() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
    </div>
  )
}

// Fundo fixo com o cenário pôr-do-sol só aparece nas páginas de cliente —
// telas de staff (admin/motoboy/logins) continuam no fundo sólido de sempre.
function CustomerBackdrop() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/admin') || pathname.startsWith('/funcionarios')) return null
  return <SunsetBackdrop />
}

// Os 3 estilos de layout selecionáveis (Ufersin nativo / BurgerBite /
// Burger House) são TODOS fixos/hardcoded -- cor e estrutura não são
// editáveis manualmente pelo lojista (sistema antigo de picker+presets
// do Clone Sunset foi removido junto com a própria opção, ver
// DemoPaletteSwitcher.tsx e store/layoutStyle.ts). A ÚNICA personalização
// possível é "a cor da sua loja" (1-2 cores, opcional, ver
// store/tenantColor.ts): quando definida, deriva (nunca aplica cru, ver
// lib/colorHarmony.ts) um trio de acento harmonizado que sobrescreve o
// trio de marca fixo de QUALQUER estilo ativo (uiux2/uiux3/uiux4/
// theme.css já leem esse trio como fallback-override via
// --tenant-accent-1/2/3).
function DemoBrandScope() {
  const location = useLocation()
  const tenantColor = useTenantColor()
  const demo = isDemoModeActive()
  const isStaffPage = location.pathname.startsWith('/admin') || location.pathname.startsWith('/funcionarios')

  useEffect(() => {
    const root = document.documentElement
    root.dataset.brand = demo ? 'demo' : ''
    if (demo && !isStaffPage && tenantColor.color1) {
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

// Escolhe qual apresentação renderizar pra uma rota de cliente. Fora do
// modo demo, SEMPRE o Sunset original intocado (`sunset`) -- é o site de
// produção de verdade, existe independente de qualquer coisa escolhida
// aqui. Dentro do modo demo, "Clone Sunset" foi REMOVIDO do seletor (ver
// store/layoutStyle.ts) -- por isso o fallback em demo já não é mais
// `sunset`, é `ufersin` (o padrão atual). Isso também autocura qualquer
// `style` antigo ainda salvo no localStorage de quem testou a demo antes
// da remoção (ex.: valor 'sunset' preso de sessão anterior).
// Onboarding do lojista marcou "vender apenas internamente" -- a vitrine
// pública (landing/catálogo/carrinho/checkout/etc, tudo que passa por
// StyleAware) vira 404 de propósito; só o admin+PDV continuam de pé.
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

function StyleAware({
  sunset,
  ufersin,
  burgerbite,
  burgerhouse,
}: {
  sunset: React.ReactNode
  ufersin: React.ReactNode
  burgerbite: React.ReactNode
  burgerhouse: React.ReactNode
}) {
  const demoStyle = useLayoutStyle((s) => s.style)
  const tenantConfig = useTenantConfig()
  // null (ainda carregando) trata como liberado -- nunca 404 a vitrine à
  // toa por causa de uma resposta que ainda não chegou.
  if (tenantConfig?.vender_externamente === false) return <LojaSemVendaExterna />

  // Assinante Resolutoo (tem slug/config): usa o estilo escolhido no
  // onboarding/Meu plano. Demo pública: seletor local. Sem slug (deploy
  // Sunset single-tenant legado): shell Sunset original.
  const style = isDemoModeActive()
    ? demoStyle
    : tenantConfig?.slug
      ? tenantConfig.layout_style
      : null

  if (style === 'burgerbite') return <>{burgerbite}</>
  if (style === 'burgerhouse') return <>{burgerhouse}</>
  if (style === 'ufersin') return <>{ufersin}</>
  return <>{sunset}</>
}

export default function App() {
  // Vite define BASE_URL a partir de `base` no vite.config — em produção
  // embutido sob /loja fica "/loja/"; local fica "/".
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined
  return (
    <BrowserRouter basename={basename}>
      <DemoBrandScope />
      <CustomerBackdrop />
      <CustomerPageDecorations />
      <Routes>
        <Route path="/" element={<StyleAware sunset={<Landing />} ufersin={<Uiux2Landing />} burgerbite={<Uiux3Landing />} burgerhouse={<Uiux4Landing />} />} />
        {/* Ponte da demo pública da Rodoletas — ver pages/DemoEntrar.tsx. */}
        <Route path="/demo-entrar" element={<DemoEntrar />} />
        <Route path="/catalogo" element={<StyleAware sunset={<Catalogo />} ufersin={<Uiux2Catalogo />} burgerbite={<Uiux3Catalogo />} burgerhouse={<Uiux4Catalogo />} />} />
        <Route path="/produto/:id" element={<StyleAware sunset={<ProdutoDetalhe />} ufersin={<Uiux2ProdutoDetalhe />} burgerbite={<Uiux3ProdutoDetalhe />} burgerhouse={<Uiux4ProdutoDetalhe />} />} />
        <Route path="/carrinho" element={<StyleAware sunset={<Carrinho />} ufersin={<Uiux2Carrinho />} burgerbite={<Uiux3Carrinho />} burgerhouse={<Uiux4Carrinho />} />} />
        <Route path="/checkout" element={<StyleAware sunset={<Checkout />} ufersin={<Uiux2Checkout />} burgerbite={<Uiux3Checkout />} burgerhouse={<Uiux4Checkout />} />} />
        <Route path="/banner" element={<StyleAware sunset={<Banner />} ufersin={<Uiux2Banner />} burgerbite={<Uiux3Banner />} burgerhouse={<Uiux4Banner />} />} />
        <Route path="/banner/checkout" element={<StyleAware sunset={<BannerCheckout />} ufersin={<Uiux2BannerCheckout />} burgerbite={<Uiux3BannerCheckout />} burgerhouse={<Uiux4BannerCheckout />} />} />
        <Route path="/pagamento/:orderId" element={<StyleAware sunset={<Pagamento />} ufersin={<Uiux2Pagamento />} burgerbite={<Uiux3Pagamento />} burgerhouse={<Uiux4Pagamento />} />} />
        <Route path="/consultar" element={<StyleAware sunset={<Consultar />} ufersin={<Uiux2Consultar />} burgerbite={<Uiux3Consultar />} burgerhouse={<Uiux4Consultar />} />} />
        <Route path="/recuperar-senha" element={<StyleAware sunset={<RecuperarSenha />} ufersin={<Uiux2RecuperarSenha />} burgerbite={<Uiux3RecuperarSenha />} burgerhouse={<Uiux4RecuperarSenha />} />} />
        <Route path="/cliente/favoritos" element={<StyleAware sunset={<FavoritosCliente />} ufersin={<Uiux2Favoritos />} burgerbite={<Uiux3Favoritos />} burgerhouse={<Uiux4Favoritos />} />} />
        <Route path="/cliente/cupons" element={<StyleAware sunset={<CuponsCliente />} ufersin={<Uiux2Cupons />} burgerbite={<Uiux3Cupons />} burgerhouse={<Uiux4Cupons />} />} />
        {/* Página aposentada -- o resgate agora acontece direto em
            /cliente/cupons (cupom sai de um slot em vez de raspar). */}
        <Route path="/cliente/resgatarcupom" element={<Navigate to="/cliente/cupons" replace />} />
        <Route path="/cliente/historico" element={<StyleAware sunset={<HistoricoCliente />} ufersin={<Uiux2Historico />} burgerbite={<Uiux3Historico />} burgerhouse={<Uiux4Historico />} />} />

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
          <Route path="campanhas" element={<Navigate to="/admin/promocoes" replace />} />
          <Route path="layout-cliente" element={<AdminLayoutCliente />} />
          <Route path="financeiro" element={<AdminFinanceiro />} />
          <Route path="conta" element={<AdminSenha />} />
        </Route>

        {/* Vendedor e motoboy logam em /funcionarios/login e caem cada um no
            próprio dashboard, cada um com prefixo e layout de guarda
            totalmente próprios — nenhum dos dois mais passa por /admin/*
            (era assim antes só pro vendedor, que reaproveitava AdminLayout;
            mesmo com sessão isolada de verdade, a URL "/admin/..." lia como
            "entrou como admin" e foi reportado como sessão se confundindo). */}
        <Route path="/funcionarios/vendedor" element={<VendedorLayout />}>
          <Route index element={<Navigate to="/funcionarios/vendedor/pedidos" replace />} />
          <Route path="pedidos" element={<AdminPedidos />} />
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

        {/* Redirects pra quem tem link antigo salvo (a rota do motoboy já
            morou em /motoboy/* e depois em /admin/motoboy). */}
        <Route path="/motoboy/login" element={<Navigate to="/funcionarios/login" replace />} />
        <Route path="/motoboy/*" element={<Navigate to="/funcionarios/motoboy" replace />} />
        <Route path="/admin/motoboy/*" element={<Navigate to="/funcionarios/motoboy" replace />} />
        <Route path="/funcionarios/motoboy" element={<MotoboyLayout />}>
          <Route index element={<MotoboyFila />} />
          <Route path="corrida" element={<MotoboyCorrida />} />
          <Route path="financeiro" element={<MotoboyFinanceiro />} />
          <Route path="conta" element={<MotoboyConta />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
