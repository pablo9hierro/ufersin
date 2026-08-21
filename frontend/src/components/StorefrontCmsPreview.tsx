import { useEffect, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, ShoppingBag } from 'lucide-react'
import { STOREFRONT_STYLES, type StorefrontStyle } from '../lib/storefrontStyles'

const PREVIEW_W = 390
const PREVIEW_H = 760

export type CartFabStyle = 'sacola' | 'cart_icon'

export interface StorefrontCmsValues {
  corPrincipal: string
  layoutStyle: StorefrontStyle
  landingHeadline: string
  landingSub: string
  landingBadge: string
  cartFabStyle: CartFabStyle
  cartFabAnimate: boolean
}

/** Preview 1:1 — carrega a vitrine real (mesmo componente que o cliente vê) via iframe.
 * Reflete só o que já foi salvo; textos/estilo têm inputs próprios abaixo, não são
 * mais editáveis clicando na prévia (a prévia agora É a loja real, não um mock). */
export default function StorefrontCmsPreview({
  values,
  onChange,
  publicUrl,
  reloadToken,
  vertical,
}: {
  values: StorefrontCmsValues
  onChange: (patch: Partial<StorefrontCmsValues>) => void
  publicUrl: string | null
  reloadToken: number
  /** Ramo eletrônica tem UMA vitrine só (o próprio vrtech) -- não faz
   * sentido oferecer os 3 estilos do motor genérico (todos voltados pra
   * comida/delivery). Sem essa prop, assume ecommerce (comportamento atual). */
  vertical?: string
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.7)
  const active = STOREFRONT_STYLES.find((s) => s.key === values.layoutStyle) ?? STOREFRONT_STYLES[0]
  const accent = values.corPrincipal.trim() || active.preview.accent

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
        <label className="label mb-1 block">Selo de destaque</label>
        <input
          className="input-field w-full text-sm"
          value={values.landingBadge}
          onChange={(e) => onChange({ landingBadge: e.target.value })}
          placeholder="Ex: Feito na hora, todo dia"
        />
      </div>
      <div>
        <label className="label mb-1 block">Título da vitrine</label>
        <input
          className="input-field w-full text-sm"
          value={values.landingHeadline}
          onChange={(e) => onChange({ landingHeadline: e.target.value })}
          placeholder="Ex: Fome? A gente entrega em minutos."
        />
      </div>
      <div>
        <label className="label mb-1 block">Subtítulo da vitrine</label>
        <textarea
          className="input-field w-full text-sm resize-y"
          rows={2}
          value={values.landingSub}
          onChange={(e) => onChange({ landingSub: e.target.value })}
          placeholder="Ex: Lanches, bebidas e sobremesas feitos com carinho."
        />
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
          Mostra o que já está salvo. Salve o layout pra atualizar.
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
