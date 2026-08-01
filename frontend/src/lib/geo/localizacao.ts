import type { Ponto } from './tipos'

export function obterLocalizacao(): Promise<Ponto> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('navegador sem geolocalização'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 8000 },
    )
  })
}
