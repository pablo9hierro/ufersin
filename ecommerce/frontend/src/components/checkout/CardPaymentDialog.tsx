import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Copy, ExternalLink, Loader2, Smartphone, X } from 'lucide-react'
import { cardPaymentService } from '../../services/cardPaymentService'
import { pdvService } from '../../services/pdvService'
import { MP_CARD_FORM_IDS, useCardTokenization } from '../../hooks/useCardTokenization'
import type { Order } from '../../types'
import { ApiError } from '../../lib/api'
import { withTenantSearch } from '../../lib/tenantConfig'

type Step = 'choose' | 'link' | 'transparente' | 'nfc' | 'auto-sent'

// Mesma máscara usada no resto do app (AdminPdv.tsx, AuthModal.tsx etc) —
// só o número nacional (DDD+número), nunca o "55" (esse é sempre implícito,
// adicionado só na hora de mandar pro backend).
function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

/** `order.customer_whatsapp` já vem gravado com "55" na frente — tira pra
 * exibir só o número nacional no campo (o "55" é sempre implícito aqui). */
function stripCountryCode(digits: string): string {
  return digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits
}

// O link de checkout transparente mandado pro WhatsApp do CLIENTE precisa
// ser um link de VERDADE, aberto no celular DELE — nunca `localhost`, nem
// quando o lojista está testando com o Resolutoo rodando local (o celular
// do cliente não tem como alcançar o localhost do computador do lojista).
// Mesmo padrão de `/loja` embutido sob resolutoo.com usado em produção
// (ver ecommerce/frontend/vite.config.ts `VITE_BASE_PATH` e
// .github/workflows/deploy-vercel.yml) — força esse domínio SEMPRE nesse
// link específico, independente de onde o admin está rodando agora.
export const PRODUCTION_CHECKOUT_ORIGIN = 'https://resolutoo.com/loja'

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
  onCancelOrder,
  autoSendWhatsapp,
  onChangePaymentMethod,
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
  /** Só usado quando `mode="pdv"` e já existe uma venda pendente criada
   * (steps 'link'/'transparente') — desiste da cobrança online cancelando
   * a venda de verdade (repõe estoque), em vez de só fechar o diálogo e
   * deixar uma venda pendente fantasma presa no PDV. */
  onCancelOrder?: () => Promise<void>
  /** Loja com "entrega só com pagamento já feito" — cartão em pedido de
   * entrega não deixa o cliente escolher link/transparente na tela: manda
   * as duas cobranças direto pro WhatsApp DELE (já logado, já tem
   * WhatsApp cadastrado) e mostra "aguardando pagamento" com "gerar nova
   * cobrança"/"cancelar"/"alterar forma de pagamento". Só usado quando
   * `mode="checkout"`. */
  autoSendWhatsapp?: string
  /** "Alterar método de pagamento" na tela de aguardando — só existe
   * junto de `autoSendWhatsapp`. */
  onChangePaymentMethod?: () => void
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
  // PDV manda o link pro WhatsApp do CLIENTE — nunca abre/copia no
  // dispositivo do lojista. Pré-preenchido com o whatsapp já digitado na
  // venda, mas editável (nem toda venda de balcão tem isso preenchido).
  const [waInput, setWaInput] = useState(
    formatPhone(stripCountryCode((customerWhatsapp ?? '').replace(/\D/g, ''))),
  )
  const [waSent, setWaSent] = useState(false)
  const [autoSending, setAutoSending] = useState(false)

  const sendAutoCharge = async () => {
    if (!autoSendWhatsapp) return
    setError(null)
    setAutoSending(true)
    try {
      const withLink = await cardPaymentService.createLink(orderId)
      const link = withLink.card_payment_link_url
      if (!link) throw new ApiError(502, 'Não foi possível gerar o link de cobrança.')
      const checkoutUrl = `${PRODUCTION_CHECKOUT_ORIGIN}/pagamento/${orderId}${withTenantSearch()}`
      await pdvService.notifyCardCharge(orderId, autoSendWhatsapp, link, checkoutUrl)
      setStep('auto-sent')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar a cobrança pro seu WhatsApp.')
    } finally {
      setAutoSending(false)
    }
  }

  // Loja com "entrega só com pagamento já feito" + cartão: nunca mostra a
  // escolha link/transparente pro cliente — manda as duas cobranças pro
  // WhatsApp dele automaticamente assim que o diálogo abre.
  useEffect(() => {
    if (autoSendWhatsapp) void sendAutoCharge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // No PDV é o CLIENTE quem digita o cartão dele, nunca o lojista — então
  // "Conectar seu cartão aqui" no PDV também vira um link mandado pro
  // celular do cliente (a página /pagamento/:orderId já sabe renderizar o
  // formulário de cartão tokenizado quando abre lá, em mode="checkout").
  // Só no checkout público (mode="checkout") o step 'transparente' abre o
  // formulário embutido de verdade, porque aí é o próprio cliente na tela.
  const pdvTransparenteAsLink = mode === 'pdv' && step === 'transparente'
  const showLinkUi = step === 'link' || pdvTransparenteAsLink

  // Só ativa o SDK/hook quando o formulário embutido (MP_CARD_FORM_IDS)
  // realmente vai pro DOM — no PDV o passo 'transparente' NUNCA renderiza
  // esses elementos (vira link, ver showLinkUi acima). Passar a publicKey
  // mesmo assim fazia o SDK tentar montar iframes em ids inexistentes e
  // estourar uma exceção não tratada assim que o script (carregado async)
  // terminava — derrubando a árvore inteira do React (tela em branco).
  const { ready: formReady, loadError: sdkError, tokenize } = useCardTokenization(
    step === 'transparente' && !pdvTransparenteAsLink ? publicKey : null,
    amount,
  )

  // PDV já decidiu o modo antes de abrir (initialStep) — gera o link/URL na
  // hora, sem esperar clique num botão "escolher" que nem chega a aparecer.
  useEffect(() => {
    if (initialStep === 'link' && !linkUrl) {
      void handlePickLink()
    } else if (initialStep === 'transparente' && mode === 'pdv' && !linkUrl) {
      setLinkUrl(`${PRODUCTION_CHECKOUT_ORIGIN}/pagamento/${orderId}${withTenantSearch()}`)
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

  const handleWhatsappShare = async () => {
    if (!linkUrl) return
    // `waInput` só guarda o número NACIONAL (o "55" é sempre implícito,
    // aplicado só aqui na hora de mandar) — ver `formatPhone`/`stripCountryCode`
    // acima. Prefixar "55" sem checar isso foi o bug que gerava número
    // duplicado (5555839...) e a Evolution API rejeitava com 400.
    const national = waInput.replace(/\D/g, '')
    if (national.length < 10) return
    setError(null)
    setBusy(true)
    try {
      // Manda pela instância Evolution API da PRÓPRIA loja (mesmo mecanismo
      // que já manda "obrigado pela compra"/Pix) — nunca abre WhatsApp no
      // aparelho do lojista pra ele mesmo clicar "enviar" (era o bug).
      await pdvService.notifyCardCharge(orderId, `55${national}`, linkUrl)
      setWaSent(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar o link pelo WhatsApp da loja.')
    } finally {
      setBusy(false)
    }
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

        {autoSendWhatsapp && step === 'choose' && (
          <div className="py-6 flex justify-center">
            <Loader2 className={`w-6 h-6 animate-spin ${dimTextClassName}`} />
          </div>
        )}

        {!autoSendWhatsapp && step === 'choose' && (
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

        {step === 'auto-sent' && (
          <div className="space-y-4 text-center py-2">
            <Loader2 className={`w-8 h-8 mx-auto animate-spin ${dimTextClassName}`} />
            <p className={`text-sm ${textClassName}`}>Aguardando pagamento…</p>
            <p className={`text-xs ${dimTextClassName}`}>
              Mandamos o link de cobrança e o checkout pro seu WhatsApp. Assim que você pagar, o pedido atualiza sozinho.
            </p>
            <div className="space-y-2 pt-2">
              <button
                type="button"
                disabled={autoSending}
                onClick={sendAutoCharge}
                className={`w-full rounded-xl px-4 py-3 text-sm font-semibold border border-white/15 ${textClassName} disabled:opacity-60`}
              >
                {autoSending ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                Gerar nova cobrança (enviar novamente)
              </button>
              {onChangePaymentMethod && (
                <button
                  type="button"
                  disabled={autoSending}
                  onClick={onChangePaymentMethod}
                  className={`w-full rounded-xl px-4 py-3 text-sm font-semibold border border-white/15 ${textClassName} disabled:opacity-60`}
                >
                  Alterar método de pagamento
                </button>
              )}
              {onCancelOrder && (
                <button
                  type="button"
                  disabled={autoSending}
                  onClick={async () => {
                    setAutoSending(true)
                    setError(null)
                    try {
                      await onCancelOrder()
                      onClose()
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar o pedido.')
                    } finally {
                      setAutoSending(false)
                    }
                  }}
                  className="w-full text-xs text-red-400 underline pt-1"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        )}

        {showLinkUi && (
          <div className="space-y-3">
            {linkUrl ? (
              <>
                {mode === 'pdv' ? (
                  waSent ? (
                    <>
                      <div className="flex flex-col items-center gap-2 py-2 text-center">
                        <Loader2 className={`w-6 h-6 animate-spin ${dimTextClassName}`} />
                        <p className={`text-sm ${textClassName}`}>Aguardando o cliente pagar…</p>
                        <p className={`text-[11px] ${dimTextClassName}`}>
                          Assim que o pagamento for confirmado, a venda atualiza sozinha.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setWaSent(false)}
                        className={`w-full text-center text-xs ${dimTextClassName} hover:underline`}
                      >
                        Mandar de novo / trocar número
                      </button>
                    </>
                  ) : (
                    <>
                      <p className={`text-xs ${dimTextClassName}`}>
                        Manda esse link pro celular do cliente completar — nunca abra ou copie ele aqui no seu dispositivo.
                      </p>
                      <div>
                        <label className={`text-xs font-semibold ${dimTextClassName}`}>WhatsApp do cliente</label>
                        <input
                          className={`w-full h-10 mt-1 ${inputClassName}`}
                          inputMode="numeric"
                          placeholder="(83) 99999-9999"
                          value={waInput}
                          onChange={(e) => setWaInput(formatPhone(e.target.value))}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={busy || waInput.replace(/\D/g, '').length < 10}
                        onClick={() => void handleWhatsappShare()}
                        className={`w-full rounded-xl px-3 py-2.5 text-sm font-semibold ${accentClassName} disabled:opacity-60`}
                      >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                        Mandar por WhatsApp
                      </button>
                    </>
                  )
                ) : (
                  <>
                    <p className={`text-xs ${dimTextClassName}`}>Abra o link abaixo pra pagar com cartão.</p>
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
                    <p className={`text-[11px] ${dimTextClassName}`}>
                      Assim que o pagamento for confirmado, o pedido atualiza sozinho.
                    </p>
                  </>
                )}
              </>
            ) : error ? (
              <button
                type="button"
                onClick={() => void handlePickLink()}
                className={`w-full rounded-xl px-4 py-3 text-sm font-semibold ${accentClassName}`}
              >
                Tentar de novo
              </button>
            ) : (
              <Loader2 className={`w-5 h-5 animate-spin mx-auto ${dimTextClassName}`} />
            )}
          </div>
        )}

        {step === 'transparente' && !pdvTransparenteAsLink && (
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

        {mode === 'pdv' && onCancelOrder && (step === 'link' || step === 'transparente') ? (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onCancelOrder()
                onClose()
              } catch (e) {
                setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar a venda.')
                setBusy(false)
              }
            }}
            className="mt-3 text-xs text-red-400 hover:underline disabled:opacity-60"
          >
            Cancelar venda
          </button>
        ) : (
          step !== 'choose' && (
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
          )
        )}
      </motion.div>
    </motion.div>
  )
}
