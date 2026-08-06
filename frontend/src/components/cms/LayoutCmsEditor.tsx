import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Plus, Save } from 'lucide-react'
import { CmsEditProvider, type CmsTabId } from '../../lib/cms'
import { FALLBACK_PLANS, formatBRL, type PlanInfo } from '../../lib/plans'
import type { PlatformPlan } from '../../lib/api'
import Hero from '../landing/Hero'
import Pricing from '../landing/Pricing'
import DemoPage from '../../pages/Demo'
import AssinarPreviewShell from './AssinarPreviewShell'

const TABS: { id: CmsTabId; label: string; path: string }[] = [
  { id: 'landing', label: 'Landing', path: '/' },
  { id: 'demo', label: 'Demonstração', path: '/demo' },
  { id: 'assinar', label: 'Assinar', path: '/assinar' },
]

const PREVIEW_WIDTH = 1280
const PREVIEW_VIEWPORT_HEIGHT = 'min(70vh, calc(100vh - 220px))'

interface LayoutCmsEditorProps {
  content: Record<string, string>
  onContentChange: (key: string, value: string) => void
  onSaveContent: (key: string, value: string) => Promise<void>
  plans: PlatformPlan[]
  planPrices: Record<string, string>
  onPlanPriceChange: (code: string, value: string) => void
  onSavePlan: (code: string) => Promise<void>
  onToggleActive: (code: string, active: boolean) => Promise<void>
  onSavePlanName: (code: string, name: string) => Promise<void>
  onSeedDefaultPlans: () => Promise<void>
  busy: boolean
  error: string | null
}

const CONTACT_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'contato.whatsapp', label: 'WhatsApp da Resolutoo', placeholder: '5583999999999 (só números, com DDI+DDD)' },
  { key: 'contato.email', label: 'E-mail da Resolutoo', placeholder: 'contato@resolutoo.com' },
  { key: 'contato.instagram', label: 'Instagram da Resolutoo', placeholder: '@resolutoo' },
]

