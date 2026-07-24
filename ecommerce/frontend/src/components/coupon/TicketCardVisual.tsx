import { useId, type ReactNode } from 'react'

// Uiverse.io by dexter-st — ticket holográfico com corte/perfuração via
// máscara CSS + relevo falso 3D (feTurbulence/feSpecularLighting num
// filtro SVG, simulando luz batendo no papel perfurado). Clone fiel da
// técnica; paleta do holográfico deslocada do roxo/ciano original pro
// dourado/laranja/rosa do site (mix-blend-mode:difference/color-burn
// tornam substituição de matiz imprevisível às cegas — o resultado foi
// conferido visualmente, não só trocado por fórmula). Usado tanto sozinho
// (CouponTicket/CouponHistoryTicket, no carrossel) quanto dentro do
// slot que puxa o papel (CouponSlot, no botão "Resgatar cupom" e no
// card da landing).
export default function TicketCardVisual({
  header,
  bodyLines,
  footerLabel,
  footerValue,
}: {
  header: ReactNode
  bodyLines: ReactNode[]
  footerLabel: string
  footerValue: string
}) {
  // useId() em vez de um id fixo — a referência usa <filter id="bump">
  // fixo, mas com vários tickets na mesma página (carrossel) isso
  // duplicaria o id no DOM (inválido, e arriscado se um card com o
  // "original" do id for desmontado antes dos outros).
  const filterId = useId()
  return (
    <div className="sunset-t2-card">
      <div className="sunset-t2-header">
        {header}
        <div className="sunset-t2-symbol">✁</div>
      </div>
      <div className="sunset-t2-body">
        {bodyLines.map((line, i) => (
          <span key={i}>
            {i === 0 ? <em>{line}</em> : line}
            {i < bodyLines.length - 1 && <br />}
          </span>
        ))}
      </div>
      <div className="sunset-t2-footer">
        <div className="sunset-t2-number">
          {footerLabel} <span className="sunset-t2-bold">{footerValue}</span>
        </div>
        <div className="sunset-t2-barcode" />
      </div>
      <div className="sunset-t2-bg sunset-t2-holographic" style={{ filter: `url("#${filterId}")` }} />
      <svg className="sunset-t2-filter">
        <filter id={filterId}>
          <feTurbulence result="noise" numOctaves={3} baseFrequency={0.7} type="fractalNoise" />
          <feSpecularLighting
            in="noise"
            result="specular"
            lightingColor="#fffffc"
            specularExponent={25}
            specularConstant={0.8}
            surfaceScale={0.15}
          >
            <fePointLight z={210} y={100} x={100} />
          </feSpecularLighting>
          <feComposite result="noise2" operator="in" in="specular" in2="SourceGraphic" />
          <feBlend mode="screen" in2="noise2" in="SourceGraphic" />
        </filter>
      </svg>
    </div>
  )
}
