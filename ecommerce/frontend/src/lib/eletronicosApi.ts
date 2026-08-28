import { API_BASE } from './api'

// Vitrine pública do ramo eletrônica (assistência técnica) — sem login,
// tenant resolvido pelo slug na URL. Espelha eletronicos.rs::
// create_service_request_public / consultar_por_telefone no backend Rust.

export interface CreateServiceRequestPayload {
  customer_name: string
  customer_phone: string
  customer_email?: string
  phone_model?: string
  problem_description?: string
  image_url?: string
  self_pickup: boolean
  address_cep?: string
  address_street?: string
  address_number?: string
  address_reference?: string
  address_neighborhood?: string
  address_city?: string
  address_state?: string
  address_lat?: number
  address_lng?: number
  diagnosis_requested?: boolean
  estimated_quote_value?: number
}

export interface CatalogCategory {
  id: string
  name: string
  slug: string
  sort_order: number
  device_type: string
  device_types: string[]
  image_url: string | null
}

export interface CatalogItem {
  id: string
  category_id: string
  model_name: string | null
  repair_type: string
  price: number
  description: string | null
  image_url: string | null
  tags: string[]
}

export interface PublicCatalogModel {
  id: string
  brand_id: string
  name: string
}

export interface CatalogResponse {
  categories: CatalogCategory[]
  items: CatalogItem[]
  models: PublicCatalogModel[]
}

export interface ServiceRequestDto {
  id: string
  created_at: string
  customer_name: string
  customer_phone: string
  customer_email: string | null
  phone_model: string | null
  problem_description: string | null
  image_url: string | null
  status: string
  quote_value: number | null
  estimated_quote_value: number | null
  owner_notes: string | null
  discount_percent: number | null
  payment_methods: { method: string; value: number }[]
  self_pickup: boolean
  shipping_price: number | null
  diagnosis_requested: boolean
  source: string
  address_label: string | null
  address_lat: number | null
  address_lng: number | null
}

export interface ChecklistItem {
  component: string
  checked: boolean
  description: string
  media_urls: string[]
  value: number | null
  note: string | null
  warranty_days: number | null
  stock_item_id: string | null
  added_at: string | null
}

export interface ServiceOrderUpdateDto {
  id: string
  service_order_id: string
  created_at: string
  message: string | null
  media_urls: string[]
  action_type: string
  component: string | null
}

export interface ServiceOrderDto {
  id: string
  request_id: string
  created_at: string
  updated_at: string
  checklist: ChecklistItem[]
  completed_services: string | null
  warranty: string | null
  final_value: number | null
  pdf_url: string | null
  closed_at: string | null
}

export interface AppointmentDto {
  id: string
  service_id: string | null
  service_label: string | null
  customer_name: string
  customer_phone: string
  starts_at: string
  ends_at: string
  status: string
  notes: string | null
  appointment_type: string
}

export interface ConsultarResponse {
  requests: (ServiceRequestDto & { service_order: ServiceOrderDto | null; diagnostic: { pdf_url: string | null; finalized: boolean } | null })[]
  appointments: AppointmentDto[]
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error((body && (body.error || body.message)) || `erro ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function createServiceRequestPublic(
  slug: string,
  payload: CreateServiceRequestPayload,
): Promise<ServiceRequestDto> {
  const res = await fetch(`${API_BASE}/api/public/eletronicos/${encodeURIComponent(slug)}/service-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseOrThrow(res)
}

export async function uploadPublicMedia(slug: string, file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/api/public/eletronicos/${encodeURIComponent(slug)}/upload`, {
    method: 'POST',
    body: form,
  })
  const body = await parseOrThrow<{ url: string }>(res)
  return body.url
}

export async function fetchCatalog(slug: string): Promise<CatalogResponse> {
  const res = await fetch(`${API_BASE}/api/public/eletronicos/${encodeURIComponent(slug)}/catalog`)
  return parseOrThrow(res)
}

export async function consultarOtpCheck(slug: string, phone: string, send: boolean): Promise<{ found: boolean; sent: boolean }> {
  const res = await fetch(`${API_BASE}/api/public/eletronicos/${encodeURIComponent(slug)}/consultar-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone.replace(/\D/g, ''), send }),
  })
  return parseOrThrow(res)
}

export async function consultarOtpVerify(
  slug: string,
  phone: string,
  code: string,
): Promise<{ valid: boolean; requests: ConsultarResponse['requests']; appointments: ConsultarResponse['appointments'] }> {
  const res = await fetch(`${API_BASE}/api/public/eletronicos/${encodeURIComponent(slug)}/consultar-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone.replace(/\D/g, ''), code }),
  })
  return parseOrThrow(res)
}

export async function consultarCancel(slug: string, id: string, phone: string): Promise<ServiceRequestDto> {
  const res = await fetch(`${API_BASE}/api/public/eletronicos/${encodeURIComponent(slug)}/consultar-cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, phone: phone.replace(/\D/g, '') }),
  })
  return parseOrThrow(res)
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando análise',
  aguardando_diagnostico: 'Aguardando diagnóstico',
  diagnostico_enviado: 'Orçamento enviado — aguardando sua aprovação',
  accepted: 'Orçamento aprovado',
  rejected: 'Orçamento recusado',
  retirada_local: 'Aguardando você trazer o aparelho',
  em_busca: 'A caminho pra buscar seu aparelho',
  in_progress: 'Em reparo',
  completed: 'Pronto — combinar entrega/retirada',
  em_pagamento: 'Aguardando pagamento',
  delivered: 'Entregue',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
}
