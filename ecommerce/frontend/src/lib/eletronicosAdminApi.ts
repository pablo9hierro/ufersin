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
    updateStatus: (
      id: string,
      input: {
        status: string
        quote_value?: number
        owner_notes?: string
        discount_percent?: number
        payment_methods?: { method: string; value: number }[]
      },
    ) =>
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
    setPdf: (id: string, pdfUrl: string) =>
      req<ServiceOrderDto>(`${BASE}/service-orders/${id}/pdf`, {
        method: 'POST',
        body: JSON.stringify({ pdf_url: pdfUrl }),
      }),
    listClosed: () =>
      req<
        {
          id: string
          request_id: string
          closed_at: string | null
          final_value: number | null
          customer_name: string
          customer_phone: string
          phone_model: string | null
          payment_methods: { method: string; value: number }[]
          shipping_price: number | null
        }[]
      >(`${BASE}/service-orders-closed`),
  },
  uploadMedia: async (file: Blob, filename: string): Promise<string> => {
    const form = new FormData()
    form.append('file', file, filename)
    const res = await fetch(`${API_BASE}${BASE}/upload`, {
      method: 'POST',
      headers: token() ? { Authorization: `Bearer ${token()}` } : {},
      body: form,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new ApiError(res.status, (body && (body.error || body.message)) || `erro ${res.status}`)
    }
    const out = (await res.json()) as { url: string }
    return out.url
  },
  appointments: {
    list: () => req<AppointmentDto[]>(`${BASE}/appointments`),
    create: (input: {
      service_label: string
      customer_name: string
      customer_phone: string
      date: string
      time: string
      duration_minutes?: number
      notes?: string
    }) => req<AppointmentDto>(`${BASE}/appointments`, { method: 'POST', body: JSON.stringify(input) }),
    cancel: (id: string, justification?: string) =>
      req<AppointmentDto>(`${BASE}/appointments/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ justification }),
      }),
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
  pdv: {
    createSale: () =>
      req<{ id: string; status: string; total_value: number }>(`${BASE}/pdv/sales`, { method: 'POST' }),
    getSale: (id: string) =>
      req<{
        sale: { id: string; status: string; total_value: number; notes: string | null }
        items: { id: string; label: string; quantity: number; unit_price: number }[]
        payments: { id: string; method: string; amount: number; status: string; mp_payment_id: string | null }[]
      }>(`${BASE}/pdv/sales/${id}`),
    addItem: (
      saleId: string,
      input: { item_type: string; label: string; quantity: number; unit_price: number; stock_item_id?: string },
    ) => req(`${BASE}/pdv/sales/${saleId}/items`, { method: 'POST', body: JSON.stringify(input) }),
    addPayment: (
      saleId: string,
      input: { method: string; amount: number; installments?: number; change_amount?: number; mp_payment_id?: string },
    ) => req(`${BASE}/pdv/sales/${saleId}/payments`, { method: 'POST', body: JSON.stringify(input) }),
    confirmPayment: (saleId: string, paymentId: string) =>
      req(`${BASE}/pdv/sales/${saleId}/payments/${paymentId}/confirm`, { method: 'POST' }),
  },
  pix: {
    create: (input: { amount: number; customer_name: string; customer_email?: string; external_reference: string }) =>
      req<{ payment_id: string; qr_code: string; qr_code_base64: string }>('/api/admin/pdv/pix', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    status: (paymentId: string) =>
      req<{ status: string }>(`/api/admin/pdv/pix/${paymentId}/status`),
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
