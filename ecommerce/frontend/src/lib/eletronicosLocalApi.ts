import { simulateDemoWrite } from './demoMode'
import type { EletronicaTemplate } from './eletronicosAdminApi'
import type { AppointmentDto } from './eletronicosApi'

// Mock local pro cliente eletronicosAdminApi.ts quando isDemoModeActive() —
// mesmo espírito de localApi.ts: dado de exemplo em memória, sem persistir
// entre reloads/telas. Cobre só os endpoints hoje alcançáveis a partir do
// mock (Template Zap e Agenda, compartilhados com o admin de ecommerce —
// ver App.tsx rotas /admin/template e /admin/agendamentos).

const now = () => new Date()
const iso = (d: Date) => d.toISOString()

let templates: EletronicaTemplate[] = [
  {
    id: 'tpl-1',
    template_key: 'orcamento_pronto',
    section: 'orçamento',
    label: 'Orçamento pronto',
    description: 'Enviado quando o orçamento fica pronto pro cliente aprovar.',
    content: 'Olá {{cliente}}! Seu orçamento pra {{aparelho}} ficou pronto: {{valor}}. Pode confirmar por aqui? 😊',
    required_variables: ['cliente', 'aparelho', 'valor'],
    available_variables: ['cliente', 'aparelho', 'valor', 'loja'],
    editable: true,
    enabled: true,
    sort_order: 1,
  },
  {
    id: 'tpl-2',
    template_key: 'reparo_pronto',
    section: 'reparo',
    label: 'Reparo pronto (Pronto)',
    description: 'Avisa que o aparelho está pronto pra retirada/entrega.',
    content: 'Boa notícia, {{cliente}}! Seu {{aparelho}} já está pronto. Vamos combinar a retirada ou entrega?',
    required_variables: ['cliente', 'aparelho'],
    available_variables: ['cliente', 'aparelho', 'loja'],
    editable: true,
    enabled: true,
    sort_order: 2,
  },
  {
    id: 'tpl-3',
    template_key: 'agendamento_confirmado',
    section: 'agenda',
    label: 'Agendamento confirmado',
    description: 'Confirma data/horário do agendamento.',
    content: 'Agendamento confirmado pra {{data}} às {{hora}}. Te esperamos!',
    required_variables: ['data', 'hora'],
    available_variables: ['data', 'hora', 'cliente', 'loja'],
    editable: true,
    enabled: false,
    sort_order: 3,
  },
]

function fmtDate(offsetDays: number) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

let appointments: AppointmentDto[] = [
  {
    id: 'apt-1',
    service_id: null,
    service_label: 'Troca de tela',
    customer_name: 'Marina Souza',
    customer_phone: '11988887777',
    starts_at: `${fmtDate(0)}T14:00:00.000Z`,
    ends_at: `${fmtDate(0)}T14:40:00.000Z`,
    status: 'confirmed',
    notes: 'Cliente prefere retirar no balcão.',
    appointment_type: 'reparo',
  },
  {
    id: 'apt-2',
    service_id: null,
    service_label: 'Diagnóstico geral',
    customer_name: 'João Pedro',
    customer_phone: '11977776666',
    starts_at: `${fmtDate(1)}T10:00:00.000Z`,
    ends_at: `${fmtDate(1)}T10:30:00.000Z`,
    status: 'confirmed',
    notes: null,
    appointment_type: 'diagnostico',
  },
]

function businessHoursDefault() {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    open_time: weekday === 0 ? '00:00' : '08:00',
    close_time: weekday === 0 ? '00:00' : '18:00',
  }))
}

function dayAgenda() {
  // Slots de 30min das 8h às 18h, todos disponíveis — dado de exemplo.
  const slots: { starts_at: string; ends_at: string; available: boolean; reason: string | null }[] = []
  const base = now()
  for (let h = 8; h < 18; h++) {
    for (const m of [0, 30]) {
      const s = new Date(base)
      s.setHours(h, m, 0, 0)
      const e = new Date(s)
      e.setMinutes(e.getMinutes() + 30)
      slots.push({ starts_at: iso(s), ends_at: iso(e), available: true, reason: null })
    }
  }
  return slots
}

