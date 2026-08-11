import { Navigate, Route, Routes } from 'react-router-dom'
import EnvironmentBanner from './components/EnvironmentBanner'
import Landing from './pages/Landing'
import Demo from './pages/Demo'
import DemoPlano from './pages/DemoPlano'
import DemoPlanoEletronica from './pages/DemoPlanoEletronica'
import DemoExperience from './pages/DemoExperience'
import Cadastro from './pages/Cadastro'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import MercadoPagoCallback from './pages/MercadoPagoCallback'
import EsqueciSenha from './pages/EsqueciSenha'
import RedefinirSenha from './pages/RedefinirSenha'
import TrocarSenha from './pages/TrocarSenha'
import VerificarEmail from './pages/VerificarEmail'
import Planos from './pages/Planos'
import Assinar from './pages/Assinar'
import Dashboard from './pages/Dashboard'
import Onboarding from './pages/Onboarding'
import MeuPlano from './pages/MeuPlano'
import CompletarConta from './pages/CompletarConta'
import Obrigado from './pages/Obrigado'
import PoliticasPrivacidade from './pages/PoliticasPrivacidade'

export default function App() {
  return (
    <>
      <EnvironmentBanner />
      <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/demo" element={<Demo />} />
      {/* Experiências mock — URL canônica na barra de endereço Resolutoo */}
      <Route path="/demo/vitrine" element={<DemoExperience />} />
      <Route path="/demo/vitrine/:plano" element={<DemoExperience />} />
      <Route path="/demo/admin" element={<DemoExperience />} />
      <Route path="/demo/admin/:plano" element={<DemoExperience />} />
      <Route path="/demo/vendedor" element={<DemoExperience />} />
      <Route path="/demo/vendedor/:plano" element={<DemoExperience />} />
      <Route path="/demo/motoboy" element={<DemoExperience />} />
      <Route path="/demo/motoboy/:plano" element={<DemoExperience />} />
      {/* Ramo eletrônicos (vrtech) — módulo separado, escolha de área própria */}
      <Route path="/demo/eletronica/:plano" element={<DemoPlanoEletronica />} />
      {/* Escolha de área por plano (essential|management|premium) */}
      <Route path="/demo/:plano" element={<DemoPlano />} />
      <Route path="/cadastro" element={<Cadastro />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/mercadopago/callback" element={<MercadoPagoCallback />} />
      <Route path="/esqueci-senha" element={<EsqueciSenha />} />
      <Route path="/redefinir-senha" element={<RedefinirSenha />} />
      <Route path="/trocar-senha" element={<TrocarSenha />} />
      <Route path="/verificar-email" element={<VerificarEmail />} />
      <Route path="/planos" element={<Planos />} />
      <Route path="/assinar" element={<Assinar />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/lojas" element={<Dashboard />} />
      <Route path="/layout" element={<Dashboard />} />
      <Route path="/cupons" element={<Dashboard />} />
      <Route path="/financeiro" element={<Dashboard />} />
      <Route path="/relatorios" element={<Navigate to="/dashboard" replace />} />
      <Route path="/completar-conta" element={<CompletarConta />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/meu-plano" element={<MeuPlano />} />
      <Route path="/meu-plano/:tab" element={<MeuPlano />} />
      <Route path="/obrigado" element={<Obrigado />} />
      <Route path="/politicas-de-privacidade/:slug" element={<PoliticasPrivacidade />} />
      <Route path="/politicas-de-privacidade" element={<PoliticasPrivacidade />} />
      </Routes>
    </>
  )
}
