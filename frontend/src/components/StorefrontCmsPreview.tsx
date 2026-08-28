import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, RefreshCw, RotateCcw, ShoppingBag, X } from 'lucide-react'
import { STOREFRONT_STYLES, type StorefrontStyle } from '../lib/storefrontStyles'

const PREVIEW_W = 390
const PREVIEW_H = 760

export type CartFabStyle = 'sacola' | 'cart_icon'

/** Campo de texto da landing clicável dentro do preview -- id bate 1:1 com
 * `data-cms-editable` no DOM real da vitrine (uiux2/3/4 + EletronicaHome):
 * 'badge' | 'headline' | 'sub' | `highlight:{i}:title` | `highlight:{i}:desc`.
 * String solta (não union fechada) porque a quantidade de cards de destaque
 * varia por layoutStyle/vertical -- descoberta em runtime lendo o DOM, não
 * fixa em tempo de compilação. */
type CmsField = string

const HIGHLIGHT_RE = /^highlight:(\d+):(title|desc)$/

/** Rótulo padrão pra quem não é badge/headline/sub/highlight -- usado só
 * como fallback; o rótulo de verdade vem de `data-cms-label` no próprio nó
 * (lido no momento do clique/descoberta, ver `bindClickListeners`) porque
 * esse componente não tem como saber de antemão todo texto avulso
 * (`text:*`) que cada layout/vertical decide marcar como editável. */
function fieldLabel(field: CmsField): string {
  if (field === 'badge') return 'Selo de destaque'
  if (field === 'headline') return 'Título da vitrine'
  if (field === 'sub') return 'Subtítulo da vitrine'
  const m = field.match(HIGHLIGHT_RE)
  if (m) {
    const n = Number(m[1]) + 1
    return `Destaque ${n} — ${m[2] === 'title' ? 'título' : 'descrição'}`
  }
  return field
}

function getFieldValue(values: StorefrontCmsValues, field: CmsField): string {
  if (field === 'badge') return values.landingBadge
  if (field === 'headline') return values.landingHeadline
  if (field === 'sub') return values.landingSub
  const m = field.match(HIGHLIGHT_RE)
  if (m) {
    const idx = Number(m[1])
    const part = m[2] as 'title' | 'desc'
    return values.landingHighlights[idx]?.[part] ?? ''
  }
  if (field.startsWith('text:')) return values.landingTexts[field.slice(5)] ?? ''
  return ''
}

/** Patch pro campo, preservando os demais itens de landingHighlights (que é
 * salvo/trocado como array inteiro -- não existe PATCH por índice). */
function patchForField(values: StorefrontCmsValues, field: CmsField, value: string): Partial<StorefrontCmsValues> {
  if (field === 'badge') return { landingBadge: value }
  if (field === 'headline') return { landingHeadline: value }
  if (field === 'sub') return { landingSub: value }
  const m = field.match(HIGHLIGHT_RE)
  if (m) {
    const idx = Number(m[1])
    const part = m[2] as 'title' | 'desc'
    const arr = values.landingHighlights.slice()
    while (arr.length <= idx) arr.push({ title: '', desc: '' })
    arr[idx] = { ...arr[idx], [part]: value }
    return { landingHighlights: arr }
  }
  if (field.startsWith('text:')) {
    return { landingTexts: { ...values.landingTexts, [field.slice(5)]: value } }
  }
  return {}
}

export interface StorefrontCmsValues {
  corPrincipal: string
  layoutStyle: StorefrontStyle
  landingHeadline: string
  landingSub: string
  landingBadge: string
  landingHighlights: { title: string; desc: string }[]
  landingTexts: Record<string, string>
  cartFabStyle: CartFabStyle
  cartFabAnimate: boolean
}

/** Preview 1:1 — carrega a vitrine real (mesmo componente que o cliente vê) via
 * iframe same-origin (`/loja/...` no mesmo domínio). Os 3 textos (selo/título/
 * subtítulo) são clicáveis direto no preview (`data-cms-editable` no DOM da
 * Landing real) -- clicar seleciona o campo e mostra Cancelar/Restaurar
 * padrão/Salvar ao lado do input correspondente; digitar sincroniza ao vivo
 * no preview (grava direto no textContent do nó, sem esperar salvar). */
