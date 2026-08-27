import { jsPDF } from 'jspdf'
import type { ServiceOrderDto, ChecklistItem } from './eletronicosApi'
import type { ServiceRequestDto } from './eletronicosApi'

// Gera o PDF da Ordem de Serviço -- port funcional de
// generateServiceOrderPdf.ts do vrtech: itemiza cada componente marcado na
// checklist (com valor/garantia individual), não só o resumo. Gap
// disclosed: fotos ficam como link clicável, não embutidas (mesma
// simplificação de generateDiagnosticPdf, lib/pdfImages.ts do original não
// foi portado).
export function generateServiceOrderPdf(
  request: ServiceRequestDto,
  order: ServiceOrderDto,
  storeName: string,
  checklist?: ChecklistItem[],
): Blob {
  const doc = new jsPDF()
  const marginX = 15
  const w = doc.internal.pageSize.getWidth()
  let y = 20

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(storeName, marginX, y)
  y += 6
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text('Ordem de Serviço', marginX, y)
  y += 10

  doc.setDrawColor(200)
  doc.line(marginX, y, w - marginX, y)
  y += 8

  const field = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold')
    doc.text(`${label}:`, marginX, y)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(value || '—', 130)
    doc.text(lines, marginX + 40, y)
    y += 6 * lines.length
  }

  field('Cliente', request.customer_name)
  field('Telefone', request.customer_phone)
  field('Aparelho', request.phone_model || '—')
  field('Problema relatado', request.problem_description || '—')
  y += 4

  const checkedItems = (checklist ?? order.checklist ?? []).filter((i) => i.checked)
  if (checkedItems.length > 0) {
    doc.line(marginX, y, w - marginX, y)
    y += 8
    doc.setFont('helvetica', 'bold')
    doc.text('Componentes reparados', marginX, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    for (const item of checkedItems) {
      doc.setFont('helvetica', 'bold')
      doc.text(`• ${item.component}`, marginX, y)
      if (item.value != null) doc.text(`R$ ${item.value.toFixed(2)}`, w - marginX - 30, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      if (item.description) {
        const lines = doc.splitTextToSize(item.description, w - marginX * 2 - 8)
        doc.text(lines, marginX + 6, y)
        y += lines.length * 5
      }
      if (item.warranty_days != null) {
        doc.setTextColor(120)
        doc.text(`Garantia: ${item.warranty_days} dias`, marginX + 6, y)
        doc.setTextColor(0)
        y += 5
      }
      y += 2
    }
    y += 2
  }

  field('Serviço realizado', order.completed_services || '—')
  field('Garantia', order.warranty || 'não informada')
  field('Valor final', `R$ ${(order.final_value ?? 0).toFixed(2)}`)
  y += 4
  field('Data de conclusão', order.closed_at ? new Date(order.closed_at).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR'))

  return doc.output('blob')
}

// Gera o PDF de diagnóstico -- versão simplificada da lógica original do
// vrtech (DiagnosticSection.tsx::generatePdfBlob, que também embute fotos
// anexadas dentro do PDF); esse motor ainda não tem o helper de carregar
// imagem pra PDF (lib/pdfImages.ts), então as fotos ficam só como link
// clicável, não embutidas.
export function generateDiagnosticPdf(
  request: ServiceRequestDto,
  storeName: string,
  services: { repair_type: string; price: number }[],
  notes: string,
  finalTotal: number,
  mediaUrls: string[],
): Blob {
  const doc = new jsPDF()
  const marginX = 15
  const w = doc.internal.pageSize.getWidth()
  let y = 20

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(`${storeName} — Diagnóstico de Reparo`, marginX, y)
  y += 8

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120)
  doc.text(`Emitido em ${new Date().toLocaleString('pt-BR')}`, marginX, y)
  doc.setTextColor(0)
  y += 8

  doc.setDrawColor(200)
  doc.line(marginX, y, w - marginX, y)
  y += 8

  const field = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold')
    doc.text(`${label}:`, marginX, y)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(value || '—', 130)
    doc.text(lines, marginX + 40, y)
    y += 6 * lines.length
  }

  field('Cliente', request.customer_name)
  field('Telefone', request.customer_phone)
  field('Aparelho', request.phone_model || '—')
  field('Problema', request.problem_description || '—')
  y += 4

  if (services.length > 0) {
    doc.line(marginX, y, w - marginX, y)
    y += 8
    doc.setFont('helvetica', 'bold')
    doc.text('Serviços identificados', marginX, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    for (const s of services) {
      doc.text(`• ${s.repair_type}`, marginX, y)
      doc.text(`R$ ${s.price.toFixed(2)}`, w - marginX - 30, y)
      y += 6
    }
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.text('Total do orçamento:', marginX, y)
    doc.text(`R$ ${finalTotal.toFixed(2)}`, w - marginX - 30, y)
    y += 10
  }

  if (notes) {
    doc.line(marginX, y, w - marginX, y)
    y += 8
    doc.setFont('helvetica', 'bold')
    doc.text('Observações do técnico', marginX, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(notes, w - marginX * 2)
    doc.text(lines, marginX, y)
    y += lines.length * 5 + 5
  }

  if (mediaUrls.length > 0) {
    doc.line(marginX, y, w - marginX, y)
    y += 8
    doc.setFont('helvetica', 'bold')
    doc.text('Fotos/vídeos anexados', marginX, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(0, 0, 238)
    mediaUrls.forEach((url, i) => {
      doc.textWithLink(`Anexo ${i + 1} (toque para abrir)`, marginX, y, { url })
      y += 5
    })
    doc.setTextColor(0)
    doc.setFontSize(11)
  }

  return doc.output('blob')
}
