import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { Download } from 'lucide-react'

// Gera a imagem do código de barras (CODE128 — aceita qualquer texto, sem
// dígito verificador) num <canvas>, só pra permitir o lojista baixar como
// PNG e colar na etiqueta do produto. Com productName, reserva uma faixa
// em branco acima das barras (marginTop do JsBarcode) e desenha o nome
// nela na mão via Canvas 2D — desenhado no MESMO canvas (não é texto HTML
// solto por cima) pra continuar aparecendo na imagem baixada.
export default function BarcodePreview({ value, productName }: { value: string; productName?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !value) return
    try {
      JsBarcode(canvas, value, {
        format: 'CODE128',
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 14,
        margin: 8,
        marginTop: productName ? 26 : 8,
      })
      if (productName) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.textAlign = 'center'
          ctx.fillStyle = '#000'
          let fontSize = 14
          do {
            ctx.font = `bold ${fontSize}px sans-serif`
            fontSize -= 1
          } while (ctx.measureText(productName).width > canvas.width - 16 && fontSize > 8)
          ctx.fillText(productName, canvas.width / 2, 17)
        }
      }
    } catch {
      // valor inválido pro formato — não quebra a tela, só não desenha
    }
  }, [value, productName])

  const download = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `codigo-barras-${value}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  if (!value) return null

  return (
    <div className="flex flex-col items-center gap-2 bg-white rounded-xl p-3">
      <canvas ref={canvasRef} />
      <button type="button" onClick={download} className="btn-secondary text-xs py-1.5 px-3">
        <Download className="w-3.5 h-3.5" /> Baixar imagem
      </button>
    </div>
  )
}
