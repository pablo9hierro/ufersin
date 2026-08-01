/**
 * Re-exports react-router com Link / Navigate / useNavigate que preservam
 * `?tenant=` na vitrine. Use nos packs uiux2/3/4 e shell do cliente.
 * Rotas admin/funcionário continuam importando de `react-router-dom`.
 */
export {
  BrowserRouter,
  MemoryRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
  useMatch,
  useOutletContext,
  useNavigationType,
} from 'react-router-dom'

export { default as Link } from '../components/TenantLink'
export { default as Navigate } from '../components/TenantNavigate'
export { useTenantNavigate as useNavigate } from '../hooks/useTenantNavigate'
