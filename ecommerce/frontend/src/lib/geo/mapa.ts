import type L from 'leaflet'

// Tiles do mapa — OpenStreetMap renderizado pela CARTO. Gratuito com
// atribuição obrigatória (já incluída no TILE_ATTR).
//
// "Dark Matter" (dark_all) em vez de "Voyager"/"Positron" — os estilos
// claros da CARTO desenham rua residencial num creme bem próximo do branco
// do resto do mapa (quase ilegível), e tentar consertar isso só com filtro
// CSS (invert+contrast) tem um problema real: o "auto dark theme" do
// Chrome no Android reprocessa cada tile (que é uma <img>) individualmente
// conforme ela entra na tela ao arrastar o mapa, e às vezes reaplica o
// PRÓPRIO escurecimento dele em cima do nosso filtro — resultado, o mapa
// pisca entre claro e escuro tile por tile durante o gesto. Um tile
// genuinamente escuro (feito assim pela CARTO, não invertido por CSS) não
// tem esse conflito: não sobra "fundo claro" pro heurístico do Chrome
// querer escurecer de novo.
export const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
export const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

// Centro usado quando o usuário nega o GPS (loja, José Américo de Almeida,
// João Pessoa - PB — mesma coordenada de sunset.shipping_settings).
export const FALLBACK = { lat: -7.1746, lng: -34.8576 }

// Diagnóstico: em vez de ficar advinhando por que os tiles não aparecem
// (pode ser contraste, pode ser a CDN da CARTO falhando/lenta numa rede
// específica — são bugs completamente diferentes e parecem iguais na
// tela), isso avisa de verdade quando os tiles estão de fato falhando em
// carregar (rede/CDN), separando isso de "carregou mas tá difícil de ver".
export function monitorarTiles(layer: L.TileLayer, onMudarStatus: (falhando: boolean) => void): () => void {
  let falhasSeguidas = 0
  const onErro = () => {
    falhasSeguidas++
    if (falhasSeguidas >= 3) onMudarStatus(true)
  }
  const onCarregou = () => {
    falhasSeguidas = 0
    onMudarStatus(false)
  }
  layer.on('tileerror', onErro)
  layer.on('tileload', onCarregou)
  return () => {
    layer.off('tileerror', onErro)
    layer.off('tileload', onCarregou)
  }
}

// Encaixa bounds (2 pontos) no espaço VISÍVEL de verdade — não usa o
// fitBounds nativo do Leaflet porque ele calcula o zoom em cima de
// map.getSize(), que é o tamanho do <div> que o Leaflet gerencia. Nos
// nossos mapas com rotação, esse div é propositalmente maior que a área
// visível na tela (inset:-80%, ~2.6x maior — pra não sobrar canto vazio
// quando gira), então o fitBounds nativo calcula um zoom pra caber numa
// área bem maior que a real, e os pontos acabam fora do que a tela
// realmente mostra. Esse helper mede o tamanho VISÍVEL de verdade (o
// wrapper de fora, que não é oversized) e calcula o zoom certo na mão via
// projeção geográfica, sem depender do tamanho que o Leaflet enxerga.
export function ajustarParaCaber(
  map: L.Map,
  bounds: L.LatLngBounds,
  visivel: { width: number; height: number },
  paddingPx = 40
) {
  const p1 = map.project(bounds.getNorthWest(), 0)
  const p2 = map.project(bounds.getSouthEast(), 0)
  // Nada de Math.max(..., 1) aqui — no zoom 0 o mundo inteiro cabe em
  // 256px, então dois pontos a poucos km de distância (o caso normal de
  // uma entrega dentro da cidade) ficam bem abaixo de 1px de distância
  // (testei com números reais: ~2km em João Pessoa dá ~0.013px). Um
  // "clamp" de segurança pra evitar divisão por zero em 1px inflava esse
  // valor em ~80x, o que derrubava o zoom calculado de ~14 (correto, dá
  // pra ver as ruas) pra ~7 (todo o Nordeste na tela). Só protege contra
  // divisão por zero de verdade (os dois pontos exatamente sobrepostos).
  const boundsW = Math.max(Math.abs(p2.x - p1.x), 1e-9)
  const boundsH = Math.max(Math.abs(p2.y - p1.y), 1e-9)
  const availW = Math.max(1, visivel.width - paddingPx * 2)
  const availH = Math.max(1, visivel.height - paddingPx * 2)
  const escala = Math.min(availW / boundsW, availH / boundsH)
  const zoom = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), Math.log2(escala)))
  map.setView(bounds.getCenter(), zoom, { animate: false })
}
