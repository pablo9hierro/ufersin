import { Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing'
import Demo from './pages/Demo'
import DemoPlano from './pages/DemoPlano'
import Cadastro from './pages/Cadastro'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import EsqueciSenha from './pages/EsqueciSenha'
import RedefinirSenha from './pages/RedefinirSenha'
import VerificarEmail from './pages/VerificarEmail'
import Planos from './pages/Planos'
import Assinar from './pages/Assinar'
import Dashboard from './pages/Dashboard'
import Onboarding from './pages/Onboarding'
import MeuPlano from './pages/MeuPlano'
import CompletarConta from './pages/CompletarConta'
import Obrigado from './pages/Obrigado'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/demo/:plano" element={<DemoPlano />} />
      <Route path="/cadastro" element={<Cadastro />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/esqueci-senha" element={<EsqueciSenha />} />
      <Route path="/redefinir-senha" element={<RedefinirSenha />} />
      <Route path="/verificar-email" element={<VerificarEmail />} />
      <Route path="/planos" element={<Planos />} />
      <Route path="/assinar" element={<Assinar />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/completar-conta" element={<CompletarConta />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/meu-plano" element={<MeuPlano />} />
      <Route path="/obrigado" element={<Obrigado />} />
    </Routes>
  )
}
