import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import CustomerPageDecorations from './components/CustomerPageDecorations'
import EnvironmentBanner from './components/EnvironmentBanner'
import DemoEntrar from './pages/DemoEntrar'
import { isDemoModeActive } from './lib/demoMode'
import { persistTenantSlug, resolveTenantSlug, withTenantSearch } from './lib/tenantConfig'
import TenantNavigate from './components/TenantNavigate'
import { useTenantColor } from './store/tenantColor'
import { deriveAccentTrio } from './lib/colorHarmony'
import { useLayoutStyle, type LayoutStyle } from './store/layoutStyle'
import { useTenantConfig } from './hooks/useTenantConfig'
import { useCart } from './store/cart'
import { useCustomer } from './store/customer'
import { useCustomerAuth } from './store/customerAuth'
import DemoPaletteSwitcher from './components/theme/DemoPaletteSwitcher'
import './uiux2/theme.css'
import './uiux3/theme.css'
import './uiux4/theme.css'
import AdminLayout from './components/layout/AdminLayout'
import VendedorLayout from './components/layout/VendedorLayout'
import MotoboyLayout from './components/layout/MotoboyLayout'

// Admin + storefront pages are route-split so /admin/* does not download
// three full CMS themes, leaflet checkout maps, or every admin screen.
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'))
const FuncionarioLogin = lazy(() => import('./pages/admin/FuncionarioLogin'))
const AdminPedidos = lazy(() => import('./pages/admin/AdminPedidos'))
const AdminPdv = lazy(() => import('./pages/admin/AdminPdv'))
const AdminProdutos = lazy(() => import('./pages/admin/AdminProdutos'))
const AdminProdutosXml = lazy(() => import('./pages/admin/AdminProdutosXml'))
const AdminAgendamentos = lazy(() => import('./pages/admin/AdminAgendamentos'))
const AdminTemplate = lazy(() => import('./pages/admin/AdminTemplate'))
const AdminEstoque = lazy(() => import('./pages/admin/AdminEstoque'))
const AdminEstoqueXml = lazy(() => import('./pages/admin/AdminEstoqueXml'))
const AdminProdutosServicos = lazy(() => import('./pages/admin/AdminProdutosServicos'))
const AdminMotoboys = lazy(() => import('./pages/admin/AdminMotoboys'))
const AdminFrete = lazy(() => import('./pages/admin/AdminFrete'))
const AdminFinanceiro = lazy(() => import('./pages/admin/AdminFinanceiro'))
const AdminSenha = lazy(() => import('./pages/admin/AdminSenha'))
const AdminPromocoes = lazy(() => import('./pages/admin/AdminPromocoes'))
const AdminLayoutCliente = lazy(() => import('./pages/admin/AdminLayoutCliente'))
const AdminCrm = lazy(() => import('./pages/admin/AdminCrm'))
const AdminChat = lazy(() => import('./pages/admin/AdminChat'))
const MotoboyFila = lazy(() => import('./pages/motoboy/MotoboyFila'))
const MotoboyCorrida = lazy(() => import('./pages/motoboy/MotoboyCorrida'))
const MotoboyFinanceiro = lazy(() => import('./pages/motoboy/MotoboyFinanceiro'))
const MotoboyConta = lazy(() => import('./pages/motoboy/MotoboyConta'))

