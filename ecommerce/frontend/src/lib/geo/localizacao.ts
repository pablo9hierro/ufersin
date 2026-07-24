// GPS do aparelho via navigator.geolocation (nativo do navegador). 100%
// gratuito — a posição vem do próprio celular/PC, nenhum servidor é
// consultado. Só funciona em HTTPS ou localhost. Portado de
// C:\Users\pablo\Documents\gliafico\src\backend\localizacao.js
import type { Ponto } from './tipos'

export function obterLocalizacao(): Promise<Ponto> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('navegador sem geolocalização'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 8000 }
    )
  })
}

export interface PosicaoContinua extends Ponto {
  // Direção do movimento em graus (0 = norte), null se o aparelho estiver
  // parado ou o navegador não reportar — vem do GPS (course over ground),
  // mais estável em cima de uma moto do que o magnetômetro do celular.
  heading: number | null
}

// GPS contínuo: chama `aoMudar({lat, lng, heading})` toda vez que o aparelho
// se move. É isso que roda no celular do MOTOBOY pra transmitir a posição
// dele em tempo real. Devolve uma função que PARA o rastreamento.
export function seguirLocalizacao(
  aoMudar: (p: PosicaoContinua) => void,
  aoErrar?: (e: unknown) => void
): () => void {
  if (!navigator.geolocation) {
    aoErrar?.(new Error('navegador sem geolocalização'))
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    (p) => aoMudar({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading }),
    (e) => aoErrar?.(e),
    { enableHighAccuracy: true, maximumAge: 3000 }
  )
  return () => navigator.geolocation.clearWatch(id)
}