/**
 * Roteador mínimo por (método, path) pros endpoints de eletronicosAdminApi
 * que a demo mock consegue alcançar. `path` já inclui o prefixo BASE.
 * ponytail: switch linear em vez de tabela de rotas — só ~10 casos, tabela
 * seria mais indireção pro mesmo resultado; revisar se a lista crescer muito.
 */
export async function eletronicosLocalApi(path: string, init: RequestInit = {}): Promise<unknown> {
  const method = (init.method || 'GET').toUpperCase()
  const [pathname, query] = path.split('?')
  const params = new URLSearchParams(query || '')

  // Templates
  if (pathname === '/api/admin/eletronicos/templates' && method === 'GET') return templates
  const tplMatch = pathname.match(/^\/api\/admin\/eletronicos\/templates\/([^/]+)$/)
  if (tplMatch && method === 'PUT') {
    const key = tplMatch[1]
    const body = JSON.parse((init.body as string) || '{}')
    templates = templates.map((t) => (t.template_key === key ? { ...t, content: body.content ?? t.content } : t))
    return templates.find((t) => t.template_key === key)
  }
  const tplToggleMatch = pathname.match(/^\/api\/admin\/eletronicos\/templates\/([^/]+)\/toggle$/)
  if (tplToggleMatch && method === 'PATCH') {
    const key = tplToggleMatch[1]
    const body = JSON.parse((init.body as string) || '{}')
    templates = templates.map((t) => (t.template_key === key ? { ...t, enabled: !!body.enabled } : t))
    return templates.find((t) => t.template_key === key)
  }

  // Agenda
  if (pathname === '/api/admin/eletronicos/agenda/day' && method === 'GET') return dayAgenda()
  if (pathname === '/api/admin/eletronicos/agenda/blocks' && method === 'GET') return []
  if (pathname === '/api/admin/eletronicos/agenda/settings' && method === 'GET') {
    return {
      appointment_ai_enabled: true,
      default_duration_minutes: 30,
      lead_time_minutes: 60,
      max_advance_days: 30,
      buffer_minutes: 10,
    }
  }
  if (pathname === '/api/admin/eletronicos/agenda/settings' && method === 'PUT') {
    return simulateDemoWrite(init.body)
  }
  if (pathname === '/api/admin/eletronicos/agenda/business-hours' && method === 'GET') return businessHoursDefault()
  if (pathname === '/api/admin/eletronicos/agenda/business-hours' && method === 'PUT') {
    const body = JSON.parse((init.body as string) || '{}')
    return body.blocks ?? businessHoursDefault()
  }

  // Appointments
  if (pathname === '/api/admin/eletronicos/appointments' && method === 'GET') return appointments
  if (pathname === '/api/admin/eletronicos/appointments' && method === 'POST') {
    const body = JSON.parse((init.body as string) || '{}')
    const created: AppointmentDto = {
      id: `apt-${Math.random().toString(36).slice(2)}`,
      service_id: body.service_id ?? null,
      service_label: body.service_label ?? null,
      customer_name: body.customer_name,
      customer_phone: body.customer_phone,
      starts_at: `${body.date}T${body.time}:00.000Z`,
      ends_at: `${body.date}T${body.time}:00.000Z`,
      status: 'confirmed',
      notes: body.notes ?? null,
      appointment_type: 'reparo',
    }
    appointments = [...appointments, created]
    return created
  }
  const aptActionMatch = pathname.match(/^\/api\/admin\/eletronicos\/appointments\/([^/]+)\/(cancel|reschedule|complete)$/)
  if (aptActionMatch) {
    const [, id, action] = aptActionMatch
    const existing = appointments.find((a) => a.id === id)
    const updated: AppointmentDto = {
      ...(existing ?? appointments[0]),
      status: action === 'cancel' ? 'cancelled' : action === 'complete' ? 'completed' : 'confirmed',
    }
    appointments = appointments.map((a) => (a.id === id ? updated : a))
    return updated
  }
  const aptEventsMatch = pathname.match(/^\/api\/admin\/eletronicos\/appointments\/([^/]+)\/events$/)
  if (aptEventsMatch) return []

  // Qualquer outro endpoint deste cliente alcançado no mock (não deveria
  // acontecer nas rotas atuais /admin/template e /admin/agendamentos) —
  // devolve um write simulado genérico em vez de derrubar a tela com 401.
  return simulateDemoWrite(init.body)
}
