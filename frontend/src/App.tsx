import { Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing'
import Cadastro from './pages/Cadastro'
import Login from './pages/Login'
import EsqueciSenha from './pages/EsqueciSenha'
import VerificarEmail from './pages/VerificarEmail'
import Dashboard from './pages/Dashboard'
import Onboarding from './pages/Onboarding'
import Obrigado from './pages/Obrigado'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/cadastro" element={<Cadastro />} />
      <Route path="/login" element={<Login />} />
      <Route path="/esqueci-senha" element={<EsqueciSenha />} />
      <Route path="/verificar-email" element={<VerificarEmail />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/obrigado" element={<Obrigado />} />
    </Routes>
  )
}
