import { STOREFRONT_STYLES, type StorefrontStyle } from '../lib/storefrontStyles'

/** Preview + paleta dos 3 estilos de vitrine (uiux2/3/4 no motor). */
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
    <div className="space-y-3">
      <div>
        <p className="label mb-2">Estilo da vitrine</p>
        <p className="text-[11px] text-uf-silver-dim mb-3">
          Escolha como seus clientes vão ver a loja. Dá pra trocar depois em Meu plano.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {STOREFRONT_STYLES.map((s) => {
            const selected = value === s.key
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onChange(s.key)}
                className={`rounded-xl p-2.5 text-left border transition-all ${
                  selected ? 'border-uf-blue bg-uf-blue/10' : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                }`}
              >
                <span
                  className="w-full h-10 rounded-lg mb-2 flex items-center justify-center gap-1"
                  style={{ background: s.preview.bg }}
                >
                  {s.preview.tile ? (
                    <>
                      <span className="flex-1 h-5 rounded border border-white/20" />
                      <span className="w-4 h-4 rounded-sm shrink-0" style={{ background: s.preview.accent }} />
                    </>
                  ) : (
                    <span
                      className="w-4 h-4 rounded-full"
                      style={{
                        background: `linear-gradient(135deg, ${s.preview.accent}, ${s.preview.accent2 ?? s.preview.accent})`,
                      }}
                    />
                  )}
                </span>
                <span className="block text-[11px] font-bold text-uf-silver leading-tight">{s.label}</span>
                <span className="block text-[10px] text-uf-silver-dim mt-0.5 leading-snug">{s.desc}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div
        className="rounded-2xl overflow-hidden border border-white/10"
        style={{ background: active.preview.bg }}
        aria-hidden
      >
        <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
          <span className="w-6 h-6 rounded-lg bg-white/10" />
          <span className="text-[11px] font-black tracking-wide text-white truncate uppercase">{title}</span>
          <span className="w-6 h-6 rounded-full" style={{ background: accent }} />
        </div>
        <div className="px-3 pb-3">
          <div
            className="rounded-xl h-24 mb-2 relative overflow-hidden flex flex-col justify-end p-2.5"
            style={{
              background: `linear-gradient(160deg, ${accent}55, transparent 60%), ${active.preview.bg}`,
            }}
          >
            <span className="text-[10px] text-white/80 font-semibold">Preview · {active.label}</span>
            <span className="text-sm font-black text-white leading-tight truncate">{title}</span>
          </div>
          <div className="flex gap-1.5 mb-2">
            <span className="flex-1 h-7 rounded-lg text-[9px] font-bold text-black flex items-center justify-center" style={{ background: '#fff' }}>
              Ver catálogo
            </span>
            <span className="flex-1 h-7 rounded-lg text-[9px] font-bold text-white/80 flex items-center justify-center bg-white/10">
              Acompanhar
            </span>
          </div>
          {active.preview.tile ? (
            <div className="grid grid-cols-3 gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="aspect-square rounded-md bg-white/10 border border-white/10" />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {[0, 1].map((i) => (
                <span key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5">
                  <span className="w-7 h-7 rounded-md shrink-0" style={{ background: i === 0 ? accent : 'rgba(255,255,255,0.12)' }} />
                  <span className="flex-1 h-2 rounded bg-white/15" />
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
