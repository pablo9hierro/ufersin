import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { Download } from 'lucide-react'

// Gera a imagem do código de barras (CODE128 — aceita qualquer texto, sem
// dígito verificador) num <canvas> escondido, só pra permitir o lojista
// baixar como PNG e colar na etiqueta do produto.
export default function BarcodePreview({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !value) return
    try {
      JsBarcode(canvasRef.current, value, {
        format: 'CODE128',
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 14,
        margin: 8,
      })
    } catch {
      // valor inválido pro formato — não quebra a tela, só não desenha
    }
  }, [value])

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
