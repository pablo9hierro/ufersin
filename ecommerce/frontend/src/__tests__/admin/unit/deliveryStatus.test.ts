import { describe, expect, it } from 'vitest'
import { ADMIN_DELIVERY_STATUS_LABEL, CUSTOMER_DELIVERY_STATUS_LABEL, labelDeliveryStatus } from '../../../lib/deliveryStatus'

describe('labelDeliveryStatus', () => {
  it('normaliza um status conhecido pro admin', () => {
    expect(labelDeliveryStatus(ADMIN_DELIVERY_STATUS_LABEL, 'en_route_to_dropoff')).toBe('A caminho do cliente')
  })

  it('normaliza um status conhecido pro cliente', () => {
    expect(labelDeliveryStatus(CUSTOMER_DELIVERY_STATUS_LABEL, 'picked_up')).toBe('Entregador coletou seu pedido')
  })

  it('cai pro status cru quando desconhecido, nunca quebra', () => {
    expect(labelDeliveryStatus(ADMIN_DELIVERY_STATUS_LABEL, 'algo_novo_da_uber')).toBe('algo_novo_da_uber')
  })
})
