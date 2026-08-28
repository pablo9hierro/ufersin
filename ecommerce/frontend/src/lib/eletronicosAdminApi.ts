import { useAdminAuth } from '../store/adminAuth'
import { API_BASE } from './api'
import { ApiError } from './apiError'
import type {
  ServiceRequestDto,
  ServiceOrderDto,
  ServiceOrderUpdateDto,
  ChecklistItem,
  AppointmentDto,
} from './eletronicosApi'
export type { ChecklistItem, ServiceOrderUpdateDto, ServiceOrderDto } from './eletronicosApi'

export type StockItemDto = {
  id: string
  name: string
  unit: string
  quantity: number
  price: number | null
  warranty_days: number | null
  units_per_box: number | null
  low_stock_threshold: number | null
  origin_type: 'manual' | 'erp_formulation'
}

// Unidades de medida do módulo eletrônica -- agrupadas por família (só
// converte dentro da mesma família: massa/volume/comprimento; discretas
// não convertem entre si). Mesma lista usada pelo backend
// (routes/eletronicos.rs::unit_family) -- manter em sincronia.
export const STOCK_UNIT_FAMILIES: { family: string; label: string; units: { value: string; label: string }[] }[] = [
  { family: 'discreta', label: 'Discreta', units: [
    { value: 'unidade', label: 'Unidade' },
    { value: 'caixa', label: 'Caixa' },
    { value: 'par', label: 'Par' },
    { value: 'pacote', label: 'Pacote' },
    { value: 'rolo', label: 'Rolo' },
  ] },
  { family: 'massa', label: 'Massa', units: [
    { value: 'g', label: 'Grama (g)' },
    { value: 'kg', label: 'Quilo (kg)' },
  ] },
  { family: 'volume', label: 'Volume', units: [
    { value: 'ml', label: 'Mililitro (ml)' },
    { value: 'l', label: 'Litro (l)' },
  ] },
  { family: 'comprimento', label: 'Comprimento', units: [
    { value: 'cm', label: 'Centímetro (cm)' },
    { value: 'm', label: 'Metro (m)' },
  ] },
]
export const ALL_STOCK_UNITS = STOCK_UNIT_FAMILIES.flatMap((f) => f.units)
export function unitFamilyOf(unit: string): string | null {
  return STOCK_UNIT_FAMILIES.find((f) => f.units.some((u) => u.value === unit))?.family ?? null
}
export function unitsInSameFamily(unit: string): { value: string; label: string }[] {
  return STOCK_UNIT_FAMILIES.find((f) => f.units.some((u) => u.value === unit))?.units ?? ALL_STOCK_UNITS
}

export type PdvSaleDetail = {
  sale: { id: string; status: string; total_value: number; notes: string | null }
  items: { id: string; label: string; quantity: number; unit_price: number }[]
  payments: {
    id: string
    method: string
    amount: number
    status: string
    installments: number | null
    change_amount: number | null
    mp_payment_id: string | null
  }[]
}

