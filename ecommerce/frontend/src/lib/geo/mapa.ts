import type L from 'leaflet'

// Tiles do mapa escuro (navegação com rotação por bússola). CARTO dark_all
// (usado antes) passou a exigir API key própria -- toda tile vinha com selo
// "API KEY REQUIRED" atravessado, confirmado ao vivo (curl direto na URL).
// Esri Dark Gray Canvas: genuinamente escuro (mesmo raciocínio de evitar o
// "auto dark theme" do Chrome reprocessando tile clara -- ver texto antigo
// abaixo, ainda válido), sem marca d'água, sem chave, já traz nome de rua
// embutido na própria tile em zoom de bairro.
export const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
export const TILE_ATTR = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, (c) OpenStreetMap contributors, and the GIS user community'
// Zoom nativo máximo da Esri pra esse basemap -- além disso ela devolve
// tile borrada/escalada, não teste além sem confirmar.
export const TILE_MAX_ZOOM = 16

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
