import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import type { PlanoCode } from '../lib/api'
import { demoEntrarUrl, type DemoRole } from '../lib/ecommerceUrl'

const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']
const ROLES: DemoRole[] = ['vitrine', 'admin', 'vendedor', 'motoboy']

function roleFromPath(pathname: string): DemoRole | null {
  const seg = pathname.split('/').filter(Boolean)[1] // /demo/{role}/...
  return ROLES.includes(seg as DemoRole) ? (seg as DemoRole) : null
}

/**
 * Shell da demo pública: URL canônica em `/demo/{role}/{plano}` (barra de
 * endereço Resolutoo). O motor embutido sob `/loja` entra via iframe já
 * autenticado em modo mock — o usuário nunca vê `/loja/admin/login`.
 */
export default function DemoExperience() {
  const { plano: planoParam } = useParams<{ plano?: string }>()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const role = roleFromPath(location.pathname)

  const planoFromQuery = searchParams.get('plano')
  const rawPlano = planoParam || planoFromQuery || 'essential'
  const plano = PLAN_ORDER.includes(rawPlano as PlanoCode) ? (rawPlano as PlanoCode) : null

  if (!role || !plano) {
    return <Navigate to="/demo" replace />
  }

  // Canonicaliza `/demo/admin?plano=essential` → `/demo/admin/essential`
  if (!planoParam && planoFromQuery) {
    return <Navigate to={`/demo/${role}/${plano}`} replace />
  }

  // `/demo/admin` sem plano → `/demo/admin/essential`
  if (!planoParam && !planoFromQuery) {
    return <Navigate to={`/demo/${role}/essential`} replace />
  }

  const src = demoEntrarUrl(role, plano)

  return (
    <iframe
      title={`Demonstração ${role} — plano ${plano}`}
      src={src}
      className="fixed inset-0 w-full h-full border-0 bg-black"
      allow="clipboard-write"
      referrerPolicy="no-referrer"
    />
  )
}