const Uiux2Landing = lazy(() => import('./uiux2/pages/Landing'))
const Uiux2Catalogo = lazy(() => import('./uiux2/pages/Catalogo'))
const Uiux2ProdutoDetalhe = lazy(() => import('./uiux2/pages/ProdutoDetalhe'))
const Uiux2ServicoDetalhe = lazy(() => import('./uiux2/pages/ServicoDetalhe'))
const Uiux3ServicoDetalhe = lazy(() => import('./uiux3/pages/ServicoDetalhe'))
const Uiux4ServicoDetalhe = lazy(() => import('./uiux4/pages/ServicoDetalhe'))
const Uiux2ServicosCatalogo = lazy(() => import('./uiux2/pages/ServicosCatalogo'))
const Uiux3ServicosCatalogo = lazy(() => import('./uiux3/pages/ServicosCatalogo'))
const Uiux4ServicosCatalogo = lazy(() => import('./uiux4/pages/ServicosCatalogo'))
const Uiux2Carrinho = lazy(() => import('./uiux2/pages/Carrinho'))
const Uiux2Checkout = lazy(() => import('./uiux2/pages/Checkout'))
const Uiux2Consultar = lazy(() => import('./uiux2/pages/Consultar'))
const EletronicaHome = lazy(() => import('./pages/eletronicos/EletronicaHome'))
const EletronicaLoja = lazy(() => import('./pages/eletronicos/EletronicaLoja'))
const EletronicaConsultar = lazy(() => import('./pages/eletronicos/EletronicaConsultar'))
const EletronicaCatalogoServico = lazy(() => import('./pages/eletronicos/EletronicaCatalogoServico'))
const EletronicaAdminLayout = lazy(() => import('./pages/eletronicos/EletronicaAdminLayout'))
const EletronicaAdminDashboard = lazy(() => import('./pages/eletronicos/EletronicaAdminDashboard'))
const EletronicaAdminEstoque = lazy(() => import('./pages/eletronicos/EletronicaAdminEstoque'))
const EletronicaAdminAgenda = lazy(() => import('./pages/eletronicos/EletronicaAdminAgenda'))
const EletronicaAdminPdv = lazy(() => import('./pages/eletronicos/EletronicaAdminPdv'))
const EletronicaAdminTemplates = lazy(() => import('./pages/eletronicos/EletronicaAdminTemplates'))
const EletronicaAdminEmBreve = lazy(() => import('./pages/eletronicos/EletronicaAdminEmBreve'))
const EletronicaAdminConta = lazy(() => import('./pages/eletronicos/EletronicaAdminConta'))
const EletronicaRelatorios = lazy(() => import('./pages/eletronicos/EletronicaRelatorios'))
const Uiux2RecuperarSenha = lazy(() => import('./uiux2/pages/RecuperarSenha'))
const Uiux2Favoritos = lazy(() => import('./uiux2/pages/Favoritos'))
const Uiux2Cupons = lazy(() => import('./uiux2/pages/Cupons'))
const Uiux2Historico = lazy(() => import('./uiux2/pages/Historico'))
const Uiux2Banner = lazy(() => import('./uiux2/pages/Banner'))
const Uiux2BannerCheckout = lazy(() => import('./uiux2/pages/BannerCheckout'))
const Uiux2Pagamento = lazy(() => import('./uiux2/pages/Pagamento'))

const Uiux3Landing = lazy(() => import('./uiux3/pages/Landing'))
const Uiux3Catalogo = lazy(() => import('./uiux3/pages/Catalogo'))
const Uiux3ProdutoDetalhe = lazy(() => import('./uiux3/pages/ProdutoDetalhe'))
const Uiux3Carrinho = lazy(() => import('./uiux3/pages/Carrinho'))
const Uiux3Checkout = lazy(() => import('./uiux3/pages/Checkout'))
const Uiux3Consultar = lazy(() => import('./uiux3/pages/Consultar'))
const Uiux3RecuperarSenha = lazy(() => import('./uiux3/pages/RecuperarSenha'))
const Uiux3Favoritos = lazy(() => import('./uiux3/pages/Favoritos'))
const Uiux3Cupons = lazy(() => import('./uiux3/pages/Cupons'))
const Uiux3Historico = lazy(() => import('./uiux3/pages/Historico'))
const Uiux3Banner = lazy(() => import('./uiux3/pages/Banner'))
const Uiux3BannerCheckout = lazy(() => import('./uiux3/pages/BannerCheckout'))
const Uiux3Pagamento = lazy(() => import('./uiux3/pages/Pagamento'))

