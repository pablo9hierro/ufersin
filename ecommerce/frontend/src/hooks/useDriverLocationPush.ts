import { useEffect, useRef } from 'react'
import { eletronicosAdmin } from '../lib/eletronicosAdminApi'

// Enquanto o lojista/técnico está logado no painel eletrônica, empurra a
// posição real do navegador pro backend periodicamente -- é o que alimenta
// o mapa de trajetória (loja/técnico -> cliente) tanto no dashboard admin
// quanto em /consultar do cliente. Best-effort: sem permissão de
// geolocalização, ou fora de um contexto seguro (https), simplesmente não
// manda nada -- nunca quebra o resto do painel.
const PUSH_INTERVAL_MS = 15_000

export function useDriverLocationPush(enabled: boolean) {
  const lastSentRef = useRef(0)

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) return

    const send = (lat: number, lng: number) => {
      const now = Date.now()
      if (now - lastSentRef.current < PUSH_INTERVAL_MS) return
      lastSentRef.current = now
      eletronicosAdmin.driverLocation.update(lat, lng).catch(() => {})
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => send(pos.coords.latitude, pos.coords.longitude),
      () => {
        /* permissão negada/indisponível -- best-effort, não faz nada */
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 10_000 },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [enabled])
}
