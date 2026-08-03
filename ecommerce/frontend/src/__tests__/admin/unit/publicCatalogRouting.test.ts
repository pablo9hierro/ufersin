import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveTenantSlug = vi.fn(() => '')

vi.mock('../../../lib/demoMode', () => ({
  isDemoModeActive: () => false,
}))

vi.mock('../../../lib/tenantConfig', () => ({
  resolveTenantSlug: () => resolveTenantSlug(),
}))

const supabaseList = vi.fn(async () => [
  {
    id: 'sb-p',
    name: 'Supabase Product',
    description: null,
    price: 1,
    quantity: 1,
    image_url: null,
    category_id: null,
  },
])

function stubApiTree(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'products') {
          return {
            list: supabaseList,
            get: vi.fn(),
            salesCounts: vi.fn(async () => []),
          }
        }
        if (prop === 'categories') {
          return { list: vi.fn(async () => []) }
        }
        return stubApiTree()
      },
    },
  )
}

vi.mock('../../../lib/supabasePublicApi', () => ({
  supabasePublicApi: stubApiTree(),
}))

vi.mock('../../../store/adminAuth', () => ({
  useAdminAuth: { getState: () => ({ token: null, logout: vi.fn() }) },
}))
vi.mock('../../../store/vendedorAuth', () => ({
  useVendedorAuth: { getState: () => ({ token: null }) },
}))
vi.mock('../../../store/motoboyAuth', () => ({
  useMotoboyAuth: { getState: () => ({ token: null }) },
}))
vi.mock('../../../lib/supabaseClient', () => ({
  supabase: { rpc: vi.fn() },
}))
vi.mock('../../../lib/localApi', () => ({
  localApi: stubApiTree(),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('public catalog tenant routing', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    supabaseList.mockClear()
    resolveTenantSlug.mockReset()
    vi.resetModules()
  })

  it('with tenant slug hits Railway public catalog, not Supabase', async () => {
    resolveTenantSlug.mockReturnValue('loja-teste')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'rw-1',
          name: 'Railway Product',
          description: null,
          price: 10,
          quantity: 1,
          image_url: null,
          category_id: null,
          active: true,
        },
      ],
    })

    const { api } = await import('../../../lib/api')
    const products = await api.products.list()

    expect(products).toHaveLength(1)
    expect(products[0].id).toBe('rw-1')
    expect(fetchMock).toHaveBeenCalled()
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/public/catalog/loja-teste/products')
    expect(supabaseList).not.toHaveBeenCalled()
  })

  it('without tenant slug falls back to Supabase public API', async () => {
    resolveTenantSlug.mockReturnValue('')
    const { api } = await import('../../../lib/api')
    const products = await api.products.list()
    expect(products[0].id).toBe('sb-p')
    expect(supabaseList).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
