import { useEffect, useRef, useState } from 'react'
import { Clock, ShoppingBag } from 'lucide-react'
import { STOREFRONT_STYLES, type StorefrontStyle } from '../lib/storefrontStyles'

const PREVIEW_W = 390
const PREVIEW_H = 760

export type CartFabStyle = 'sacola' | 'cart_icon'

export interface StorefrontCmsValues {
  lojaNome: string
  endereco: string
  logoUrl: string
  corPrincipal: string
  layoutStyle: StorefrontStyle
  landingHeadline: string
  landingSub: string
  landingBadge: string
  cartFabStyle: CartFabStyle
  cartFabAnimate: boolean
}

const DEFAULTS = {
  headline: 'Fome? A gente entrega em minutos.',
  sub: 'Lanches, bebidas e sobremesas feitos com carinho. Peça pelo site ou chama a gente no WhatsApp.',
  badge: 'Feito na hora, todo dia',
}

/** Preview 1:1 (phone 390×760) com textos editáveis que refletem na landing. */
export default function StorefrontCmsPreview({
  values,
  onChange,
}: {
  values: StorefrontCmsValues
  onChange: (patch: Partial<StorefrontCmsValues>) => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.7)
  const active = STOREFRONT_STYLES.find((s) => s.key === values.layoutStyle) ?? STOREFRONT_STYLES[0]
  const title = values.lojaNome.trim() || 'Sua loja'
  const accent = values.corPrincipal.trim() || active.preview.accent
  const headline = values.landingHeadline.trim() || DEFAULTS.headline
  const sub = values.landingSub.trim() || DEFAULTS.sub
  const badge = values.landingBadge.trim() || DEFAULTS.badge

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
          Como seus clientes vão ver a vitrine. Textos do preview editam a landing real.
        </p>
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
      </div>

      <div>
        <p className="label mb-1">Ícone flutuante do carrinho</p>
        <div className="flex gap-2 mb-2">
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

      <div ref={frameRef} className="w-full overflow-hidden flex justify-center">
        <div style={{ width: PREVIEW_W * scale, height: PREVIEW_H * scale, position: 'relative' }}>
          <div
            className="absolute top-0 left-0 origin-top-left rounded-[2rem] border border-white/15 bg-[#0a0b12] p-[7px] shadow-[0_12px_40px_-12px_rgba(0,0,0,0.65)]"
            style={{ width: PREVIEW_W, height: PREVIEW_H, transform: `scale(${scale})` }}
          >
            <div
              className="relative h-full rounded-[1.55rem] overflow-hidden border border-white/10 flex flex-col"
              style={{ background: active.preview.bg }}
            >
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 w-20 h-1.5 rounded-full bg-black/50 border border-white/10" />

              <div className="px-3 pt-6 pb-2.5 flex items-center justify-between gap-2 border-b border-white/5">
                <span className="text-[10px] font-semibold text-white/45 shrink-0">Catálogo</span>
                <span className="flex items-center gap-1.5 min-w-0 justify-center">
                  {values.logoUrl ? (
                    <img src={values.logoUrl} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
                  ) : null}
                  <span className="text-xs font-black tracking-wide text-white truncate">{title}</span>
                </span>
                <div className="flex items-center gap-1.5 text-[10px] text-white/45 shrink-0">
                  <span>Sacola</span>
                  <span>Pedidos</span>
                </div>
              </div>

              <div className="flex-1 px-3 py-3 overflow-y-auto">
                <p className="text-[9px] uppercase tracking-wider text-white/50 font-semibold mb-2">
                  Preview · {active.label}
                </p>
                <Editable
                  value={badge}
                  onChange={(v) => onChange({ landingBadge: v })}
                  className="inline-block text-[10px] font-bold px-2 py-1 rounded-full mb-2"
                  style={{ background: `${accent}33`, color: '#fff' }}
                />
                <Editable
                  value={headline}
                  onChange={(v) => onChange({ landingHeadline: v })}
                  className="block text-base font-black text-white leading-tight mb-2"
                />
                <Editable
                  value={sub}
                  onChange={(v) => onChange({ landingSub: v })}
                  className="block text-[11px] text-white/70 mb-3 leading-snug"
                  multiline
                />
                {values.endereco.trim() && (
                  <p className="text-[10px] text-white/55 mb-2 truncate">📍 {values.endereco}</p>
                )}
                <p className="text-[10px] text-white/45 flex items-center gap-1 mb-4">
                  <Clock className="w-3 h-3" /> Horário (Configurações da loja)
                </p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <span className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-black bg-white">Ver catálogo</span>
                  <span className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-white/80 bg-white/10">
                    Acompanhar entrega
                  </span>
                </div>
              </div>

              <div className="absolute bottom-5 right-4 z-10">
                {values.cartFabStyle === 'sacola' ? (
                  <span
                    className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
                    style={{ background: accent }}
                  >
                    <ShoppingBag className="w-5 h-5 text-white" />
                  </span>
                ) : (
                  <span
                    className={`block w-12 h-12 ${values.cartFabAnimate ? 'animate-bounce' : ''}`}
                    style={{
                      background: `radial-gradient(circle at 30% 30%, ${accent}, #222)`,
                      borderRadius: 12,
                    }}
                    id="cart-icon"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Editable({
  value,
  onChange,
  className,
  style,
  multiline,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  style?: React.CSSProperties
  multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  if (editing) {
    const common = {
      className: `${className ?? ''} outline outline-1 outline-uf-blue/60 bg-black/40 rounded px-1 w-full`,
      style,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: () => {
        onChange(draft)
        setEditing(false)
      },
      autoFocus: true,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onChange(draft)
          setEditing(false)
        }
        if (e.key === 'Escape') setEditing(false)
      },
    }
    return multiline ? <textarea rows={3} {...common} /> : <input {...common} />
  }

  return (
    <button
      type="button"
      className={`${className ?? ''} text-left cursor-text hover:outline hover:outline-1 hover:outline-white/30 rounded`}
      style={style}
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      title="Clique pra editar"
    >
      {value}
    </button>
  )
}
