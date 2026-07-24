import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import type { PageDecoration, PageKey } from '../lib/types'
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

// Montado uma vez só (App.tsx, ao lado de CustomerBackdrop) — busca o
// layout de TODAS as páginas uma vez e escolhe qual mostrar pela rota
// atual, sem refazer a requisição a cada navegação entre páginas de
// cliente. Editado pelo admin em /admin/layout-cliente.
export default function CustomerPageDecorations() {
  const { pathname } = useLocation()
  const [all, setAll] = useState<PageDecoration[]>([])

  useEffect(() => {
    api.pageDecorations.list().then(setAll).catch(() => {})
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
