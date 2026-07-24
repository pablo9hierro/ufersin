// Manipulação manual do mapa (arrastar, pinçar pra zoom, girar com dois
// dedos) quando o mapa pode estar rotacionado.
//
// Por que isso não pode usar o dragging/touchZoom nativos do Leaflet: a
// gente gira o mapa aplicando transform: rotate() numa div POR FORA de
// tudo que o Leaflet controla (é a única forma segura de girar sem
// sobrescrever o transform que o próprio Leaflet usa pra posicionar os
// tiles). Só que o dragging/touchZoom nativos calculam o deslocamento em
// pixels de TELA e aplicam direto nas coordenadas internas do mapa, sem
// noção nenhuma de que aquilo está visualmente girado — resultado: assim
// que o mapa gira uma vez, arrastar/pinçar depois passa a se comportar de
// forma errada (ex.: parece que um dedo ficou "preso"), porque o Leaflet
// está computando tudo no referencial ERRADO.
//
// A solução correta é desligar o dragging/touchZoom/scrollWheelZoom
// nativos nesses mapas e reimplementar arrastar+pinçar+girar como UM gesto
// só, que sempre leva a rotação atual em conta ao converter "quanto o dedo
// moveu na tela" pra "quanto o mapa deve se mover de verdade".

export interface GestoMapaOpcoes {
  map: L.Map
  // Sempre lida o ângulo mais atual (não captura um valor antigo preso no
  // fechamento da função).
  getRotation: () => number
  onRotate: (anguloGraus: number) => void
  // Enquanto false, o gesto não mexe no mapa (ex.: modo travado do
  // motoboy, onde é o app que manda na posição/zoom/rotação).
  enabled?: () => boolean
  // Chamado assim que o usuário de fato arrasta/pinça/gira algo — útil pra
  // quem quer saber "o usuário mexeu no mapa na mão" sem depender dos
  // eventos dragstart/zoomstart nativos do Leaflet (que não disparam mais,
  // já que o dragging/touchZoom nativos ficam desligados nesses mapas).
  onInteract?: () => void
}

interface PontoTela {
  x: number
  y: number
}

function centroide(a: PontoTela, b: PontoTela): PontoTela {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
function distancia(a: PontoTela, b: PontoTela): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
function anguloEntre(a: PontoTela, b: PontoTela): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}
function deTouch(t: Touch): PontoTela {
  return { x: t.clientX, y: t.clientY }
}