export type EletronicaAdminCatalogItem = {
  id: string
  category_id: string
  model_name: string | null
  repair_type: string
  price: number
  cost_price: number
  duration_minutes: number
  description: string | null
  image_url: string | null
  tags: string[]
  active: boolean
  sort_order: number
}

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
    getCredential: (id: string) => req<{ kind: string; value: string } | null>(`${BASE}/service-requests/${id}/credential`),
    setCredential: (id: string, input: { kind: 'pin' | 'pattern'; value: string }) =>
      req<{ kind: string; value: string }>(`${BASE}/service-requests/${id}/credential`, { method: 'PUT', body: JSON.stringify(input) }),
    getDiagnostic: (id: string) =>
      req<{
        id: string
        services_selected: { id: string; repair_type: string; price: number }[]
        notes: string | null
        pdf_url: string | null
        quote_confirmed: number | null
        media_urls: string[]
        finalized: boolean
      } | null>(`${BASE}/service-requests/${id}/diagnostic`),
    saveDiagnostic: (
      id: string,
      input: {
        services_selected: { id: string; repair_type: string; price: number }[]
        notes?: string
        pdf_url?: string
        quote_confirmed?: number
        media_urls: string[]
        finalized: boolean
      },
    ) => req<ServiceRequestDto>(`${BASE}/service-requests/${id}/diagnostic`, { method: 'PUT', body: JSON.stringify(input) }),
    create: (input: {
      customer_name: string
      customer_phone: string
      phone_model?: string
      problem_description?: string
      self_pickup: boolean
      address_lat?: number
      address_lng?: number
      address_neighborhood?: string
      status?: string
    }) => req<ServiceRequestDto>(`${BASE}/service-requests`, { method: 'POST', body: JSON.stringify(input) }),
    updateStatus: (
      id: string,
      input: {
        status: string
        quote_value?: number
        owner_notes?: string
        discount_percent?: number
        payment_methods?: { method: string; value: number }[]
        estimated_quote_value?: number
      },
    ) =>
      req<ServiceRequestDto>(`${BASE}/service-requests/${id}/status`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateQuoteValue: (id: string, quoteValue: number) =>
      req<ServiceRequestDto>(`${BASE}/service-requests/${id}/quote-value`, {
        method: 'PATCH',
        body: JSON.stringify({ quote_value: quoteValue }),
      }),
  },
  serviceOrders: {
    getOrCreate: (requestId: string) =>
      req<ServiceOrderDto>(`${BASE}/service-requests/${requestId}/service-order`),
    saveChecklist: (id: string, checklist: ChecklistItem[]) =>
      req<ServiceOrderDto>(`${BASE}/service-orders/${id}/checklist`, {
        method: 'POST',
        body: JSON.stringify({ checklist }),
      }),
    listUpdates: (id: string) => req<ServiceOrderUpdateDto[]>(`${BASE}/service-orders/${id}/updates`),
    addUpdate: (id: string, input: { message?: string; media_urls?: string[]; component?: string }) =>
      req<ServiceOrderUpdateDto>(`${BASE}/service-orders/${id}/updates`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    complete: (id: string, input: { checklist: ChecklistItem[]; completed_services?: string; shipping_price?: number }) =>
      req<{ service_order: ServiceOrderDto; final_value: number }>(`${BASE}/service-orders/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    reopen: (id: string, message: string) =>
      req<ServiceOrderDto>(`${BASE}/service-orders/${id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ message }),
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
    list: (range?: { from?: string; to?: string }) => {
      const params = new URLSearchParams()
      if (range?.from) params.set('from', range.from)
      if (range?.to) params.set('to', range.to)
      const qs = params.toString() ? `?${params.toString()}` : ''
      return req<AppointmentDto[]>(`${BASE}/appointments${qs}`)
    },
    create: (input: {
      service_label: string
      service_id?: string
      customer_name: string
      customer_phone: string
      date: string
      time: string
      duration_minutes?: number
      notes?: string
      service_request_id?: string
    }) => req<AppointmentDto>(`${BASE}/appointments`, { method: 'POST', body: JSON.stringify(input) }),
    cancel: (
      id: string,
      input: { justification: string; use_default_message?: boolean; custom_message?: string },
    ) =>
      req<AppointmentDto>(`${BASE}/appointments/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    reschedule: (
      id: string,
      input: {
        data: string
        horario: string
        justification: string
        use_default_message?: boolean
        custom_message?: string
        duration_minutes?: number
      },
    ) =>
      req<AppointmentDto>(`${BASE}/appointments/${id}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    complete: (id: string) => req<AppointmentDto>(`${BASE}/appointments/${id}/complete`, { method: 'POST' }),
    events: (id: string) =>
      req<
        {
          id: string
          appointment_id: string
          action: string
          actor_type: string
          actor_id: string | null
          justification: string | null
          previous_starts_at: string | null
          previous_ends_at: string | null
          new_starts_at: string | null
          new_ends_at: string | null
          created_at: string
        }[]
      >(`${BASE}/appointments/${id}/events`),
  },
  agenda: {
    day: (date: string) =>
      req<{ starts_at: string; ends_at: string; available: boolean; reason: string | null }[]>(
        `${BASE}/agenda/day?date=${encodeURIComponent(date)}`,
      ),
    blocks: {
      list: (date: string) =>
        req<{ id: string; starts_at: string; ends_at: string; reason: string | null }[]>(
          `${BASE}/agenda/blocks?date=${encodeURIComponent(date)}`,
        ),
      create: (input: { data: string; hora_inicio: string; hora_fim: string; motivo: string }) =>
        req<{ id: string; starts_at: string; ends_at: string; reason: string | null }>(`${BASE}/agenda/blocks`, {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      delete: (id: string) => req<void>(`${BASE}/agenda/blocks/${id}`, { method: 'DELETE' }),
    },
    settings: {
      get: () =>
        req<{
          appointment_ai_enabled: boolean
          default_duration_minutes: number
          lead_time_minutes: number
          max_advance_days: number
          buffer_minutes: number
        }>(`${BASE}/agenda/settings`),
      update: (input: {
        appointment_ai_enabled: boolean
        lead_time_minutes: number
        buffer_minutes: number
        default_duration_minutes: number
      }) =>
        req<{
          appointment_ai_enabled: boolean
          default_duration_minutes: number
          lead_time_minutes: number
          max_advance_days: number
          buffer_minutes: number
        }>(`${BASE}/agenda/settings`, { method: 'PUT', body: JSON.stringify(input) }),
    },
    businessHours: {
      list: () => req<{ weekday: number; open_time: string; close_time: string }[]>(`${BASE}/agenda/business-hours`),
      update: (input: { blocks: { weekday: number; open_time: string; close_time: string }[] }) =>
        req<{ weekday: number; open_time: string; close_time: string }[]>(`${BASE}/agenda/business-hours`, {
          method: 'PUT',
          body: JSON.stringify(input),
        }),
    },
  },
  catalogCategories: {
    list: () =>
      req<{ id: string; name: string; slug: string; sort_order: number; device_type: string; device_types: string[] }[]>(`${BASE}/catalog-categories`),
    create: (input: { name: string; device_types: string[]; sort_order?: number }) =>
      req<{ id: string; name: string; slug: string; sort_order: number; device_type: string; device_types: string[] }>(`${BASE}/catalog-categories`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, input: { name: string; device_types: string[]; sort_order?: number }) =>
      req<{ id: string; name: string; slug: string; sort_order: number; device_type: string; device_types: string[] }>(`${BASE}/catalog-categories/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    delete: (id: string) => req<void>(`${BASE}/catalog-categories/${id}`, { method: 'DELETE' }),
  },
  catalogItems: {
    list: () => req<EletronicaAdminCatalogItem[]>(`${BASE}/catalog-items`),
    create: (input: Omit<EletronicaAdminCatalogItem, 'id'>) =>
      req<EletronicaAdminCatalogItem>(`${BASE}/catalog-items`, { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Omit<EletronicaAdminCatalogItem, 'id'>) =>
      req<EletronicaAdminCatalogItem>(`${BASE}/catalog-items/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    delete: (id: string) => req<void>(`${BASE}/catalog-items/${id}`, { method: 'DELETE' }),
    saveLinks: (
      id: string,
      input: {
        device_ids: string[]
        brand_ids: string[]
        model_ids: string[]
        parts: { stock_item_id: string; quantity: number; unit: string }[]
        extra_costs: { name: string; value: number }[]
      },
    ) => req<void>(`${BASE}/catalog-items/${id}/links`, { method: 'PUT', body: JSON.stringify(input) }),
    devices: () => req<{ service_catalog_item_id: string; device_type_id: string }[]>(`${BASE}/catalog-items-links`),
    brands: () => req<{ service_catalog_item_id: string; brand_id: string }[]>(`${BASE}/catalog-items-brands`),
    models: () => req<{ service_catalog_item_id: string; model_id: string }[]>(`${BASE}/catalog-items-models`),
    parts: () =>
      req<
        {
          id: string
          service_catalog_item_id: string
          stock_item_id: string
          quantity: number
          unit: string
          name: string
          stock_unit: string
          stock_quantity: number
          price: number
          origin_type: 'manual' | 'erp_formulation'
        }[]
      >(`${BASE}/catalog-items-parts`),
    extraCosts: () =>
      req<{ id: string; service_catalog_item_id: string; name: string; value: number }[]>(`${BASE}/catalog-items-extra-costs`),
  },
  products: {
    devices: () => req<{ product_id: string; device_type_id: string }[]>(`${BASE}/products-devices`),
    brands: () => req<{ product_id: string; brand_id: string }[]>(`${BASE}/products-brands`),
    models: () => req<{ product_id: string; model_id: string }[]>(`${BASE}/products-models`),
    saveLinks: (id: string, input: { device_ids: string[]; brand_ids: string[]; model_ids: string[] }) =>
      req<void>(`${BASE}/products-links/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  },
  deviceTypes: {
    list: () => req<{ id: string; name: string; slug: string; icon_key: string; sort_order: number }[]>(`${BASE}/device-types`),
    create: (name: string) =>
      req<{ id: string; name: string; slug: string; icon_key: string; sort_order: number }>(`${BASE}/device-types`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    update: (id: string, name: string) =>
      req<{ id: string; name: string; slug: string; icon_key: string; sort_order: number }>(`${BASE}/device-types/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    delete: (id: string) => req<void>(`${BASE}/device-types/${id}`, { method: 'DELETE' }),
  },
  catalogModels: {
    list: () => req<{ id: string; brand_id: string; name: string; sort_order: number }[]>(`${BASE}/catalog-models`),
    create: (brand_id: string, name: string) =>
      req<{ id: string; brand_id: string; name: string; sort_order: number }>(`${BASE}/catalog-models`, {
        method: 'POST',
        body: JSON.stringify({ brand_id, name }),
      }),
    update: (id: string, brand_id: string, name: string) =>
      req<{ id: string; brand_id: string; name: string; sort_order: number }>(`${BASE}/catalog-models/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ brand_id, name }),
      }),
    delete: (id: string) => req<void>(`${BASE}/catalog-models/${id}`, { method: 'DELETE' }),
  },
  stockItems: {
    list: () =>
      req<StockItemDto[]>(`${BASE}/stock-items`),
    create: (input: {
      name: string
      unit: string
      quantity: number
      price?: number
      warranty_days?: number
      units_per_box?: number
      low_stock_threshold?: number
      origin_type?: 'manual' | 'erp_formulation'
    }) => req<StockItemDto>(`${BASE}/stock-items`, { method: 'POST', body: JSON.stringify(input) }),
    update: (
      id: string,
      input: {
        name: string
        unit: string
        quantity: number
        price?: number
        warranty_days?: number
        units_per_box?: number
        low_stock_threshold?: number
      },
    ) => req<StockItemDto>(`${BASE}/stock-items/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    delete: (id: string) => req<void>(`${BASE}/stock-items/${id}`, { method: 'DELETE' }),
    stockEntry: (id: string, quantity: number) =>
      req<StockItemDto>(`${BASE}/stock-items/${id}/entry`, { method: 'POST', body: JSON.stringify({ quantity }) }),
    stockExit: (id: string, quantity: number) =>
      req<StockItemDto>(`${BASE}/stock-items/${id}/exit`, { method: 'POST', body: JSON.stringify({ quantity }) }),
    movements: () =>
      req<{ id: string; item_id: string; item_name: string | null; type: string; quantity: number; unit: string; moved_at: string }[]>(
        `${BASE}/stock-movements`,
      ),
  },
  stockActivityLog: {
    list: () =>
      req<
        {
          id: string
          entity_type: 'product' | 'stock_item'
          entity_id: string
          entity_name: string
          event_type: 'created' | 'updated' | 'deleted' | 'stock_updated' | 'low_stock' | 'out_of_stock'
          created_at: string
        }[]
      >(`${BASE}/stock-activity-log`),
  },
  errorLog: {
    list: () =>
      req<
        {
          id: string
          source: 'middleware' | 'api' | 'client' | 'webhook'
          level: 'error' | 'warn'
          message: string
          route: string | null
          resolved: boolean
          created_at: string
        }[]
      >(`${BASE}/error-log`),
    report: (input: { message: string; route?: string }) =>
      req<void>(`${BASE}/error-log`, { method: 'POST', body: JSON.stringify(input) }),
    resolve: (id: string) => req<void>(`${BASE}/error-log/${id}/resolve`, { method: 'POST' }),
  },
  pdv: {
    createSale: () =>
      req<{ id: string; status: string; total_value: number }>(`${BASE}/pdv/sales`, { method: 'POST' }),
    getSale: (id: string) => req<PdvSaleDetail>(`${BASE}/pdv/sales/${id}`),
    addItem: (
      saleId: string,
      input: {
        item_type: string
        product_id?: string
        service_id?: string
        label?: string
        quantity: number
        unit_price?: number
        scheduled_at?: string
      },
    ) => req<PdvSaleDetail>(`${BASE}/pdv/sales/${saleId}/items`, { method: 'POST', body: JSON.stringify(input) }),
    addPayment: (
      saleId: string,
      input: { method: string; amount: number; installments?: number; change_amount?: number; mp_payment_id?: string },
    ) => req<PdvSaleDetail>(`${BASE}/pdv/sales/${saleId}/payments`, { method: 'POST', body: JSON.stringify(input) }),
    confirmPayment: (saleId: string, paymentId: string) =>
      req<PdvSaleDetail>(`${BASE}/pdv/sales/${saleId}/payments/${paymentId}/confirm`, { method: 'POST' }),
    cancelSale: (saleId: string) => req<void>(`${BASE}/pdv/sales/${saleId}`, { method: 'DELETE' }),
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
  mercadoPagoStatus: () => req<{ connected: boolean; credenciais_mask: string | null }>(`${BASE}/mercadopago-status`),
  shippingSettings: {
    get: async () => {
      const row = await req<{
        price_per_km: number
        minutes_per_km: number
        store_lat: number | null
        store_lng: number | null
        store_address: string | null
        max_km: number | null
        cobrar_coleta: boolean
        cobrar_entrega: boolean
      }>(`${BASE}/shipping-settings`)
      return { ...row, store_address: row.store_address ?? '' }
    },
    update: (input: {
      price_per_km: number
      minutes_per_km: number
      store_lat: number | null
      store_lng: number | null
      store_address: string
      max_km: number | null
      cobrar_coleta: boolean
      cobrar_entrega: boolean
    }) => req(`${BASE}/shipping-settings`, { method: 'PUT', body: JSON.stringify(input) }),
  },
  driverLocation: {
    get: () => req<{ lat: number; lng: number; updated_at: string | null; is_live: boolean } | null>(`${BASE}/driver-location`),
    update: (lat: number, lng: number) =>
      req<void>(`${BASE}/driver-location`, { method: 'PUT', body: JSON.stringify({ lat, lng }) }),
  },
  templates: {
    list: () => req<EletronicaTemplate[]>(`${BASE}/templates`),
    updateContent: (key: string, content: string) =>
      req<EletronicaTemplate>(`${BASE}/templates/${key}`, { method: 'PUT', body: JSON.stringify({ content }) }),
    toggle: (key: string, enabled: boolean) =>
      req<EletronicaTemplate>(`${BASE}/templates/${key}/toggle`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  },
}

export type EletronicaTemplate = {
  id: string
  template_key: string
  section: string
  label: string
  description: string | null
  content: string
  required_variables: string[]
  available_variables: string[]
  editable: boolean
  enabled: boolean
  sort_order: number
}