const Uiux4Landing = lazy(() => import('./uiux4/pages/Landing'))
const Uiux4Catalogo = lazy(() => import('./uiux4/pages/Catalogo'))
const Uiux4ProdutoDetalhe = lazy(() => import('./uiux4/pages/ProdutoDetalhe'))
const Uiux4Carrinho = lazy(() => import('./uiux4/pages/Carrinho'))
const Uiux4Checkout = lazy(() => import('./uiux4/pages/Checkout'))
const Uiux4Consultar = lazy(() => import('./uiux4/pages/Consultar'))
const Uiux4RecuperarSenha = lazy(() => import('./uiux4/pages/RecuperarSenha'))
const Uiux4Favoritos = lazy(() => import('./uiux4/pages/Favoritos'))
const Uiux4Cupons = lazy(() => import('./uiux4/pages/Cupons'))
const Uiux4Historico = lazy(() => import('./uiux4/pages/Historico'))
const Uiux4Banner = lazy(() => import('./uiux4/pages/Banner'))
const Uiux4BannerCheckout = lazy(() => import('./uiux4/pages/BannerCheckout'))
const Uiux4Pagamento = lazy(() => import('./uiux4/pages/Pagamento'))

type LazyPage = LazyExoticComponent<ComponentType>

/** Persiste ?tenant= e reescreve a URL se o slug só estiver no localStorage
 *  (ex.: após Link antigo ter stripado a query — reload ainda recupera). */
function TenantBootstrap() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const isStaff =
    location.pathname.startsWith('/admin') || location.pathname.startsWith('/funcionarios')

  useEffect(() => {
    const fromQuery = params.get('tenant')?.trim().toLowerCase()
    if (fromQuery) {
      persistTenantSlug(fromQuery)
      return
    }
    if (isStaff || isDemoModeActive()) return
    const stored = resolveTenantSlug()
    if (!stored) return
    persistTenantSlug(stored)
    navigate(
      { pathname: location.pathname, search: withTenantSearch(location.search), hash: location.hash },
      { replace: true },
    )
  }, [params, isStaff, navigate, location.pathname, location.search, location.hash])

  // Carrinho é global no localStorage — sem isso, item de uma loja
  // "vazava" pro carrinho de outra loja visitada na mesma aba/navegador.
  useEffect(() => {
    if (isStaff || isDemoModeActive()) return
    const slug = resolveTenantSlug()
    if (!slug) return
    useCart.getState().syncTenant(slug)
    useCustomer.getState().syncTenant(slug)
    useCustomerAuth.getState().syncTenant(slug)
  }, [isStaff, params, location.pathname])

  return null
}

// ÚNICOS estilos de vitrine Resolutoo: ufersin | burgerbite | burgerhouse
// (os 3 botões do DemoPaletteSwitcher). Padrão = ufersin (1º botão).
// Layout Sunset / pôr-do-sol foi REMOVIDO — não é fallback.
function DemoBrandScope() {
  const location = useLocation()
  const tenantColor = useTenantColor()
  const tenantConfig = useTenantConfig()
  const demo = isDemoModeActive()
  const isStaffPage = location.pathname.startsWith('/admin') || location.pathname.startsWith('/funcionarios')

  useEffect(() => {
    const root = document.documentElement
    root.dataset.brand = demo ? 'demo' : ''
    // Demo: cores do seletor local. Tenant real: cor_principal do onboarding.
    const accent = demo ? tenantColor.color1 : tenantConfig?.cor_principal || tenantColor.color1
    if (!isStaffPage && accent) {
      const trio = deriveAccentTrio(accent, demo ? tenantColor.color2 : null)
      root.style.setProperty('--tenant-accent-1', trio.accent1)
      root.style.setProperty('--tenant-accent-2', trio.accent2)
      root.style.setProperty('--tenant-accent-3', trio.accent3)
    } else {
      root.style.removeProperty('--tenant-accent-1')
      root.style.removeProperty('--tenant-accent-2')
      root.style.removeProperty('--tenant-accent-3')
    }
  }, [demo, isStaffPage, tenantColor.color1, tenantColor.color2, tenantConfig?.cor_principal])

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

/** `/loja/` sem ?tenant= não é a vitrine do assinante — é só o shell do
 *  motor. Sem isso, o fallback ufersin parecia "layout não salvou". */
function LojaSemTenant() {
  return (
    <main className="min-h-screen bg-son-black text-white flex items-center justify-center px-5 text-center">
      <div className="max-w-md">
        <p className="text-6xl font-black text-white/10 mb-3">Loja</p>
        <p className="text-son-silver-dim text-sm mb-2">
          Abra a vitrine com o link do seu painel Resolutoo, no formato:
        </p>
        <p className="font-mono text-sm text-white/80 mb-4">
          /loja/?tenant=seu-slug
        </p>
        <p className="text-son-silver-dim text-xs">
          Sem o parâmetro <span className="font-mono">tenant</span>, esta página não carrega o layout da sua loja.
        </p>
      </div>
    </main>
  )
}

function StyleLoading() {
  return (
    <main className="min-h-screen bg-son-black text-white flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
    </main>
  )
}

/** Rota de vitrine sem página nativa ainda pro ramo eletrônica (ex:
 * /catalogo, /produto/:id — só o "/" e "/consultar" têm página própria por
 * enquanto). NUNCA sai pro app externo vrtech-jp.vercel.app (descontinuado
 * de vez) -- manda pra home nativa da loja, que é o fluxo real (formulário
 * de solicitação), em vez de um link externo morto. */
function EletronicaStorefrontRedirect({ slug }: { slug: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    navigate(`/${window.location.search}`, { replace: true })
  }, [slug, navigate])
  return <StyleLoading />
}

