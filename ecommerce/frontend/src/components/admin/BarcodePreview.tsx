import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { Download } from 'lucide-react'

// Preview empilhado (modelo paint): NomeProduto → barras → dígitos, centrados.
// O PNG baixado inclui os 3 itens no mesmo canvas.
export default function BarcodePreview({ value, productName }: { value: string; productName?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const downloadCanvasRef = useRef<HTMLCanvasElement>(null)
  const displayName = (productName ?? '').trim() || 'NomeProduto'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !value) return
    try {
      JsBarcode(canvas, value, {
        format: 'CODE128',
        width: 2,
        height: 60,
        displayValue: false,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000',
      })
    } catch {
      // valor inválido pro formato — não quebra a tela
    }
  }, [value])

  const download = () => {
    if (!value) return
    const canvas = downloadCanvasRef.current ?? document.createElement('canvas')
    downloadCanvasRef.current = canvas
    try {
      const name = displayName
      const topPad = 28
      const bottomPad = 28
      JsBarcode(canvas, value, {
        format: 'CODE128',
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 14,
        margin: 8,
        marginTop: topPad,
        marginBottom: bottomPad,
        background: '#ffffff',
        lineColor: '#000000',
      })
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.textAlign = 'center'
        ctx.fillStyle = '#000'
        let fontSize = 14
        do {
          ctx.font = `bold ${fontSize}px sans-serif`
          fontSize -= 1
        } while (ctx.measureText(name).width > canvas.width - 16 && fontSize > 8)
        ctx.fillText(name, canvas.width / 2, 18)
      }
      const link = document.createElement('a')
      link.download = `codigo-barras-${value}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch {
      // ignore
    }
  }

  if (!value) return null

  return (
    <div
      className="flex flex-col items-center justify-center gap-2 bg-white rounded-xl p-4 text-black"
      data-testid="barcode-preview-stack"
    >
      <p className="text-sm font-bold text-center leading-tight px-2 break-words max-w-full">{displayName}</p>
      <canvas ref={canvasRef} className="max-w-full" />
      <p className="text-sm font-mono tracking-wider text-center">{value}</p>
      <button type="button" onClick={download} className="btn-secondary text-xs py-1.5 px-3 mt-1">
        <Download className="w-3.5 h-3.5" /> Baixar imagem
      </button>
    </div>
  )
}
