import { beforeEach, describe, expect, it } from 'vitest'
import { useCart } from '../../src/store/cart'
import type { Product } from '../../src/lib/types'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    category_id: 'c1',
    name: 'Produto Teste',
    description: '',
    price: 20,
    quantity: 5,
    image_url: null,
    active: true,
    ...overrides,
  }
}

describe('useCart', () => {
  beforeEach(() => {
    localStorage.clear()
    useCart.setState({ items: [] })
  })

  it('adiciona um produto novo com quantidade 1', () => {
    useCart.getState().addItem(product({ id: 'p1' }))
    expect(useCart.getState().items).toEqual([{ productId: 'p1', quantity: 1 }])
  })

  it('adicionar o mesmo produto de novo incrementa a quantidade', () => {
    useCart.getState().addItem(product({ id: 'p1', quantity: 5 }))
    useCart.getState().addItem(product({ id: 'p1', quantity: 5 }))
    expect(useCart.getState().items).toEqual([{ productId: 'p1', quantity: 2 }])
  })

  it('não ultrapassa o estoque do produto (quantity) ao adicionar repetidamente', () => {
    const p = product({ id: 'p1', quantity: 2 })
    useCart.getState().addItem(p)
    useCart.getState().addItem(p)
    useCart.getState().addItem(p) // tenta passar de 2
    expect(useCart.getState().items).toEqual([{ productId: 'p1', quantity: 2 }])
  })

  it('changeQty soma/subtrai respeitando o teto (max) e o piso 0', () => {
    useCart.getState().addItem(product({ id: 'p1', quantity: 10 }))
    useCart.getState().changeQty('p1', 3, 10)
    expect(useCart.getState().items[0].quantity).toBe(4)

    useCart.getState().changeQty('p1', 100, 10) // estoura o max
    expect(useCart.getState().items[0].quantity).toBe(10)
  })

  it('changeQty até zero remove o item do carrinho', () => {
    useCart.getState().addItem(product({ id: 'p1', quantity: 10 }))
    useCart.getState().changeQty('p1', -1)
    expect(useCart.getState().items).toHaveLength(0)
  })

  it('removeItem tira só o item indicado, mantendo os outros', () => {
    useCart.getState().addItem(product({ id: 'p1', quantity: 10 }))
    useCart.getState().addItem(product({ id: 'p2', quantity: 10 }))
    useCart.getState().removeItem('p1')
    expect(useCart.getState().items).toEqual([{ productId: 'p2', quantity: 1 }])
  })

  it('clear esvazia o carrinho inteiro', () => {
    useCart.getState().addItem(product({ id: 'p1', quantity: 10 }))
    useCart.getState().addItem(product({ id: 'p2', quantity: 10 }))
    useCart.getState().clear()
    expect(useCart.getState().items).toEqual([])
  })
})