// Roda um vetor de deslocamento de tela (dx,dy) pelo inverso da rotação
// atual — converte "quanto moveu na tela" pra "quanto precisa mover no
// referencial sem-rotação que o Leaflet entende".
function rotacionarVetor(dx: number, dy: number, anguloGraus: number): [number, number] {
  const rad = (-anguloGraus * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [dx * cos - dy * sin, dx * sin + dy * cos]
}

export function anexarGestoMapa(el: HTMLElement, opcoes: GestoMapaOpcoes): () => void {
  const { map, getRotation, onRotate } = opcoes
  const enabled = opcoes.enabled ?? (() => true)
  const onInteract = opcoes.onInteract ?? (() => {})

  // touchmove pode disparar dezenas de vezes por segundo — bem mais rápido
  // do que o navegador consegue de fato pintar um frame novo. Chamar
  // map.setZoom() a cada evento (como era antes) faz o Leaflet recalcular
  // e re-requisitar a grade de tiles várias vezes por frame, sem nenhuma
  // dessas passagens ter tempo de assentar — o resultado visível é o mapa
  // "piscando"/trocando de cor durante o pinça (reportado: parece um tile
  // claro aparecendo por baixo do escuro por uma fração de segundo).
  // A correção é desacoplar "receber o evento" de "aplicar no mapa":
  // touchmove só atualiza o estado mais recente do gesto (barato, não
  // toca no Leaflet), e um único requestAnimationFrame por frame real
  // aplica de uma vez só o delta acumulado desde o último frame aplicado.
  let ultimoMeioAplicado: PontoTela | null = null
  let ultimaDistanciaAplicada: number | null = null
  let ultimoAnguloAplicado: number | null = null

  let touchAtual: { pontos: PontoTela[] } | null = null
  let rafPendente = false

  function pan(dxTela: number, dyTela: number) {
    const [dx, dy] = rotacionarVetor(dxTela, dyTela, getRotation())
    // Arrasta o "papel" na direção do dedo — o centro do mapa anda pro
    // lado oposto do deslocamento do dedo.
    map.panBy([-dx, -dy], { animate: false })
  }

  function agendarFlush() {
    if (rafPendente) return
    rafPendente = true
    requestAnimationFrame(() => {
      rafPendente = false
      flush()
    })
  }

  function flush() {
    if (!touchAtual) return
    const { pontos } = touchAtual

    if (pontos.length === 1) {
      const p = pontos[0]
      if (ultimoMeioAplicado) pan(p.x - ultimoMeioAplicado.x, p.y - ultimoMeioAplicado.y)
      ultimoMeioAplicado = p
      ultimaDistanciaAplicada = null
      ultimoAnguloAplicado = null
      return
    }

    if (pontos.length === 2) {
      const [p0, p1] = pontos
      const meio = centroide(p0, p1)
      const dist = distancia(p0, p1)
      const ang = anguloEntre(p0, p1)

      if (ultimoMeioAplicado) pan(meio.x - ultimoMeioAplicado.x, meio.y - ultimoMeioAplicado.y)

      if (ultimaDistanciaAplicada != null && ultimaDistanciaAplicada > 0) {
        const fator = dist / ultimaDistanciaAplicada
        if (Number.isFinite(fator) && fator > 0) {
          map.setZoom(map.getZoom() + Math.log2(fator), { animate: false })
        }
      }

      if (ultimoAnguloAplicado != null) {
        let delta = ang - ultimoAnguloAplicado
        if (delta > 180) delta -= 360
        if (delta < -180) delta += 360
        onRotate(normalizarAngulo(getRotation() + delta))
      }

      ultimoMeioAplicado = meio
      ultimaDistanciaAplicada = dist
      ultimoAnguloAplicado = ang
    }
  }

  function onTouchStart(e: TouchEvent) {
    if (!enabled()) return
    if (e.touches.length === 1) {
      ultimoMeioAplicado = deTouch(e.touches[0])
      ultimaDistanciaAplicada = null
      ultimoAnguloAplicado = null
    } else if (e.touches.length === 2) {
      const p0 = deTouch(e.touches[0])
      const p1 = deTouch(e.touches[1])
      ultimoMeioAplicado = centroide(p0, p1)
      ultimaDistanciaAplicada = distancia(p0, p1)
      ultimoAnguloAplicado = anguloEntre(p0, p1)
    } else {
      ultimoMeioAplicado = null
      ultimaDistanciaAplicada = null
      ultimoAnguloAplicado = null
    }
    touchAtual = null
  }

  function onTouchMove(e: TouchEvent) {
    if (!enabled()) return
    if (e.touches.length !== 1 && e.touches.length !== 2) return
    e.preventDefault()
    onInteract()
    touchAtual = { pontos: Array.from(e.touches).slice(0, 2).map(deTouch) }
    agendarFlush()
  }

  function onTouchEnd(e: TouchEvent) {
    touchAtual = null
    if (e.touches.length === 0) {
      ultimoMeioAplicado = null
      ultimaDistanciaAplicada = null
      ultimoAnguloAplicado = null
    } else if (e.touches.length === 1) {
      ultimoMeioAplicado = deTouch(e.touches[0])
      ultimaDistanciaAplicada = null
      ultimoAnguloAplicado = null
    }
  }

  // Mouse (desktop): arrastar com o botão pressionado + roda pra zoom.
  // Sem gesto de girar no mouse (não existe "dois dedos" nele).
  let arrastandoComMouse = false
  let ultimoMouse: PontoTela | null = null

  function onMouseDown(e: MouseEvent) {
    if (!enabled() || e.button !== 0) return
    arrastandoComMouse = true
    ultimoMouse = { x: e.clientX, y: e.clientY }
  }
  function onMouseMove(e: MouseEvent) {
    if (!enabled() || !arrastandoComMouse || !ultimoMouse) return
    const p = { x: e.clientX, y: e.clientY }
    pan(p.x - ultimoMouse.x, p.y - ultimoMouse.y)
    ultimoMouse = p
    onInteract()
  }
  function onMouseUp() {
    arrastandoComMouse = false
    ultimoMouse = null
  }

  // Roda do mouse também é coalescida num RAF só — vários "ticks" da roda
  // chegando entre dois frames aplicavam um setZoom cada um antes (mesmo
  // problema do touch, só que raramente perceptível no desktop).
  let deltaWheelPendente = 0
  function onWheel(e: WheelEvent) {
    if (!enabled()) return
    e.preventDefault()
    onInteract()
    deltaWheelPendente += -Math.sign(e.deltaY) * 0.5
    if (rafPendente) return
    rafPendente = true
    requestAnimationFrame(() => {
      rafPendente = false
      if (deltaWheelPendente !== 0) {
        map.setZoom(map.getZoom() + deltaWheelPendente, { animate: false })
        deltaWheelPendente = 0
      }
      flush()
    })
  }

  el.addEventListener('touchstart', onTouchStart, { passive: true })
  el.addEventListener('touchmove', onTouchMove, { passive: false })
  el.addEventListener('touchend', onTouchEnd, { passive: true })
  el.addEventListener('touchcancel', onTouchEnd, { passive: true })
  el.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  el.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('touchcancel', onTouchEnd)
    el.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    el.removeEventListener('wheel', onWheel)
  }
}

// Normaliza pra sempre ficar entre -180 e 180 — só cosmético, evita o
// número crescer sem limite depois de várias voltas.
export function normalizarAngulo(deg: number): number {
  let d = deg % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}
