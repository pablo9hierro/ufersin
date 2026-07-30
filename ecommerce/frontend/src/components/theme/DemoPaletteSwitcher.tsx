import { useState } from 'react'
import { Palette, X } from 'lucide-react'
import { useTenantColor } from '../../store/tenantColor'
import { useLayoutStyle, type LayoutStyle } from '../../store/layoutStyle'

// Cor neutra só pro CHROME do próprio seletor (borda do card ativo,
// botão flutuante) -- não representa mais nenhum estilo específico
// (Clone Sunset foi removido das opções, "não tinha mais salvação").
const PICKER_ACCENT = '#4d7cff'
const PICKER_ACCENT_2 = '#8b5cf6'

const STYLES: { key: LayoutStyle; label: string; desc: string }[] = [
  { key: 'ufersin', label: 'Ufersin nativo', desc: 'Visual limpo e moderno' },
  { key: 'burgerbite', label: 'BurgerBite', desc: 'Onboarding vibrante, pílulas' },
  { key: 'burgerhouse', label: 'Burger House', desc: 'Minimalista, grade de fotos' },
]

// Painel da vitrine da demo -- escolha do estilo de layout (3 opções,
// todas com cor/base/estrutura 100% FIXAS/hardcoded, sem edição manual
// nenhuma -- cada pasta uiux2/3/4 tem seus PRÓPRIOS componentes/classes,
// nenhuma compartilha estrutura com as outras) + "cor da sua loja" (1-2
// cores, opcional): em vez de um monte de controles manuais (tom/
// textura/sombra/presets, sistema antigo removido -- quebrava
// harmonização quando a cor crua ia direto pra CSS), aqui só se escolhe a
// cor e o site DERIVA (nunca aplica cru) um trio de acento harmonizado em
// cima do estilo ativo (ver lib/colorHarmony.ts + DemoBrandScope em
// App.tsx). Só aparece nas páginas de cliente da demo, nunca no
// admin/motoboy/vendedor.
export default function DemoPaletteSwitcher() {
  const [open, setOpen] = useState(false)
  const [showColor2, setShowColor2] = useState(false)
  const { style, setStyle } = useLayoutStyle()
  const { color1, color2, setColors, reset } = useTenantColor()

  return (
    <div className="fixed bottom-5 right-5 z-[60]">
      {open && (
        <div className="rounded-2xl mb-3 w-[min(90vw,320px)] p-5 bg-son-surface border border-black/10 shadow-xl text-son-silver max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <p className="font-bold text-sm flex items-center gap-1.5">
              <Palette className="w-4 h-4" />
              Personalizar vitrine
            </p>
            <button onClick={() => setOpen(false)} aria-label="Fechar" className="text-son-silver-dim">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-son-silver-dim mb-2">Estilo de layout</p>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {STYLES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStyle(s.key)}
                className="px-2.5 py-2.5 rounded-xl text-left border"
                style={{ borderColor: style === s.key ? PICKER_ACCENT : 'rgba(0,0,0,0.1)', background: style === s.key ? 'rgba(0,0,0,0.04)' : 'transparent' }}
              >
                {/* Pré-visualização de cada estilo -- MESMA gramática visual
                    nos 3 botões (base dominante + 1 pingo pequeno de
                    degradê + sombra em 2 camadas suavizada, nunca glow de
                    cor crua). Cores 100% fixas/hardcoded aqui -- nenhum
                    dos 3 estilos é editável manualmente, só escolhível. */}
                {s.key === 'ufersin' && (
                  <span className="w-full h-8 rounded-lg mb-2 flex items-center justify-center" style={{ background: '#06070d', boxShadow: '0 1px 2px rgba(0,0,0,0.3), 0 6px 16px -4px rgba(0,0,0,0.45)' }}>
                    <span className="w-3.5 h-3.5 rounded-full" style={{ background: 'linear-gradient(135deg, #4d7cff, #8b5cf6, #ec4899)' }} />
                  </span>
                )}
                {s.key === 'burgerbite' && (
                  <span className="w-full h-8 rounded-lg mb-2 flex items-center justify-center" style={{ background: '#0e0d0d', boxShadow: '0 1px 2px rgba(0,0,0,0.3), 0 6px 16px -4px rgba(0,0,0,0.45)' }}>
                    <span className="w-3.5 h-3.5 rounded-full" style={{ background: 'linear-gradient(135deg, #ff3d3d, #ff8a00)' }} />
                  </span>
                )}
                {s.key === 'burgerhouse' && (
                  <span className="w-full h-8 rounded-lg mb-2 flex items-center justify-center gap-1 px-2" style={{ background: '#050505', boxShadow: '0 1px 2px rgba(0,0,0,0.3), 0 6px 16px -4px rgba(0,0,0,0.45)' }}>
                    <span className="flex-1 h-4 rounded" style={{ border: '1.5px solid rgba(255,255,255,0.18)' }} />
                    <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: '#ff7a1a' }} />
                  </span>
                )}
                <span className="block text-xs font-bold">{s.label}</span>
                <span className="block text-[10px] text-son-silver-dim mt-0.5">{s.desc}</span>
              </button>
            ))}
          </div>

          {/* Única personalização possível: 1-2 cores da marca do lojista,
              que o site usa pra DERIVAR (nunca aplicar cru) um trio de
              acento harmonizado em cima do estilo escolhido acima -- ver
              lib/colorHarmony.ts. Sem tom/textura/sombra/presets manuais
              (sistema antigo, removido: dava pra descasar contraste). */}
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-son-silver-dim">Cor da sua loja</p>
            {color1 && (
              <button onClick={reset} className="text-[11px] font-semibold underline text-son-silver-dim">
                Restaurar padrão
              </button>
            )}
          </div>
          <p className="text-[11px] text-son-silver-dim mb-2 leading-snug">Escolha 1 ou 2 cores da sua marca — o site harmoniza contraste, degradê e sombra automaticamente em cima do estilo escolhido acima.</p>
          <div className="flex items-center gap-2 mb-1.5">
            <input
              type="color"
              value={color1 ?? PICKER_ACCENT}
              onChange={(e) => setColors(e.target.value, color2)}
              className="w-9 h-9 rounded-lg border-0 cursor-pointer bg-transparent"
              aria-label="Cor principal da sua loja"
            />
            {showColor2 || color2 ? (
              <input
                type="color"
                value={color2 ?? PICKER_ACCENT_2}
                onChange={(e) => setColors(color1 ?? PICKER_ACCENT, e.target.value)}
                className="w-9 h-9 rounded-lg border-0 cursor-pointer bg-transparent"
                aria-label="Cor secundária da sua loja (opcional)"
              />
            ) : (
              <button onClick={() => setShowColor2(true)} className="text-[11px] font-semibold text-son-silver-dim underline">
                + cor secundária (opcional)
              </button>
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="w-14 h-14 rounded-full flex items-center justify-center shadow-xl text-white"
        style={{ background: `linear-gradient(135deg, ${PICKER_ACCENT}, ${PICKER_ACCENT_2})` }}
        aria-label="Personalizar estilo da vitrine"
      >
        <Palette className="w-5 h-5" />
      </button>
    </div>
  )
}
