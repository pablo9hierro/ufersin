import { useAdminAuth } from '../store/adminAuth'
import { API_BASE } from './api'
import { ApiError } from './apiError'
import type {
  ServiceRequestDto,
  ServiceOrderDto,
  AppointmentDto,
} from './eletronicosApi'

// Admin autenticado (JWT do lojista, mesmo login de /admin) pro schema
// eletronicos.* -- espelha eletronicos.rs no backend Rust.

function token() {
  return useAdminAuth.getState().token ?? undefined
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...init.headers,
    },
  })
  if (res.status === 401) {
    useAdminAuth.getState().logout()
    throw new ApiError(401, 'sessão expirada, faça login de novo')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, (body && (body.error || body.message)) || `erro ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const BASE = '/api/admin/eletronicos'

export const eletronicosAdmin = {
  serviceRequests: {
    list: (status?: string) =>
      req<ServiceRequestDto[]>(`${BASE}/service-requests${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    get: (id: string) => req<ServiceRequestDto>(`${BASE}/service-requests/${id}`),
    updateStatus: (id: string, input: { status: string; quote_value?: number; owner_notes?: string }) =>
      req<ServiceRequestDto>(`${BASE}/service-requests/${id}/status`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
  serviceOrders: {
    getOrCreate: (requestId: string) =>
      req<ServiceOrderDto>(`${BASE}/service-requests/${requestId}/service-order`),
    complete: (id: string, input: { checklist: unknown[]; completed_services?: string; shipping_price?: number }) =>
      req<{ service_order: ServiceOrderDto; final_value: number }>(`${BASE}/service-orders/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
  appointments: {
    list: () => req<AppointmentDto[]>(`${BASE}/appointments`),
  },
  stockItems: {
    list: () =>
      req<
        {
          id: string
          name: string
          unit: string
          quantity: number
          price: number | null
          warranty_days: number | null
          units_per_box: number | null
          low_stock_threshold: number | null
        }[]
      >(`${BASE}/stock-items`),
    create: (input: { name: string; unit: string; quantity: number; price?: number }) =>
      req(`${BASE}/stock-items`, { method: 'POST', body: JSON.stringify(input) }),
    stockEntry: (id: string, quantity: number) =>
      req(`${BASE}/stock-items/${id}/entry`, { method: 'POST', body: JSON.stringify({ quantity }) }),
  },
  templates: {
    list: () =>
      req<
        {
          id: string
          template_key: string
          section: string
          label: string
          description: string | null
          content: string
          required_variables: string[]
          editable: boolean
          enabled: boolean
        }[]
      >(`${BASE}/templates`),
    updateContent: (key: string, content: string) =>
      req(`${BASE}/templates/${key}`, { method: 'PUT', body: JSON.stringify({ content }) }),
    toggle: (key: string, enabled: boolean) =>
      req(`${BASE}/templates/${key}/toggle`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  },
}
