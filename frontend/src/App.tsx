import { Route, Routes } from 'react-router-dom'
import Assinar from './pages/Assinar'
import Obrigado from './pages/Obrigado'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Assinar />} />
      <Route path="/obrigado" element={<Obrigado />} />
    </Routes>
  )
}
