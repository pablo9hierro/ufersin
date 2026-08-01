import type { Ponto } from './tipos'

export const FALLBACK: Ponto = { lat: -7.1195, lng: -34.845 } // João Pessoa
export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTR = '&copy; OpenStreetMap'

export function monitorarTiles(
  tileLayer: { on: (ev: string, fn: () => void) => void; off: (ev: string, fn: () => void) => void },
  onStatus: (falhando: boolean) => void,
): () => void {
  let fails = 0
  const onLoad = () => {
    fails = 0
    onStatus(false)
  }
  const onError = () => {
    fails += 1
    if (fails >= 3) onStatus(true)
  }
  tileLayer.on('load', onLoad)
  tileLayer.on('tileerror', onError)
  return () => {
    tileLayer.off('load', onLoad)
    tileLayer.off('tileerror', onError)
  }
}
