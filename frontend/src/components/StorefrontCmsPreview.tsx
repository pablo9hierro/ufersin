import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, RefreshCw, RotateCcw, ShoppingBag, X } from 'lucide-react'
import { STOREFRONT_STYLES, type StorefrontStyle } from '../lib/storefrontStyles'

const PREVIEW_W = 390
const PREVIEW_H = 760

export type CartFabStyle = 'sacola' | 'cart_icon'

/** Campos de texto da landing clicáveis dentro do preview (data-cms-editable
 * no DOM real da vitrine -- uiux2/3/4 Landing.tsx). */
type CmsTextField = 'badge' | 'headline' | 'sub'

const FIELD_TO_VALUE_KEY: Record<CmsTextField, 'landingBadge' | 'landingHeadline' | 'landingSub'> = {
  badge: 'landingBadge',
  headline: 'landingHeadline',
  sub: 'landingSub',
}

const FIELD_LABEL: Record<CmsTextField, string> = {
  badge: 'Selo de destaque',
  headline: 'Título da vitrine',
  sub: 'Subtítulo da vitrine',
}

export interface StorefrontCmsValues {
  corPrincipal: string
  layoutStyle: StorefrontStyle
  landingHeadline: string
  landingSub: string
  landingBadge: string
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

  const [selectedField, setSelectedField] = useState<CmsTextField | null>(null)
  const [fieldOriginal, setFieldOriginal] = useState('')
  const [fieldDefault, setFieldDefault] = useState('')

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

  const cmsNode = (field: CmsTextField) =>
    iframeRef.current?.contentDocument?.querySelector<HTMLElement>(`[data-cms-editable="${field}"]`) ?? null

  // Preview só mostra o que está salvo por padrão (reloadToken/src) -- mas
  // enquanto o admin digita, sincroniza o rascunho direto no DOM do iframe
  // (same-origin) pra ele ver o resultado sem precisar salvar antes.
  useEffect(() => {
    const badgeNode = cmsNode('badge')
    if (badgeNode) badgeNode.textContent = values.landingBadge
    const headlineNode = cmsNode('headline')
    if (headlineNode) headlineNode.textContent = values.landingHeadline || headlineNode.getAttribute('data-cms-default') || ''
    const subNode = cmsNode('sub')
    if (subNode) subNode.textContent = values.landingSub || subNode.getAttribute('data-cms-default') || ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.landingBadge, values.landingHeadline, values.landingSub, reloadToken])

  const handlePreviewLoad = () => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    ;(['badge', 'headline', 'sub'] as CmsTextField[]).forEach((field) => {
      const node = doc.querySelector<HTMLElement>(`[data-cms-editable="${field}"]`)
      if (!node) return
      node.style.cursor = 'pointer'
      node.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        setSelectedField(field)
        setFieldOriginal(values[FIELD_TO_VALUE_KEY[field]])
        setFieldDefault(node.getAttribute('data-cms-default') ?? '')
      })
    })
    // Já reaplica o rascunho atual assim que o iframe termina de carregar
    // (senão ele mostraria só o valor salvo até o próximo keystroke).
    const badgeNode = doc.querySelector<HTMLElement>('[data-cms-editable="badge"]')
    if (badgeNode) badgeNode.textContent = values.landingBadge
    const headlineNode = doc.querySelector<HTMLElement>('[data-cms-editable="headline"]')
    if (headlineNode) headlineNode.textContent = values.landingHeadline || headlineNode.getAttribute('data-cms-default') || ''
    const subNode = doc.querySelector<HTMLElement>('[data-cms-editable="sub"]')
    if (subNode) subNode.textContent = values.landingSub || subNode.getAttribute('data-cms-default') || ''
  }

  const cancelFieldEdit = () => {
    if (selectedField) onChange({ [FIELD_TO_VALUE_KEY[selectedField]]: fieldOriginal })
    setSelectedField(null)
  }

  const restoreFieldDefault = () => {
    if (!selectedField) return
    onSaveField({ [FIELD_TO_VALUE_KEY[selectedField]]: fieldDefault })
  }

  const saveField = () => {
    if (!selectedField) return
    onSaveField({ [FIELD_TO_VALUE_KEY[selectedField]]: values[FIELD_TO_VALUE_KEY[selectedField]] })
  }

  function FieldEditorButtons({ field }: { field: CmsTextField }) {
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
        <label className="label mb-1 flex items-center gap-1.5">
          {FIELD_LABEL.badge}
          {selectedField === 'badge' && <span className="text-uf-blue text-[10px] font-normal">(clicado no preview)</span>}
        </label>
        <input
          className={`input-field w-full text-sm ${selectedField === 'badge' ? 'border-uf-blue' : ''}`}
          value={values.landingBadge}
          onFocus={() => {
            setSelectedField('badge')
            setFieldOriginal(values.landingBadge)
            setFieldDefault(cmsNode('badge')?.getAttribute('data-cms-default') ?? '')
          }}
          onChange={(e) => onChange({ landingBadge: e.target.value })}
          placeholder="Ex: Feito na hora, todo dia"
        />
        <FieldEditorButtons field="badge" />
      </div>
      <div>
        <label className="label mb-1 flex items-center gap-1.5">
          {FIELD_LABEL.headline}
          {selectedField === 'headline' && <span className="text-uf-blue text-[10px] font-normal">(clicado no preview)</span>}
        </label>
        <input
          className={`input-field w-full text-sm ${selectedField === 'headline' ? 'border-uf-blue' : ''}`}
          value={values.landingHeadline}
          onFocus={() => {
            setSelectedField('headline')
            setFieldOriginal(values.landingHeadline)
            setFieldDefault(cmsNode('headline')?.getAttribute('data-cms-default') ?? '')
          }}
          onChange={(e) => onChange({ landingHeadline: e.target.value })}
          placeholder="Ex: Fome? A gente entrega em minutos."
        />
        <FieldEditorButtons field="headline" />
      </div>
      <div>
        <label className="label mb-1 flex items-center gap-1.5">
          {FIELD_LABEL.sub}
          {selectedField === 'sub' && <span className="text-uf-blue text-[10px] font-normal">(clicado no preview)</span>}
        </label>
        <textarea
          className={`input-field w-full text-sm resize-y ${selectedField === 'sub' ? 'border-uf-blue' : ''}`}
          rows={2}
          value={values.landingSub}
          onFocus={() => {
            setSelectedField('sub')
            setFieldOriginal(values.landingSub)
            setFieldDefault(cmsNode('sub')?.getAttribute('data-cms-default') ?? '')
          }}
          onChange={(e) => onChange({ landingSub: e.target.value })}
          placeholder="Ex: Lanches, bebidas e sobremesas feitos com carinho."
        />
        <FieldEditorButtons field="sub" />
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

        <div ref={frameRef} className="w-full overflow-hidden flex justify-center">
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
      </div>
    </div>
  )
}