function resolveStorefrontStyle(demoStyle: LayoutStyle, tenantStyle: string | undefined): LayoutStyle {
  // Tenant real: layout_style do onboarding/Meu plano manda — nunca o zustand da demo.
  if (resolveTenantSlug()) {
    if (tenantStyle === 'burgerbite' || tenantStyle === 'burgerhouse' || tenantStyle === 'ufersin') {
      return tenantStyle
    }
    return 'ufersin'
  }
  if (isDemoModeActive()) return demoStyle
  return 'ufersin'
}

function StyleAware({
  ufersin: Ufersin,
  burgerbite: Burgerbite,
  burgerhouse: Burgerhouse,
  eletronica,
  skipVenderExternamenteGate = false,
}: {
  ufersin: LazyPage
  burgerbite: LazyPage
  burgerhouse: LazyPage
  /** Página nativa própria do ramo eletrônica pra esta rota (identidade
   * visual própria, nunca um dos 3 temas de ecommerce acima). Enquanto uma
   * rota não tem página nativa ainda, `undefined` mantém o redirect pro
   * app antigo do vrtech (ver EletronicaStorefrontRedirect) — migração
   * rota por rota, sem quebrar o que ainda não foi portado. */
  eletronica?: LazyPage
  /** `/pagamento/:orderId` completa uma venda que JÁ existe (PDV mandou o
   * link pro WhatsApp do cliente) — "loja sem venda externa" bloqueia
   * navegação/catálogo público, não o pagamento de um pedido específico já
   * criado. Sem essa exceção, uma loja PDV-only nunca conseguia receber
   * pagamento online de jeito nenhum: o próprio link de cobrança 404ava. */
  skipVenderExternamenteGate?: boolean
}) {
  const demoStyle = useLayoutStyle((s) => s.style)
  const tenantConfig = useTenantConfig()
  const slug = resolveTenantSlug()

  // Demo pública (sem ?tenant=): seletor local.
  if (!slug && isDemoModeActive()) {
    const style = resolveStorefrontStyle(demoStyle, undefined)
    const Page = style === 'burgerbite' ? Burgerbite : style === 'burgerhouse' ? Burgerhouse : Ufersin
    return (
      <Suspense fallback={<StyleLoading />}>
        <Page />
      </Suspense>
    )
  }

  // Vitrine real exige slug (?tenant= ou localStorage pós-login admin).
  if (!slug) return <LojaSemTenant />
  // Não aplicar ufersin por padrão enquanto a config (com layout_style) não chega.
  if (!tenantConfig) return <StyleLoading />
  // Ramo eletrônicos tem vitrine PRÓPRIA (app real do vrtech, proxiado via
  // /loja/eletronica-loja no vercel.json — ver AdminLayout.tsx pro mesmo
  // padrão do lado do painel) — nunca os 3 temas de ecommerce daqui: são
  // identidade visual de e-commerce, misturar com o ramo eletrônica é
  // exatamente o que não pode acontecer entre ramos hospedados na Resolutoo.
  if (tenantConfig.vertical === 'eletronicos') {
    if (!eletronica) return <EletronicaStorefrontRedirect slug={slug} />
    const Eletronica = eletronica
    return (
      <Suspense fallback={<StyleLoading />}>
        <Eletronica />
      </Suspense>
    )
  }
  if (tenantConfig.vender_externamente === false && !skipVenderExternamenteGate) return <LojaSemVendaExterna />

  const style = resolveStorefrontStyle(demoStyle, tenantConfig.layout_style)
  const Page = style === 'burgerbite' ? Burgerbite : style === 'burgerhouse' ? Burgerhouse : Ufersin
  return (
    <Suspense fallback={<StyleLoading />}>
      <Page />
    </Suspense>
  )
}

