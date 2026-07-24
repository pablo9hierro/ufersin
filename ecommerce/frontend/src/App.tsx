import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import SunsetBackdrop from './components/SunsetBackdrop'
import CustomerPageDecorations from './components/CustomerPageDecorations'
import Landing from './pages/Landing'
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

export default function App() {
  return (
    <BrowserRouter>
      <CustomerBackdrop />
      <CustomerPageDecorations />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/catalogo" element={<Catalogo />} />
        <Route path="/produto/:id" element={<ProdutoDetalhe />} />
        <Route path="/carrinho" element={<Carrinho />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/banner" element={<Banner />} />
        <Route path="/banner/checkout" element={<BannerCheckout />} />
        <Route path="/pagamento/:orderId" element={<Pagamento />} />
        <Route path="/consultar" element={<Consultar />} />
        <Route path="/recuperar-senha" element={<RecuperarSenha />} />
        <Route path="/cliente/favoritos" element={<FavoritosCliente />} />
        <Route path="/cliente/cupons" element={<CuponsCliente />} />
        {/* Página aposentada -- o resgate agora acontece direto em
            /cliente/cupons (cupom sai de um slot em vez de raspar). */}
        <Route path="/cliente/resgatarcupom" element={<Navigate to="/cliente/cupons" replace />} />
        <Route path="/cliente/historico" element={<HistoricoCliente />} />

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
