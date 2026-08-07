import { useCallback, useEffect, useRef, useState } from 'react'

// Tipagem mínima do SDK oficial da Mercado Pago (https://sdk.mercadopago.com/js/v2)
// — não existe @types pra ele, então só o que este hook realmente usa.
interface MpCardFormData {
  token: string
  paymentMethodId: string
  installments: string
}
interface MpCardForm {
  getCardFormData: () => MpCardFormData
  unmount: () => void
}
interface MpCardFormFieldConfig {
  id: string
  placeholder?: string
}
interface MpCardFormOptions {
  amount: string
  iframe: boolean
  form: {
    id: string
    cardNumber: MpCardFormFieldConfig
    expirationDate: MpCardFormFieldConfig
    securityCode: MpCardFormFieldConfig
    cardholderName: MpCardFormFieldConfig
    issuer: MpCardFormFieldConfig
    installments: MpCardFormFieldConfig
    identificationType: MpCardFormFieldConfig
    identificationNumber: MpCardFormFieldConfig
    cardholderEmail: MpCardFormFieldConfig
  }
  callbacks: {
    onFormMounted?: (error?: unknown) => void
    onSubmit?: (event: Event) => void
    onError?: (error: unknown) => void
  }
}
interface MpInstance {
  cardForm: (opts: MpCardFormOptions) => MpCardForm
}
declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, opts?: { locale?: string }) => MpInstance
  }
}

const SDK_URL = 'https://sdk.mercadopago.com/js/v2'
/** Ids fixos dos campos — CardPaymentDialog precisa montar exatamente
 * esses elementos no DOM antes deste hook rodar (o SDK substitui cada um
 * por um iframe de Secure Fields; PAN/CVV nunca tocam nosso código). */
export const MP_CARD_FORM_IDS = {
  form: 'mp-card-form',
  cardNumber: 'mp-card-number',
  expirationDate: 'mp-card-expiration',
  securityCode: 'mp-card-cvv',
  cardholderName: 'mp-card-holder-name',
  issuer: 'mp-card-issuer',
  installments: 'mp-card-installments',
  identificationType: 'mp-card-doc-type',
  identificationNumber: 'mp-card-doc-number',
  cardholderEmail: 'mp-card-email',
} as const

let sdkLoadPromise: Promise<void> | null = null
function loadMercadoPagoSdk(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve()
  if (sdkLoadPromise) return sdkLoadPromise
  sdkLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('sdk load failed'))
    document.head.appendChild(script)
  })
  return sdkLoadPromise
}

export interface CardTokenResult {
  cardToken: string
  paymentMethodId: string
  installments: number
}

/** Tokeniza o cartão no navegador via SDK oficial da Mercado Pago (Secure
 * Fields) — PAN/CVV nunca passam pelo nosso backend, só o `cardToken`
 * resultante (ver ecommerce/backend/src/mercadopago_link.rs). Monta os
 * campos dentro dos elementos `MP_CARD_FORM_IDS` (o componente que usa
 * este hook precisa renderizá-los antes/junto). */
export function useCardTokenization(publicKey: string | null, amount: number) {
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const cardFormRef = useRef<MpCardForm | null>(null)
  const pendingRef = useRef<{
    resolve: (r: CardTokenResult) => void
    reject: (e: Error) => void
  } | null>(null)

  useEffect(() => {
    if (!publicKey || amount <= 0) return
    let cancelled = false
    setReady(false)
    setLoadError(null)

    loadMercadoPagoSdk()
      .then(() => {
        if (cancelled || !window.MercadoPago) return
        const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' })
        const cardForm = mp.cardForm({
          amount: amount.toFixed(2),
          iframe: true,
          form: {
            id: MP_CARD_FORM_IDS.form,
            cardNumber: { id: MP_CARD_FORM_IDS.cardNumber, placeholder: 'Número do cartão' },
            expirationDate: { id: MP_CARD_FORM_IDS.expirationDate, placeholder: 'MM/AA' },
            securityCode: { id: MP_CARD_FORM_IDS.securityCode, placeholder: 'CVV' },
            cardholderName: { id: MP_CARD_FORM_IDS.cardholderName, placeholder: 'Nome impresso no cartão' },
            issuer: { id: MP_CARD_FORM_IDS.issuer },
            installments: { id: MP_CARD_FORM_IDS.installments },
            identificationType: { id: MP_CARD_FORM_IDS.identificationType },
            identificationNumber: { id: MP_CARD_FORM_IDS.identificationNumber, placeholder: 'CPF do titular' },
            cardholderEmail: { id: MP_CARD_FORM_IDS.cardholderEmail, placeholder: 'E-mail' },
          },
          callbacks: {
            onFormMounted: (err) => {
              if (cancelled) return
              if (err) {
                setLoadError('Não foi possível carregar o formulário de cartão.')
                return
              }
              setReady(true)
            },
            onSubmit: (event) => {
              event.preventDefault()
              const pending = pendingRef.current
              pendingRef.current = null
              if (!pending) return
              const data = cardForm.getCardFormData()
              if (!data.token) {
                pending.reject(new Error('Não foi possível validar o cartão — confira os dados.'))
                return
              }
              pending.resolve({
                cardToken: data.token,
                paymentMethodId: data.paymentMethodId,
                installments: Number(data.installments) || 1,
              })
            },
            onError: () => {
              const pending = pendingRef.current
              pendingRef.current = null
              pending?.reject(new Error('Cartão inválido — confira número, validade e CVV.'))
            },
          },
        })
        cardFormRef.current = cardForm
      })
      .catch(() => {
        if (!cancelled) setLoadError('Não foi possível carregar o Mercado Pago. Verifique sua internet e tente de novo.')
      })

    return () => {
      cancelled = true
      cardFormRef.current?.unmount()
      cardFormRef.current = null
    }
  }, [publicKey, amount])

  /** Dispara a tokenização (submit do form montado pelo SDK) e resolve com
   * o token resultante — nunca com dados crus do cartão. */
  const tokenize = useCallback((): Promise<CardTokenResult> => {
    return new Promise((resolve, reject) => {
      if (!cardFormRef.current) {
        reject(new Error('Formulário de cartão ainda não carregou — aguarde um instante.'))
        return
      }
      pendingRef.current = { resolve, reject }
      const form = document.getElementById(MP_CARD_FORM_IDS.form)
      if (form instanceof HTMLFormElement) {
        form.requestSubmit()
      } else {
        pendingRef.current = null
        reject(new Error('Formulário de cartão não encontrado na página.'))
      }
    })
  }, [])

  return { ready, loadError, tokenize }
}
