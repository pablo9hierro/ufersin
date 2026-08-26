import { jsPDF } from 'jspdf'
import type { ServiceOrderDto } from './eletronicosApi'
import type { ServiceRequestDto } from './eletronicosApi'

// Gera o PDF da Ordem de Serviço -- versão simplificada da lógica original
// do vrtech (generateServiceOrderPdf.ts, checklist/fotos item a item);
// como o painel novo ainda não tem checklist granular, usa o resumo já
// coletado (completed_services/final_value/warranty).
export function generateServiceOrderPdf(request: ServiceRequestDto, order: ServiceOrderDto, storeName: string): Blob {
  const doc = new jsPDF()
  const marginX = 15
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
  doc.line(marginX, y, 195, y)
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
  field('Serviço realizado', order.completed_services || '—')
  field('Garantia', order.warranty || 'não informada')
  field('Valor final', `R$ ${(order.final_value ?? 0).toFixed(2)}`)
  y += 4
  field('Data de conclusão', order.closed_at ? new Date(order.closed_at).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR'))

  return doc.output('blob')
}
