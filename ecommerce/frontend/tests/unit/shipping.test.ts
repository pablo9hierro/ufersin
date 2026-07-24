import { describe, expect, it } from 'vitest'
import { distanciaKm } from '../../src/lib/geo/rotas'
import { estimateShippingLocal } from '../../src/lib/localData'
import { FALLBACK as STORE_LOCATION } from '../../src/lib/geo/mapa'

describe('distanciaKm (Haversine)', () => {
  it('distância de um ponto pra ele mesmo é zero', () => {
    expect(distanciaKm(STORE_LOCATION, STORE_LOCATION)).toBeCloseTo(0, 6)
  })

  it('é simétrica (a->b === b->a)', () => {
    const destino = { lat: STORE_LOCATION.lat + 0.05, lng: STORE_LOCATION.lng - 0.03 }
    expect(distanciaKm(STORE_LOCATION, destino)).toBeCloseTo(distanciaKm(destino, STORE_LOCATION), 9)
  })

  it('cresce com a distância angular (ponto mais longe = km maior)', () => {
    const perto = { lat: STORE_LOCATION.lat + 0.01, lng: STORE_LOCATION.lng }
    const longe = { lat: STORE_LOCATION.lat + 0.1, lng: STORE_LOCATION.lng }
    expect(distanciaKm(STORE_LOCATION, longe)).toBeGreaterThan(distanciaKm(STORE_LOCATION, perto))
  })
})

describe('estimateShippingLocal', () => {
  it('calcula km e preço proporcional ao pricePerKm', () => {
    const destino = { lat: STORE_LOCATION.lat + 0.1, lng: STORE_LOCATION.lng }
    const est = estimateShippingLocal(destino.lat, destino.lng, 2, null)
    expect(est.km).toBeGreaterThan(0)
    expect(est.price).toBeCloseTo(est.km * 2, 1)
  })

  it('within_range é sempre true quando maxKm é null (sem limite)', () => {
    const est = estimateShippingLocal(STORE_LOCATION.lat + 5, STORE_LOCATION.lng + 5, 1, null)
    expect(est.within_range).toBe(true)
  })

  it('within_range fica false quando a distância excede maxKm', () => {
    const est = estimateShippingLocal(STORE_LOCATION.lat + 5, STORE_LOCATION.lng + 5, 1, 10)
    expect(est.km).toBeGreaterThan(10)
    expect(est.within_range).toBe(false)
  })

  it('within_range fica true quando a distância está dentro do maxKm', () => {
    const est = estimateShippingLocal(STORE_LOCATION.lat, STORE_LOCATION.lng, 1, 10)
    expect(est.within_range).toBe(true)
  })

  it('distância zero (endereço = loja) resulta em frete zero', () => {
    const est = estimateShippingLocal(STORE_LOCATION.lat, STORE_LOCATION.lng, 3, null)
    expect(est.km).toBe(0)
    expect(est.price).toBe(0)
  })
})
