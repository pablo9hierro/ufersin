import { ShoppingBag } from 'lucide-react'
import { STOREFRONT_STYLES, type StorefrontStyle } from '../lib/storefrontStyles'

/** Mesmos 3 estilos do DemoPaletteSwitcher (uiux2/3/4). */
export default function StorefrontStylePicker({
  value,
  onChange,
  publicUrl,
}: {
  value: StorefrontStyle
  onChange: (s: StorefrontStyle) => void
  /** URL pública real da loja (só existe quando o slug já foi provisionado). */
  publicUrl?: string | null
}) {
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

      <div className="flex justify-center">
        <div className="w-full max-w-[375px] rounded-[2rem] border border-white/15 bg-[#0a0b12] p-[7px] shadow-[0_12px_40px_-12px_rgba(0,0,0,0.65)]">
          <div className="relative rounded-[1.55rem] overflow-hidden border border-white/10 bg-black" style={{ height: 620 }}>
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 w-20 h-1.5 rounded-full bg-black/50 border border-white/10" />
            {publicUrl ? (
              <iframe src={publicUrl} title="Preview da vitrine" className="w-full h-full border-0" />
            ) : (
              <div className="h-full flex items-center justify-center px-6 text-center">
                <p className="text-xs text-uf-silver-dim flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 shrink-0" />
                  Sua vitrine aparece aqui depois de liberar o painel. Título, cor e textos dá pra ajustar em Meu plano → Layout.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
