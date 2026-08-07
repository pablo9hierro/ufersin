import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Copy, ExternalLink, Loader2, Smartphone, X } from 'lucide-react'
import { cardPaymentService } from '../../services/cardPaymentService'
import { MP_CARD_FORM_IDS, useCardTokenization } from '../../hooks/useCardTokenization'
import type { Order } from '../../types'
import { ApiError } from '../../lib/api'

type Step = 'choose' | 'link' | 'transparente' | 'nfc'

/** Cartão de verdade via Mercado Pago — 3 formas, sempre a mesma conta do
 * tenant que já processa Pix. Um componente só, reaproveitado nos 4 skins
 * do checkout e no PDV (props de classe deixam cada um se estilizar; a
 * lógica é idêntica em todo lugar).
 *
 * - `mode="checkout"` (cliente comprando sozinho, em casa): só Link e
 *   Checkout Transparente fazem sentido — não existe maquininha aqui.
 * - `mode="pdv"` (lojista com o cliente na frente): também oferece NFC
 *   (confirmação manual — o lojista passa o cartão na maquininha DELE,
 *   fora do nosso sistema) e manda link/transparente por WhatsApp pro
 *   celular do CLIENTE, nunca no dispositivo do lojista. */
export default function CardPaymentDialog({
  orderId,
  amount,
  mode,
  customerWhatsapp,
  initialStep = 'choose',
  onClose,
  onSuccess,
  onConfirmNfc,
  surfaceClassName = 'bg-neutral-900 border border-white/10',
  accentClassName = 'bg-white text-black',
  textClassName = 'text-white',
  dimTextClassName = 'text-white/60',
  inputClassName = 'bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/40',
}: {
  orderId: string
  amount: number
  mode: 'checkout' | 'pdv'
  customerWhatsapp?: string
  /** PDV já sabe a forma escolhida ANTES de existir pedido (cria a venda
   * com o `card_payment_mode` certo primeiro) — pula direto pro passo,
   * sem mostrar a escolha de novo. Checkout público sempre usa 'choose'. */
  initialStep?: Step
  onClose: () => void
  onSuccess: (order: Order) => void
  /** NFC nunca fala com a Mercado Pago (o cartão foi cobrado na maquininha
   * física do lojista, fora do nosso sistema) — quem chama decide COMO
   * marcar o pedido como pago (reaproveita o mesmo mecanismo já usado pra
   * confirmar pagamento em dinheiro no PDV). Só usado quando `mode="pdv"`. */
  onConfirmNfc?: () => Promise<void>
  surfaceClassName?: string
  accentClassName?: string
  textClassName?: string
  dimTextClassName?: string
  inputClassName?: string
}) {
  const [step, setStep] = useState<Step>(initialStep)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [loadingKey, setLoadingKey] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [holderName, setHolderName] = useState('')
  const [holderDoc, setHolderDoc] = useState('')
  const [holderEmail, setHolderEmail] = useState('')

  useEffect(() => {
    let cancelled = false
    cardPaymentService
      .getPublicKey()
      .then((key) => {
        if (!cancelled) setPublicKey(key)
      })
      .finally(() => {
        if (!cancelled) setLoadingKey(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { ready: formReady, loadError: sdkError, tokenize } = useCardTokenization(
    step === 'transparente' ? publicKey : null,
    amount,
  )

  // PDV já decidiu o modo antes de abrir (initialStep) — gera o link na
  // hora, sem esperar clique num botão "escolher" que nem chega a aparecer.
  useEffect(() => {
    if (initialStep === 'link' && !linkUrl) {
      void handlePickLink()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePickLink = async () => {
    setError(null)
    setBusy(true)
    try {
      const order = await cardPaymentService.createLink(orderId)
      setLinkUrl(order.card_payment_link_url ?? null)
      setStep('link')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível gerar o link de pagamento.')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyLink = async () => {
    if (!linkUrl) return
    try {
      await navigator.clipboard.writeText(linkUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard indisponível (http local, permissão) — o link já está visível pra copiar manualmente */
    }
  }

  const handleWhatsappShare = () => {
    if (!linkUrl || !customerWhatsapp) return
    const digits = customerWhatsapp.replace(/\D/g, '')
    const text = encodeURIComponent(`Aqui está o link pra pagar seu pedido no cartão: ${linkUrl}`)
    window.open(`https://api.whatsapp.com/send/?phone=${digits}&text=${text}`, '_blank', 'noreferrer')
  }

  const handleTransparenteSubmit = async () => {
    setError(null)
    setBusy(true)
    try {
      const { cardToken, paymentMethodId, installments } = await tokenize()
      const order = await cardPaymentService.charge(orderId, {
        card_token: cardToken,
        payment_method_id: paymentMethodId,
        installments,
        payer_email: holderEmail.trim() || undefined,
      })
      onSuccess(order)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Não foi possível processar o cartão.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={`w-full max-w-sm rounded-2xl p-5 max-h-[85vh] overflow-y-auto ${surfaceClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className={`font-bold text-sm ${textClassName}`}>Pagamento com cartão</h2>
          <button type="button" onClick={onClose} className={dimTextClassName}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        {step === 'choose' && (
          <div className="space-y-2.5">
            {mode === 'pdv' && (
              <button
                type="button"
                onClick={() => setStep('nfc')}
                className={`w-full text-left rounded-xl px-4 py-3 text-sm font-semibold ${accentClassName}`}
              >
                Aproximar / inserir na maquininha
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={handlePickLink}
              className={`w-full text-left rounded-xl px-4 py-3 text-sm font-semibold border border-white/15 ${textClassName} disabled:opacity-60`}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
              Link de pagamento
            </button>
            {loadingKey ? (
              <div className={`text-xs ${dimTextClassName} px-1`}>Verificando cartão tokenizado…</div>
            ) : publicKey ? (
              <button
                type="button"
                onClick={() => setStep('transparente')}
                className={`w-full text-left rounded-xl px-4 py-3 text-sm font-semibold border border-white/15 ${textClassName}`}
              >
                Conectar seu cartão aqui
              </button>
            ) : null}
          </div>
        )}

        {step === 'nfc' && (
          <div className="space-y-4 text-center py-2">
            <Smartphone className={`w-10 h-10 mx-auto ${dimTextClassName}`} />
            <p className={`text-sm ${textClassName}`}>
              Passe o cartão na maquininha. Depois de confirmado o pagamento por lá, clique abaixo.
            </p>
            <button
              type="button"
              disabled={busy || !onConfirmNfc}
              onClick={async () => {
                if (!onConfirmNfc) return
                setBusy(true)
                setError(null)
                try {
                  await onConfirmNfc()
                  onClose()
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : 'Não foi possível confirmar o pagamento.')
                } finally {
                  setBusy(false)
                }
              }}
              className={`w-full rounded-xl px-4 py-3 text-sm font-semibold ${accentClassName} disabled:opacity-60`}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : <CheckCircle2 className="w-4 h-4 inline mr-2" />}
              Pagamento confirmado na maquininha
            </button>
          </div>
        )}

        {step === 'link' && (
          <div className="space-y-3">
            {linkUrl ? (
              <>
                <p className={`text-xs ${dimTextClassName}`}>
                  {mode === 'pdv'
                    ? 'Manda esse link pro celular do cliente completar — nunca no seu dispositivo.'
                    : 'Abra o link abaixo pra pagar com cartão.'}
                </p>
                <div className={`text-xs break-all rounded-lg px-3 py-2 ${inputClassName}`}>{linkUrl}</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className={`flex-1 rounded-xl px-3 py-2.5 text-xs font-semibold border border-white/15 ${textClassName} inline-flex items-center justify-center gap-1.5`}
                  >
                    <Copy className="w-3.5 h-3.5" /> {copied ? 'Copiado!' : 'Copiar'}
                  </button>
                  <a
                    href={linkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`flex-1 rounded-xl px-3 py-2.5 text-xs font-semibold inline-flex items-center justify-center gap-1.5 ${accentClassName}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Abrir
                  </a>
                </div>
                {mode === 'pdv' && customerWhatsapp && (
                  <button
                    type="button"
                    onClick={handleWhatsappShare}
                    className={`w-full rounded-xl px-3 py-2.5 text-xs font-semibold border border-white/15 ${textClassName}`}
                  >
                    Mandar por WhatsApp
                  </button>
                )}
                <p className={`text-[11px] ${dimTextClassName}`}>
                  Assim que o pagamento for confirmado, o pedido atualiza sozinho.
                </p>
              </>
            ) : (
              <Loader2 className={`w-5 h-5 animate-spin mx-auto ${dimTextClassName}`} />
            )}
          </div>
        )}

        {step === 'transparente' && (
          <div className="space-y-3">
            {sdkError && <p className="text-xs text-red-400">{sdkError}</p>}
            <form
              id={MP_CARD_FORM_IDS.form}
              onSubmit={(e) => {
                e.preventDefault()
                void handleTransparenteSubmit()
              }}
              className="space-y-2.5"
            >
              <div id={MP_CARD_FORM_IDS.cardNumber} className={`h-10 rounded-lg px-3 flex items-center ${inputClassName}`} />
              <div className="flex gap-2.5">
                <div id={MP_CARD_FORM_IDS.expirationDate} className={`h-10 flex-1 rounded-lg px-3 flex items-center ${inputClassName}`} />
                <div id={MP_CARD_FORM_IDS.securityCode} className={`h-10 w-24 rounded-lg px-3 flex items-center ${inputClassName}`} />
              </div>
              <input
                id={MP_CARD_FORM_IDS.cardholderName}
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                placeholder="Nome impresso no cartão"
                className={`w-full h-10 ${inputClassName}`}
              />
              <div className="flex gap-2.5">
                <select id={MP_CARD_FORM_IDS.identificationType} className={`h-10 rounded-lg px-2 text-sm ${inputClassName}`} />
                <input
                  id={MP_CARD_FORM_IDS.identificationNumber}
                  value={holderDoc}
                  onChange={(e) => setHolderDoc(e.target.value)}
                  placeholder="CPF do titular"
                  className={`flex-1 h-10 ${inputClassName}`}
                />
              </div>
              <input
                id={MP_CARD_FORM_IDS.cardholderEmail}
                value={holderEmail}
                onChange={(e) => setHolderEmail(e.target.value)}
                placeholder="E-mail"
                type="email"
                className={`w-full h-10 ${inputClassName}`}
              />
              <select id={MP_CARD_FORM_IDS.issuer} className={`w-full h-10 rounded-lg px-2 text-sm ${inputClassName}`} />
              <select id={MP_CARD_FORM_IDS.installments} className={`w-full h-10 rounded-lg px-2 text-sm ${inputClassName}`} />

              <button
                type="submit"
                disabled={!formReady || busy}
                className={`w-full rounded-xl px-4 py-3 text-sm font-semibold ${accentClassName} disabled:opacity-60`}
              >
                {busy || !formReady ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                {formReady ? 'Pagar com cartão' : 'Carregando formulário…'}
              </button>
            </form>
          </div>
        )}

        {step !== 'choose' && (
          <button
            type="button"
            onClick={() => {
              setStep('choose')
              setError(null)
            }}
            className={`mt-3 text-xs ${dimTextClassName} hover:underline`}
          >
            ← Escolher outra forma
          </button>
        )}
      </motion.div>
    </motion.div>
  )
}
