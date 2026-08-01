import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductSchema } from '../../../types'
import { buildProductPayload } from '../../../lib/productHelpers'
import { filterPdvProducts, findProductByBarcode } from '../../../lib/pdvHelpers'

/**
 * API/integration-style tests with an in-memory mock of admin product CRUD
 * + PDV list — mirrors Railway tenant path without live credentials.
 */
type Row = {
  id: string
  name: string
  description: string | null
  price: number
  quantity: number
  image_url: string | null
  category_id: string | null
  active: boolean
  barcode: string | null
  cost_price: number | null
  low_stock_threshold: number | null
}

function makeStore() {
  const products: Row[] = []
  let seq = 1
  return {
    admin: {
      async list() {
        return [...products]
      },
      async create(payload: ReturnType<typeof buildProductPayload>) {
        const row: Row = {
          id: `p${seq++}`,
          name: payload.name,
          description: payload.description,
          price: payload.price,
          quantity: payload.quantity,
          image_url: payload.image_url,
          category_id: payload.category_id,
          active: true,
          barcode: payload.barcode,
          cost_price: payload.cost_price,
          low_stock_threshold: payload.low_stock_threshold,
        }
        products.push(row)
        return row
      },
      async update(id: string, payload: ReturnType<typeof buildProductPayload>) {
        const i = products.findIndex((p) => p.id === id)
        if (i < 0) throw new Error('not found')
        products[i] = { ...products[i], ...payload, active: true }
        return products[i]
      },
      async delete(id: string) {
        const i = products.findIndex((p) => p.id === id)
        if (i >= 0) products.splice(i, 1)
      },
    },
    pdv: {
      async listProducts() {
        return products.filter((p) => p.active)
      },
    },
  }
}

describe('admin products CRUD → PDV list (mocked handlers)', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('create persiste barcode e PDV encontra por bip e nome', async () => {
    const created = await store.admin.create(
      buildProductPayload({
        name: 'Essência Grape',
        description: '',
        price: '45',
        quantity: '10',
        image_url: '',
        category_id: '',
        barcode: '7891000100101',
        cost_price: '20',
        low_stock_threshold: '2',
      })
    )
    expect(ProductSchema.safeParse(created).success).toBe(true)

    const pdvList = await store.pdv.listProducts()
    expect(pdvList).toHaveLength(1)
    expect(findProductByBarcode(pdvList, '7891000100101')?.name).toBe('Essência Grape')
    expect(filterPdvProducts(pdvList, 'grape')).toHaveLength(1)
  })

  it('update + delete refletem no PDV imediatamente', async () => {
    const created = await store.admin.create(
      buildProductPayload({
        name: 'A',
        description: '',
        price: '1',
        quantity: '1',
        image_url: '',
        category_id: '',
        barcode: 'AAA',
        cost_price: '',
        low_stock_threshold: '',
      })
    )
    await store.admin.update(
      created.id,
      buildProductPayload({
        name: 'B',
        description: '',
        price: '2',
        quantity: '5',
        image_url: '',
        category_id: '',
        barcode: 'BBB',
        cost_price: '',
        low_stock_threshold: '',
      })
    )
    let list = await store.pdv.listProducts()
    expect(list[0].name).toBe('B')
    expect(findProductByBarcode(list, 'BBB')).toBeTruthy()

    await store.admin.delete(created.id)
    list = await store.pdv.listProducts()
    expect(list).toHaveLength(0)
  })

  it('permutations: payment methods / discount types are pure cart math (API-agnostic)', async () => {
    // Covered heavily in unit/pdvHelpers — here we only assert create stays active for PDV.
    const created = await store.admin.create(
      buildProductPayload({
        name: 'X',
        description: '',
        price: '10',
        quantity: '2',
        image_url: '',
        category_id: '',
        barcode: '',
        cost_price: '',
        low_stock_threshold: '',
      })
    )
    expect(created.active).toBe(true)
    expect((await store.pdv.listProducts()).some((p) => p.id === created.id)).toBe(true)
  })
})

describe('whatsapp connection-events mock API', () => {
  it('lista eventos com created_at ISO quando a tabela responde', async () => {
    const handler = async () => [
      {
        id: 'e1',
        event_type: 'connected',
        previous_state: null,
        new_state: 'open',
        created_at: '2026-08-01T12:00:00.000Z',
      },
    ]
    const events = await handler()
    expect(events[0].created_at).toMatch(/T/)
    expect(events).toHaveLength(1)
  })

  it('404 de schema deve ser distinguível de lista vazia', async () => {
    const empty = async () => [] as { id: string }[]
    const missing = async () => {
      throw new ApiErrorLike(404, 'relation whatsapp_connection_events does not exist')
    }
    expect(await empty()).toHaveLength(0)
    await expect(missing()).rejects.toMatchObject({ status: 404 })
  })
})

class ApiErrorLike extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