export default function LayoutCmsEditor({
  content,
  onContentChange,
  onSaveContent,
  plans,
  planPrices,
  onPlanPriceChange,
  onSavePlan,
  onToggleActive,
  onSavePlanName,
  onSeedDefaultPlans,
  busy,
  error,
}: LayoutCmsEditorProps) {
  const [tab, setTab] = useState<CmsTabId>('landing')
  const [scale, setScale] = useState(0.5)
  const [contentHeight, setContentHeight] = useState(820)
  const [planNames, setPlanNames] = useState<Record<string, string>>({})
  const [contactDrafts, setContactDrafts] = useState<Record<string, string>>({})
  const frameRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setPlanNames(Object.fromEntries(plans.map((p) => [p.code, p.name])))
  }, [plans])

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setScale(Math.min(1, w / PREVIEW_WIDTH))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Measure unscaled content so the spacer height matches visual (scaled) height for scroll.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = () => {
      const h = el.scrollHeight
      if (h > 0) setContentHeight(h)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tab, content, plans])

  const blockNav = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('[data-cms-edit]')) return
    if (t.closest('a, button[type="submit"]')) {
      e.preventDefault()
      e.stopPropagation()
    }
  }, [])

  // Keep wheel/trackpad scrolling inside the preview when hovering it.
  const onPreviewWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight <= el.clientHeight) return
    const atTop = el.scrollTop <= 0
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
    if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) return
    e.stopPropagation()
  }, [])

  return (
    <div className="space-y-5">
      {error && <p className="error-msg">{error}</p>}

      <section className="uf-glass rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-bold text-sm">Planos (fonte de verdade)</h2>
            <p className="text-xs text-uf-silver-dim mt-1">
              Preços no banco alimentam landing, /assinar e checkout. O cliente nunca define o valor cobrado.
            </p>
          </div>
          {plans.length === 0 && (
            <button type="button" disabled={busy} onClick={() => void onSeedDefaultPlans()} className="btn-primary text-xs px-4 py-2">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Criar planos padrão
            </button>
          )}
        </div>

        {plans.length === 0 ? (
          <p className="text-sm text-uf-silver-dim">Nenhum plano no banco — clique em “Criar planos padrão” ou cadastre via API.</p>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => (
              <div key={p.code} className="flex flex-wrap items-center gap-2 sm:gap-3 py-2 border-b border-white/5 last:border-0">
                <span className="text-[10px] font-mono text-uf-silver-dim w-24 shrink-0">{p.code}</span>
                <input
                  className="input-field w-36 text-sm"
                  value={planNames[p.code] ?? p.name}
                  onChange={(e) => setPlanNames((prev) => ({ ...prev, [p.code]: e.target.value }))}
                  onBlur={() => {
                    const name = planNames[p.code]?.trim()
                    if (name && name !== p.name) void onSavePlanName(p.code, name)
                  }}
                />
                <input
                  className="input-field w-24 text-sm"
                  value={planPrices[p.code] ?? ''}
                  onChange={(e) => onPlanPriceChange(p.code, e.target.value)}
                  inputMode="decimal"
                  aria-label={`Preço ${p.name}`}
                />
                <span className="text-xs text-uf-silver-dim">R$/mês</span>
                <label
                  htmlFor={`plan-active-${p.code}`}
                  className="flex items-center gap-1.5 text-xs text-uf-silver-dim cursor-pointer"
                >
                  <input
                    id={`plan-active-${p.code}`}
                    name={`plan-active-${p.code}`}
                    type="checkbox"
                    checked={Boolean(p.active)}
                    disabled={busy}
                    onChange={(e) => void onToggleActive(p.code, e.target.checked)}
                  />
                  Ativo
                </label>
                <button type="button" disabled={busy} onClick={() => void onSavePlan(p.code)} className="btn-secondary text-xs px-3 py-2">
                  <Save className="w-3.5 h-3.5" />
                  Salvar
                </button>
                {p.highlight && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 flex items-center gap-1">
                    <Check className="w-3 h-3" /> destaque
                  </span>
                )}
              </div>
            ))}
            <p className="text-[11px] text-uf-silver-dim pt-1">
              Ativos públicos: {plans.filter((p) => p.active).map((p) => `${p.name} R$ ${formatBRL(p.price_monthly)}`).join(' · ') || '—'}
            </p>
          </div>
        )}
      </section>

      <section className="uf-glass rounded-2xl p-5">
        <div className="mb-4">
          <h2 className="font-bold text-sm">Contato & redes sociais</h2>
          <p className="text-xs text-uf-silver-dim mt-1">
            Usado em toda a Resolutoo (landing, políticas, login) — troque aqui e reflete em todo lugar.
          </p>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {CONTACT_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label text-xs">{f.label}</label>
              <input
                className="input-field w-full text-sm"
                value={contactDrafts[f.key] ?? content[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setContactDrafts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                onBlur={() => {
                  const v = contactDrafts[f.key]
                  if (v !== undefined && v !== (content[f.key] ?? '')) void onSaveContent(f.key, v)
                }}
              />
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-1 border-b border-white/10 pb-px">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm rounded-t-lg transition-colors ${
              tab === t.id ? 'bg-white/10 text-white border border-b-0 border-white/10' : 'text-uf-silver-dim hover:text-uf-silver'
            }`}
          >
            {t.label}
            <span className="ml-2 text-[10px] font-mono opacity-60">{t.path}</span>
          </button>
        ))}
      </div>

      <p className="text-xs text-uf-silver-dim">
        Visual CMS — clique num texto destacado no preview para editar. Ctrl/Cmd+Enter salva. A página pública reflete após o save.
      </p>

      {/* Scrollable viewport; spacer height = unscaled content × scale so transform doesn't clip. */}
      <div
        ref={frameRef}
        className="relative w-full overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-uf-black"
        style={{ height: PREVIEW_VIEWPORT_HEIGHT }}
        onWheel={onPreviewWheel}
      >
        <div style={{ height: Math.max(1, Math.round(contentHeight * scale)), width: '100%' }}>
          <div
            ref={contentRef}
            className="origin-top-left pointer-events-auto"
            style={{
              width: PREVIEW_WIDTH,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
            onClickCapture={blockNav}
          >
            <CmsEditProvider
              editable
              content={content}
              onContentChange={onContentChange}
              onSave={onSaveContent}
            >
              {tab === 'landing' && (
                <div className="bg-uf-black text-uf-silver" key={`landing-${plans.map((p) => `${p.code}:${p.price_monthly}:${p.active}`).join('|')}`}>
                  <div className="px-6 py-3 border-b border-white/5 text-xs text-uf-silver-dim flex justify-between">
                    <span className="font-black uf-text text-sm">Resolutoo</span>
                    <span>preview · /</span>
                  </div>
                  <Hero />
                  <Pricing />
                </div>
              )}
              {tab === 'demo' && (
                <DemoPage
                  key={`demo-${plans.map((p) => `${p.code}:${p.price_monthly}:${p.active}`).join('|')}`}
                  cmsPreview
                />
              )}
              {tab === 'assinar' && (
                <AssinarPreviewShell
                  key={`assinar-${plans.map((p) => `${p.code}:${p.price_monthly}:${p.active}`).join('|')}`}
                />
              )}
            </CmsEditProvider>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Seed payload aligned with FALLBACK_PLANS. */
export function defaultPlansSeed(): Array<PlanInfo & { sort_order: number }> {
  return FALLBACK_PLANS.map((p, i) => ({ ...p, sort_order: i }))
}
