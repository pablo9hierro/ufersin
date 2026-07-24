// Ícones de mapa como SVG cru (string), sem depender de react-dom/server —
// renderToStaticMarkup funciona, mas puxa o renderer de servidor inteiro
// pro bundle do cliente só pra desenhar dois ícones pequenos.
import L from 'leaflet'

const BIKE_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/>' +
  '<path d="M5.5 17.5h5l2-6h4.5M14.5 8.5h3l1 3"/>' +
  '<circle cx="15" cy="6" r="1.2" fill="#fff" stroke="none"/></svg>'

// Badge redondo com a moto sempre em pé + setinha por cima que gira com o
// heading — girar o ícone inteiro deixaria a moto de cabeça pra baixo em
// certas direções. counterRotation: quando o mapa em volta está
// rotacionado, cancela isso só na bolinha (a setinha continua livre,
// mostrando a direção real do heading).
export function motoDivIcon(heading: number | null, size = 36, counterRotation = 0) {
  const html = `
    <div style="position:relative;width:${size}px;height:${size}px">
      <div style="position:absolute;inset:0;transform:rotate(${heading ?? 0}deg);transition:transform .25s">
        <div style="position:absolute;top:-7px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid #d5aa45"></div>
      </div>
      <div style="width:${size}px;height:${size}px;border-radius:9999px;background:linear-gradient(135deg,#e08a3a,#d5aa45 55%,#b57c27);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.45);border:2px solid #fff;transform:rotate(${counterRotation}deg);transition:transform .1s">
        ${BIKE_SVG}
      </div>
    </div>
  `
  return L.divIcon({ className: 'icone-limpo', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}

// counterRotation: quando o mapa em volta está rotacionado (trava de GPS
// ou gesto manual), cancela isso aqui pro efeito continuar centralizado em
// vez de girar junto com o mapa (mesma ideia do motoDivIcon).
//
// Efeito "sunset-dest-ping" (.sunset-dest-ping no index.css) — anel que
// pulsa saindo do centro (Uiverse by JaydipPrajapati1910, só o estilo/
// motion, recolorido pro rosa do site). Trocado de tamanho pra caber num
// marcador de mapa pequeno sem competir com o resto da tela — a
// referência original tem 44.8px, aqui é proporcional ao `size` pedido.
export function destDivIcon(size = 30, counterRotation = 0) {
  const ping = Math.round(size * 0.78)
  return L.divIcon({
    className: 'icone-limpo',
    html: `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;transform:rotate(${counterRotation}deg);transition:transform .1s"><div class="sunset-dest-ping" style="--s:${ping}px"></div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}
