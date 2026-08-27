// Port 1:1 de src/lib/pdfImages.ts do vrtech -- baixa uma imagem (URL
// pública) e converte pra data URL + dimensões, formato que jsPDF's
// doc.addImage() exige. Usado pra embutir fotos de verdade nos PDFs de
// diagnóstico e ordem de serviço (antes só entravam como link clicável).

const MIME_TO_FORMAT: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
}

export function isImageUrl(url: string) {
  return !/\.(mp4|mov|webm|m4v)$/i.test(url)
}

export async function loadImage(url: string): Promise<{ dataUrl: string; width: number; height: number; format: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const format = MIME_TO_FORMAT[blob.type]
    if (!format) return null

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })

    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = reject
      img.src = dataUrl
    })

    return { dataUrl, format, ...dims }
  } catch {
    return null
  }
}