export default function StorefrontCmsPreview({
  values,
  onChange,
  onSaveField,
  publicUrl,
  reloadToken,
  vertical,
}: {
  values: StorefrontCmsValues
  onChange: (patch: Partial<StorefrontCmsValues>) => void
  /** Persiste já (Restaurar padrão / Salvar do campo selecionado) -- o pai
   * decide como (o layout inteiro é um recurso só, sem PATCH por campo). */
  onSaveField: (patch: Partial<StorefrontCmsValues>) => void
  publicUrl: string | null
  reloadToken: number
  /** Ramo eletrônica tem UMA vitrine só (o próprio vrtech) -- não faz
   * sentido oferecer os 3 estilos do motor genérico (todos voltados pra
   * comida/delivery). Sem essa prop, assume ecommerce (comportamento atual). */
  vertical?: string
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = useState(0.7)
  const active = STOREFRONT_STYLES.find((s) => s.key === values.layoutStyle) ?? STOREFRONT_STYLES[0]
  const accent = values.corPrincipal.trim() || active.preview.accent

  const [selectedField, setSelectedField] = useState<CmsField | null>(null)
  const [selectedLabel, setSelectedLabel] = useState('')
  const [fieldOriginal, setFieldOriginal] = useState('')
  const [fieldDefault, setFieldDefault] = useState('')
  // O listener de clique do preview é anexado uma vez só (idempotente,
  // sobrevive a re-renders) -- sem essa ref ele ficaria preso lendo o
  // `values` de quando foi anexado, mostrando texto desatualizado se o
  // admin editar mais de um campo na mesma sessão sem dar reload.
  const valuesRef = useRef(values)
  valuesRef.current = values
  // Quais campos existem NESTE layoutStyle/vertical -- varia (3 destaques
  // no motor genérico, 4 na eletrônica, mais qualquer `text:*` avulso que
  // aquele layout decidiu marcar) -- descoberto lendo o DOM do preview,
  // não fixo, pro seletor "escolha direto" bater com a realidade. Rótulo
  // vem de `data-cms-label` no próprio nó (texto avulso não tem um nome
  // fixo conhecido de antemão como badge/headline/sub/highlight têm).
  const [availableFields, setAvailableFields] = useState<{ field: string; label: string }[]>([])

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setScale(Math.min(1, w / PREVIEW_W))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cmsNode = (field: CmsField) =>
    iframeRef.current?.contentDocument?.querySelector<HTMLElement>(`[data-cms-editable="${field}"]`) ?? null

  const selectField = (field: CmsField, node: HTMLElement) => {
    setSelectedField(field)
    setSelectedLabel(node.getAttribute('data-cms-label') || fieldLabel(field))
    setFieldOriginal(getFieldValue(valuesRef.current, field))
    setFieldDefault(node.getAttribute('data-cms-default') ?? '')
  }

  const syncDraftIntoIframe = () => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    doc.querySelectorAll<HTMLElement>('[data-cms-editable]').forEach((node) => {
      const field = node.getAttribute('data-cms-editable')
      if (!field) return
      const draft = getFieldValue(values, field)
      node.textContent = draft || node.getAttribute('data-cms-default') || ''
    })
  }

  // Preview só mostra o que está salvo por padrão (reloadToken/src) -- mas
  // enquanto o admin digita, sincroniza o rascunho direto no DOM do iframe
  // (same-origin) pra ele ver o resultado sem precisar salvar antes.
  useEffect(() => {
    syncDraftIntoIframe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.landingBadge, values.landingHeadline, values.landingSub, values.landingHighlights, values.landingTexts, reloadToken])

  const bindClickListeners = (doc: Document) => {
    const nodes = Array.from(doc.querySelectorAll<HTMLElement>('[data-cms-editable]'))
    setAvailableFields(
      nodes
        .map((n) => {
          const field = n.getAttribute('data-cms-editable') ?? ''
          return { field, label: n.getAttribute('data-cms-label') || fieldLabel(field) }
        })
        .filter((f) => f.field),
    )
    nodes.forEach((node) => {
      node.style.cursor = 'pointer'
    })
    // Um único listener no CAPTURE do documento, não por nó -- bloqueia
    // QUALQUER clique dentro do preview de navegar/executar a ação real
    // (botão "Produtos", link do carrinho, etc. -- eles são a vitrine de
    // verdade, teriam o mesmo comportamento de clicar de verdade neles),
    // e só quando o clique cai dentro de um `[data-cms-editable]` que
    // seleciona o campo pra editar. Capture no documento roda ANTES de
    // qualquer handler React da própria vitrine, então stopPropagation
    // aqui impede o clique de chegar neles -- por isso não dá mais pra
    // depender de um listener por nó (ele nunca seria alcançado).
    if (doc.body.dataset.cmsClickBlockerBound) return
    doc.body.dataset.cmsClickBlockerBound = '1'
    doc.addEventListener(
      'click',
      (e) => {
        e.preventDefault()
        e.stopPropagation()
        const target = e.target as HTMLElement | null
        const editable = target?.closest<HTMLElement>('[data-cms-editable]')
        const field = editable?.getAttribute('data-cms-editable')
        if (editable && field) selectField(field, editable)
      },
      true,
    )
  }

  // `iframe.onLoad` sozinho é uma corrida real: quando o documento
  // same-origin carrega rápido demais (cache do navegador), o evento pode
  // disparar antes do React terminar de anexar o handler no elemento --
  // testado ao vivo, clique no preview ficava morto até um reload completo
  // da página (o segundo load, mais lento, ganhava a corrida por acaso).
  // Poll curto e idempotente como rede de segurança, além do onLoad.
  useEffect(() => {
    if (!publicUrl) return
    let cancelled = false
    let tries = 0
    const tick = () => {
      if (cancelled) return
      const doc = iframeRef.current?.contentDocument
      if (doc && doc.readyState !== 'loading' && doc.querySelector('[data-cms-editable]')) {
        bindClickListeners(doc)
        syncDraftIntoIframe()
        return
      }
      tries += 1
      if (tries < 25) window.setTimeout(tick, 200)
    }
    tick()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicUrl, reloadToken])

  const handlePreviewLoad = () => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    bindClickListeners(doc)
    syncDraftIntoIframe()
  }

  const cancelFieldEdit = () => {
    if (selectedField) onChange(patchForField(values, selectedField, fieldOriginal))
    setSelectedField(null)
  }

  const restoreFieldDefault = () => {
    if (!selectedField) return
    onSaveField(patchForField(values, selectedField, fieldDefault))
  }

  const saveField = () => {
    if (!selectedField) return
    onSaveField(patchForField(values, selectedField, getFieldValue(values, selectedField)))
  }

  function FieldEditorButtons({ field }: { field: CmsField }) {
    if (selectedField !== field) return null
    return (
      <div className="flex items-center gap-1.5 mt-1.5">
        <button
          type="button"
          onClick={cancelFieldEdit}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-white/10 text-uf-silver-dim hover:text-uf-silver"
        >
          <X className="w-3 h-3" /> Cancelar
        </button>
        <button
          type="button"
          onClick={restoreFieldDefault}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-white/10 text-uf-silver-dim hover:text-uf-silver"
        >
          <RotateCcw className="w-3 h-3" /> Restaurar padrão
        </button>
        <button
          type="button"
          onClick={saveField}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-uf-blue bg-uf-blue/10 text-uf-blue"
        >
          <Check className="w-3 h-3" /> Salvar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="label mb-1">Estilo de layout</p>
        <p className="text-[11px] text-uf-silver-dim mb-3 leading-snug">
          Como seus clientes vão ver a vitrine.
        </p>
        {vertical === 'eletronicos' ? (
          <div className="rounded-xl px-2.5 py-2.5 text-left border border-uf-blue bg-uf-blue/10">
            <span className="block text-xs font-bold text-uf-silver leading-tight">Eletrônica</span>
            <span className="block text-[10px] text-uf-silver-dim mt-0.5 leading-snug">
              Vitrine dedicada de assistência técnica -- sem opção de troca.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {STOREFRONT_STYLES.map((s) => {
              const selected = s.key === values.layoutStyle
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onChange({ layoutStyle: s.key })}
                  className={`rounded-xl px-2.5 py-2.5 text-left border transition-all ${
                    selected ? 'border-uf-blue bg-uf-blue/10' : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                  }`}
                >
                  <span className="block text-xs font-bold text-uf-silver leading-tight">{s.label}</span>
                  <span className="block text-[10px] text-uf-silver-dim mt-0.5 leading-snug">{s.desc}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <p className="label mb-1">Ícone flutuante do carrinho</p>
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
              values.cartFabStyle === 'cart_icon' && values.cartFabAnimate ? 'animate-bounce' : ''
            }`}
            style={{ background: accent }}
            title="Cor vem de Cor principal, acima"
          >
            <ShoppingBag className="w-4 h-4 text-white" />
          </span>
          {([
            { id: 'sacola' as const, label: 'Sacola' },
            { id: 'cart_icon' as const, label: 'Cart-icon' },
          ]).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange({ cartFabStyle: opt.id })}
              className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold border ${
                values.cartFabStyle === opt.id ? 'border-uf-blue bg-uf-blue/10' : 'border-white/10'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {values.cartFabStyle === 'cart_icon' && (
          <label className="flex items-center gap-2 text-xs text-uf-silver-dim cursor-pointer">
            <input
              type="checkbox"
              checked={values.cartFabAnimate}
              onChange={(e) => onChange({ cartFabAnimate: e.target.checked })}
              className="rounded border-white/20"
            />
            Cart-icon se mexendo
          </label>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="label">Preview da vitrine real</p>
          {publicUrl && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-uf-blue hover:underline inline-flex items-center gap-1"
            >
              Abrir <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <p className="text-[11px] text-uf-silver-dim mb-3 leading-snug flex items-center gap-1.5">
          <RefreshCw className="w-3 h-3 shrink-0" />
          Clique no selo, título ou subtítulo dentro do preview pra editar ao vivo.
        </p>

        <div className="w-full flex flex-col lg:flex-row gap-4 items-start">
          <div ref={frameRef} className="w-full lg:w-auto lg:shrink-0 overflow-hidden flex justify-center">
            <div style={{ width: PREVIEW_W * scale, height: PREVIEW_H * scale, position: 'relative' }}>
              <div
                className="absolute top-0 left-0 origin-top-left rounded-[2rem] border border-white/15 bg-[#0a0b12] p-[7px] shadow-[0_12px_40px_-12px_rgba(0,0,0,0.65)]"
                style={{ width: PREVIEW_W, height: PREVIEW_H, transform: `scale(${scale})` }}
              >
                <div className="relative h-full rounded-[1.55rem] overflow-hidden border border-white/10 bg-black">
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 w-20 h-1.5 rounded-full bg-black/50 border border-white/10" />
                  {publicUrl ? (
                    <iframe
                      key={reloadToken}
                      ref={iframeRef}
                      onLoad={handlePreviewLoad}
                      src={publicUrl}
                      title="Preview da vitrine"
                      className="w-full h-full border-0"
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center px-6 text-center">
                      <p className="text-xs text-uf-silver-dim flex items-center gap-2">
                        <ShoppingBag className="w-4 h-4 shrink-0" />
                        Salve os dados da loja pra ver o preview real aqui.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="w-full flex-1 uf-glass rounded-2xl p-4 min-h-[200px]">
            {!selectedField ? (
              <div className="space-y-3">
                <p className="text-xs text-uf-silver-dim leading-snug">
                  Clique em qualquer texto dentro do preview ao lado pra editar aqui. Ou escolha direto:
                </p>
                <div className="flex flex-col gap-2">
                  {availableFields.map(({ field, label }) => (
                    <button
                      key={field}
                      type="button"
                      onClick={() => {
                        const node = cmsNode(field)
                        selectField(field, node ?? ({ getAttribute: () => null } as unknown as HTMLElement))
                      }}
                      className="text-left px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] hover:border-white/20 text-xs font-semibold text-uf-silver"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <label className="label mb-0 block">{selectedLabel}</label>
                {selectedField === 'sub' || selectedField.endsWith(':desc') ? (
                  <textarea
                    autoFocus
                    className="input-field w-full text-sm resize-y border-uf-blue"
                    rows={3}
                    value={getFieldValue(values, selectedField) || fieldDefault}
                    onChange={(e) => onChange(patchForField(values, selectedField, e.target.value))}
                  />
                ) : (
                  <input
                    autoFocus
                    className="input-field w-full text-sm border-uf-blue"
                    value={getFieldValue(values, selectedField) || fieldDefault}
                    onChange={(e) => onChange(patchForField(values, selectedField, e.target.value))}
                  />
                )}
                <FieldEditorButtons field={selectedField} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
