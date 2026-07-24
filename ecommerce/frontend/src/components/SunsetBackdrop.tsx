import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { BgSettings } from '../lib/types'
import BackgroundScene from './BackgroundScene'

const DEFAULT_SETTINGS: BgSettings = { bg_mode: 'svg1', bg_image_url: null, bg_scale: 1, bg_x: 0, bg_y: 0, bg_fit: 'meet' }

// Fundo fixo do site — busca o modo/ajuste escolhido pelo admin em
// /admin/conta (svg padrão, synthwave, estrelas ou imagem própria) e
// renderiza via BackgroundScene, que tem a lógica de cada modo.
export default function SunsetBackdrop() {
  const [settings, setSettings] = useState<BgSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    api.siteSettings
      .get()
      .then((s) => setSettings({ bg_mode: s.bg_mode, bg_image_url: s.bg_image_url, bg_scale: s.bg_scale, bg_x: s.bg_x, bg_y: s.bg_y, bg_fit: s.bg_fit }))
      .catch(() => {})
  }, [])

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
      <BackgroundScene settings={settings} />
    </div>
  )
}