export default function App() {
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined
  return (
    <BrowserRouter basename={basename}>
      <EnvironmentBanner />
      <TenantBootstrap />
      <DemoBrandScope />
      <CustomerPageDecorations />
      <Suspense fallback={<StyleLoading />}>
        <Routes>
          <Route
            path="/"
            element={<StyleAware ufersin={Uiux2Landing} burgerbite={Uiux3Landing} burgerhouse={Uiux4Landing} eletronica={EletronicaHome} />}
          />
          <Route path="/demo-entrar" element={<DemoEntrar />} />
          <Route path="/catalogo" element={<StyleAware ufersin={Uiux2Catalogo} burgerbite={Uiux3Catalogo} burgerhouse={Uiux4Catalogo} eletronica={EletronicaLoja} />} />
          <Route path="/produto/:id" element={<StyleAware ufersin={Uiux2ProdutoDetalhe} burgerbite={Uiux3ProdutoDetalhe} burgerhouse={Uiux4ProdutoDetalhe} />} />
          <Route path="/servico/:id" element={<StyleAware ufersin={Uiux2ServicoDetalhe} burgerbite={Uiux3ServicoDetalhe} burgerhouse={Uiux4ServicoDetalhe} />} />
          <Route path="/servicos" element={<StyleAware ufersin={Uiux2ServicosCatalogo} burgerbite={Uiux3ServicosCatalogo} burgerhouse={Uiux4ServicosCatalogo} />} />
          {/* Cart/checkout do ramo eletrônica reaproveita a tela genérica (ufersin) --
              real, funcional, sem inventar UI nova; não existe checkout próprio do
              vrtech pra migrar (o vrtech original nunca teve checkout de produto). */}
          <Route path="/carrinho" element={<StyleAware ufersin={Uiux2Carrinho} burgerbite={Uiux3Carrinho} burgerhouse={Uiux4Carrinho} eletronica={Uiux2Carrinho} />} />
          <Route path="/checkout" element={<StyleAware ufersin={Uiux2Checkout} burgerbite={Uiux3Checkout} burgerhouse={Uiux4Checkout} eletronica={Uiux2Checkout} />} />
          <Route path="/banner" element={<StyleAware ufersin={Uiux2Banner} burgerbite={Uiux3Banner} burgerhouse={Uiux4Banner} />} />
          <Route path="/banner/checkout" element={<StyleAware ufersin={Uiux2BannerCheckout} burgerbite={Uiux3BannerCheckout} burgerhouse={Uiux4BannerCheckout} />} />
          <Route path="/pagamento/:orderId" element={<StyleAware ufersin={Uiux2Pagamento} burgerbite={Uiux3Pagamento} burgerhouse={Uiux4Pagamento} skipVenderExternamenteGate />} />
          <Route
            path="/consultar"
            element={<StyleAware ufersin={Uiux2Consultar} burgerbite={Uiux3Consultar} burgerhouse={Uiux4Consultar} eletronica={EletronicaConsultar} />}
          />
          <Route path="/catalogo-servico" element={<EletronicaCatalogoServico />} />
          <Route path="/recuperar-senha" element={<StyleAware ufersin={Uiux2RecuperarSenha} burgerbite={Uiux3RecuperarSenha} burgerhouse={Uiux4RecuperarSenha} />} />
          <Route path="/cliente/favoritos" element={<StyleAware ufersin={Uiux2Favoritos} burgerbite={Uiux3Favoritos} burgerhouse={Uiux4Favoritos} />} />
          <Route path="/cliente/cupons" element={<StyleAware ufersin={Uiux2Cupons} burgerbite={Uiux3Cupons} burgerhouse={Uiux4Cupons} />} />
          <Route path="/cliente/resgatarcupom" element={<TenantNavigate to="/cliente/cupons" replace />} />
          <Route path="/cliente/historico" element={<StyleAware ufersin={Uiux2Historico} burgerbite={Uiux3Historico} burgerhouse={Uiux4Historico} />} />

          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin-eletronica" element={<EletronicaAdminLayout />}>
            <Route index element={<EletronicaAdminDashboard />} />
            <Route path="chat" element={<AdminChat />} />
            <Route path="pdv" element={<EletronicaAdminPdv />} />
            <Route path="agenda" element={<EletronicaAdminAgenda />} />
            <Route path="produtos" element={<EletronicaAdminEstoque />} />
            <Route path="servicodeslocamento" element={<EletronicaAdminEmBreve title="Serviço de deslocamento" />} />
            <Route path="relatorios" element={<EletronicaRelatorios />} />
            <Route path="template-zap" element={<EletronicaAdminTemplates />} />
            <Route path="conta" element={<EletronicaAdminConta />} />
          </Route>
          <Route path="/funcionarios/login" element={<FuncionarioLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/pedidos" replace />} />
            <Route path="pedidos" element={<AdminPedidos />} />
            <Route path="pdv" element={<AdminPdv />} />
            <Route path="produtos" element={<AdminProdutos />} />
            <Route path="produtos/xml" element={<AdminProdutosXml />} />
            <Route path="produtos/erp-formulacao" element={<Navigate to="/admin/estoque" replace />} />
            <Route path="produtos/servicos" element={<AdminProdutosServicos />} />
            <Route path="estoque" element={<AdminEstoque />} />
            <Route path="estoque/xml" element={<AdminEstoqueXml />} />
            <Route path="frete" element={<AdminFrete />} />
            <Route path="motoboys" element={<AdminMotoboys />} />
            <Route path="crm" element={<AdminCrm />} />
            <Route path="chat" element={<AdminChat />} />
            <Route path="agendamentos" element={<AdminAgendamentos />} />
            <Route path="template" element={<AdminTemplate />} />
            <Route path="promocoes" element={<AdminPromocoes />} />
            <Route path="layout-cliente" element={<AdminLayoutCliente />} />
            <Route path="relatorios" element={<AdminFinanceiro />} />
            <Route path="financeiro" element={<TenantNavigate to="/admin/relatorios" replace />} />
            <Route path="conta" element={<AdminSenha />} />
          </Route>
          <Route path="/funcionarios/vendedor" element={<VendedorLayout />}>
            <Route index element={<Navigate to="/funcionarios/vendedor/pdv" replace />} />
            <Route path="pdv" element={<AdminPdv />} />
            <Route path="financeiro" element={<AdminFinanceiro />} />
          </Route>
          <Route path="/funcionarios/motoboy" element={<MotoboyLayout />}>
            <Route index element={<Navigate to="/funcionarios/motoboy/fila" replace />} />
            <Route path="fila" element={<MotoboyFila />} />
            <Route path="corrida" element={<MotoboyCorrida />} />
            <Route path="financeiro" element={<MotoboyFinanceiro />} />
            <Route path="conta" element={<MotoboyConta />} />
          </Route>
          <Route path="*" element={<TenantNavigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
