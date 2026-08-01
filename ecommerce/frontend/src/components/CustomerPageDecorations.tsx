import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { pageDecorationService } from '../services/pageDecorationService'
import type { PageDecoration, PageKey } from '../types'
import SmokeDecor from './decor/SmokeDecor'
import FireDecor from './decor/FireDecor'

function pageKeyForPath(pathname: string): PageKey | null {
  if (pathname === '/') return 'landing'
  if (pathname === '/catalogo') return 'catalogo'
  if (pathname === '/cliente/favoritos') return 'favoritos'
  if (pathname === '/cliente/cupons') return 'cupons'
  if (pathname === '/cliente/historico') return 'historico'
  return null
}

// Montado uma vez só (App.tsx) — busca o layout de TODAS as páginas uma
// vez e escolhe qual mostrar pela rota atual. Editado em /admin/layout-cliente.
export default function CustomerPageDecorations() {
  const { pathname } = useLocation()
  const [all, setAll] = useState<PageDecoration[]>([])

  useEffect(() => {
    pageDecorationService.list().then(setAll).catch(() => {})
  }, [])

  const pageKey = pageKeyForPath(pathname)
  if (!pageKey) return null
  const decoration = all.find((d) => d.page_key === pageKey)
  if (!decoration) return null

  return (
    <div className="sunset-page-decor-bg-wrap" aria-hidden="true">
      {decoration.background_image_url && (
        <div className="sunset-page-decor-bg" style={{ backgroundImage: `url(${decoration.background_image_url})` }} />
      )}
      {decoration.elements.map((el) =>
        el.type === 'smoke' ? <SmokeDecor key={el.id} el={el} /> : <FireDecor key={el.id} el={el} />
      )}
    </div>
  )
}
