import { STOREFRONT_STYLES, type StorefrontStyle } from '../lib/storefrontStyles'

/** Mesmos 3 estilos do DemoPaletteSwitcher (uiux2/3/4). Preview no formulário. */
export default function StorefrontStylePicker({
  value,
  onChange,
  lojaNome,
  corPrincipal,
}: {
  value: StorefrontStyle
  onChange: (s: StorefrontStyle) => void
  lojaNome?: string
  corPrincipal?: string
}) {
  const active = STOREFRONT_STYLES.find((s) => s.key === value) ?? STOREFRONT_STYLES[0]
  const title = lojaNome?.trim() || 'Sua loja'
  const accent = corPrincipal?.trim() || active.preview.accent

  return (
    <div className="space-y-4">
      <div>
        <p className="label mb-1">Estilo de layout</p>
        <p className="text-[11px] text-uf-silver-dim mb-3 leading-snug">
          Como seus clientes vão ver a vitrine. Se não escolher, fica o padrão Resolutoo (Ufersin nativo). Dá pra trocar depois em Meu plano.
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {STOREFRONT_STYLES.map((s) => {
            const selected = value === s.key
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onChange(s.key)}
                className={`rounded-xl px-2.5 py-2.5 text-left border transition-all ${
                  selected ? 'border-uf-blue bg-uf-blue/10' : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                }`}
              >
                {s.key === 'ufersin' && (
                  <span
                    className="w-full h-10 rounded-lg mb-2 flex items-center justify-center"
                    style={{ background: '#06070d', boxShadow: '0 1px 2px rgba(0,0,0,0.3), 0 6px 16px -4px rgba(0,0,0,0.45)' }}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full"
                      style={{ background: 'linear-gradient(135deg, #4d7cff, #8b5cf6, #ec4899)' }}
                    />
                  </span>
                )}
                {s.key === 'burgerbite' && (
                  <span
                    className="w-full h-10 rounded-lg mb-2 flex items-center justify-center"
                    style={{ background: '#0e0d0d', boxShadow: '0 1px 2px rgba(0,0,0,0.3), 0 6px 16px -4px rgba(0,0,0,0.45)' }}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full"
                      style={{ background: 'linear-gradient(135deg, #ff3d3d, #ff8a00)' }}
                    />
                  </span>
                )}
                {s.key === 'burgerhouse' && (
                  <span
                    className="w-full h-10 rounded-lg mb-2 flex items-center justify-center gap-1 px-2"
                    style={{ background: '#050505', boxShadow: '0 1px 2px rgba(0,0,0,0.3), 0 6px 16px -4px rgba(0,0,0,0.45)' }}
                  >
                    <span className="flex-1 h-5 rounded border border-white/20" />
                    <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: '#ff7a1a' }} />
                  </span>
                )}
                <span className="block text-xs font-bold text-uf-silver leading-tight">{s.label}</span>
                <span className="block text-[10px] text-uf-silver-dim mt-0.5 leading-snug">{s.desc}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex justify-center" aria-hidden>
        <div
          className="w-full max-w-[375px] rounded-[2rem] border border-white/15 bg-[#0a0b12] p-[7px] shadow-[0_12px_40px_-12px_rgba(0,0,0,0.65)]"
        >
          <div className="relative rounded-[1.55rem] overflow-hidden border border-white/10" style={{ background: active.preview.bg }}>
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 w-20 h-1.5 rounded-full bg-black/50 border border-white/10" />
            <div className="px-3 pt-6 pb-2.5 flex items-center justify-between gap-2 border-b border-white/5">
              <span className="text-[10px] font-semibold text-white/45 shrink-0">Catálogo</span>
              <span className="text-xs font-black tracking-wide text-white truncate text-center">{title}</span>
              <div className="flex items-center gap-1.5 text-[10px] text-white/45 shrink-0">
                <span>Sacola</span>
                <span>Pedidos</span>
              </div>
            </div>
            <div className="px-3 py-3 pb-4">
              <div
                className="rounded-2xl min-h-[120px] mb-3 relative overflow-hidden flex flex-col justify-end p-3.5"
                style={{
                  background: `linear-gradient(160deg, ${accent}66, transparent 55%), ${active.preview.bg}`,
                }}
              >
                <span className="text-[9px] uppercase tracking-wider text-white/60 font-semibold mb-1">
                  Preview · {active.label}
                </span>
                <span className="text-base font-black text-white leading-tight mb-2.5">
                  Fome? A gente entrega em minutos.
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-black"
                    style={{ background: '#fff' }}
                  >
                    Ver catálogo
                  </span>
                  <span className="px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-white/80 bg-white/10">
                    Acompanhar entrega
                  </span>
                </div>
              </div>
              {active.preview.tile ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="aspect-[4/3] rounded-lg bg-white/10 border border-white/10" />
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="flex items-center gap-2.5 rounded-xl bg-white/5 px-2.5 py-2">
                      <span
                        className="w-9 h-9 rounded-lg shrink-0"
                        style={{ background: i === 0 ? accent : 'rgba(255,255,255,0.12)' }}
                      />
                      <span className="flex-1 space-y-1.5">
                        <span className="block h-2 rounded bg-white/20 w-2/3" />
                        <span className="block h-1.5 rounded bg-white/10 w-1/3" />
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="pb-2 flex justify-center">
              <span className="w-24 h-1 rounded-full bg-white/20" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
