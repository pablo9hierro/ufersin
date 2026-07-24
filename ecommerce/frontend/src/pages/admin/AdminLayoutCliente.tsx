import { useEffect, useRef, useState } from 'react'
import { Flame, Image as ImageIcon, ImagePlus, Loader2, Palette, Plus, Tags, Trash2, Wind } from 'lucide-react'
import Card from '../../components/ui/Card'
import SunsetCartIcon from '../../components/SunsetCartIcon'
import BackgroundScene from '../../components/BackgroundScene'
import { api, ApiError } from '../../lib/api'
import type { BadgesLayout, BgMode, BgSettings, DecorElementType, LandingBadge, PageDecoration, PageDecorationElement, PageKey } from '../../lib/types'

const MAX_BG_MB = 10

const PAGE_TABS: { key: PageKey; label: string; path: string | null }[] = [
  { key: 'landing', label: 'Landing', path: '/' },
  { key: 'catalogo', label: 'Catálogo', path: '/catalogo' },
  { key: 'favoritos', label: 'Favoritos', path: '/cliente/favoritos' },
  { key: 'cupons', label: 'Cupons', path: '/cliente/cupons' },
  { key: 'historico', label: 'Histórico', path: '/cliente/historico' },
  { key: 'cart_icon', label: 'Ícone do carrinho', path: null },
]

// Preview num tamanho fixo de celular (390×760), exibido reduzido via
// transform:scale — getBoundingClientRect() do container já escalado
// continua dando a proporção certa, então o x/y em % calculado ali bate
// exatamente com o x/y em % da página real (mesmo sistema de coordenadas
// dos dois lados, só que um visualmente menor).
const PREVIEW_W = 390
const PREVIEW_H = 760
const PREVIEW_SCALE = 0.8

// 'cart_icon' não é uma rota — é o botão flutuante do carrinho (64x64
// nativos), editado num preview quadrado ampliado só pra facilitar
// arrastar; o x/y salvo é % dessa caixinha, igual nas 5 páginas normais
// (que usam % da tela toda).
const CART_ICON_PREVIEW_SIZE = 240

function emptyDecoration(pageKey: PageKey): PageDecoration {
  return { page_key: pageKey, background_image_url: null, elements: [] }
}

function newElement(type: DecorElementType, pageKey: PageKey): PageDecorationElement {
  const base = { id: crypto.randomUUID(), type, opacity: 1, speed: 1 }
  if (pageKey === 'cart_icon') {
    if (type === 'smoke') return { ...base, x: 70, y: 20, width: 5, height: 12, blur: 3, count: 2 }
    return { ...base, x: 50, y: 85, width: 30, height: 45, blur: 1.5, count: 20 }
  }
  if (type === 'smoke') return { ...base, x: 82, y: 30, width: 10, height: 25, blur: 8, count: 3 }
  return { ...base, x: 50, y: 68, width: 133, height: 200, blur: 2, count: 40 }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

type RangeField = { key: 'blur' | 'count' | 'width' | 'height' | 'speed'; label: string; min: number; max: number; step: number; suffix?: string }

const SMOKE_FIELDS: RangeField[] = [
  { key: 'blur', label: 'Blur', min: 0, max: 20, step: 0.5, suffix: 'px' },
  { key: 'count', label: 'Fumaças', min: 1, max: 15, step: 1 },
  { key: 'width', label: 'Largura', min: 2, max: 40, step: 1, suffix: 'px' },
  { key: 'height', label: 'Altura', min: 5, max: 60, step: 1, suffix: 'px' },
  { key: 'speed', label: 'Velocidade', min: 0.2, max: 3, step: 0.1, suffix: 'x' },
]
const FIRE_FIELDS: RangeField[] = [
  { key: 'blur', label: 'Blur', min: 0, max: 15, step: 0.5, suffix: 'px' },
  { key: 'count', label: 'Bolinhas', min: 1, max: 96, step: 1 },
  { key: 'width', label: 'Largura', min: 50, max: 320, step: 1, suffix: 'px' },
  { key: 'height', label: 'Altura', min: 80, max: 420, step: 1, suffix: 'px' },
  { key: 'speed', label: 'Velocidade', min: 0.2, max: 3, step: 0.1, suffix: 'x' },
]

const BG_MODES: { value: BgMode; label: string }[] = [
  { value: 'svg1', label: 'Coqueiro (padrão)' },
  { value: 'synthwave', label: 'Synthwave' },
  { value: 'custom', label: 'Imagem própria' },
]

// Fundo do site (SunsetBackdrop) — escolhe entre os fundos prontos ou
// sobe uma imagem própria, e ajusta tamanho/posição/enquadramento do
// que estiver ativo. Fica salvo pra todo mundo que visita o site (não é
// um ajuste só do navegador do admin) — por isso o preview ao lado é
// só um rascunho local até clicar em "Salvar fundo". Movido de
// /admin/conta pra cá — é layout do site, faz mais sentido junto com o
// resto do layout de cliente.
function BackgroundSettingsCard() {
  const [draft, setDraft] = useState<BgSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.siteSettings.get().then((s) =>
      setDraft({ bg_mode: s.bg_mode, bg_image_url: s.bg_image_url, bg_scale: s.bg_scale, bg_x: s.bg_x, bg_y: s.bg_y, bg_fit: s.bg_fit })
    )
  }, [])

  const patch = (p: Partial<BgSettings>) => setDraft((d) => (d ? { ...d, ...p } : d))

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const { url } = await api.admin.products.uploadImage(file)
      patch({ bg_image_url: url, bg_mode: 'custom' })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao enviar a imagem.')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.admin.siteSettings.updateBackground(draft)
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar o fundo.')
    } finally {
      setSaving(false)
    }
  }

  if (!draft) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="bg-son-surface border border-white/5 rounded-2xl p-6 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {BG_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => patch({ bg_mode: m.value })}
              className="py-2.5 rounded-xl text-sm font-medium border border-white/10 bg-son-surface-light text-son-silver transition-colors"
            >
              {m.label}
            </button>
          ))}
        </div>

        {draft.bg_mode === 'custom' && (
          <div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden flex-shrink-0">
                {uploading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-son-silver-dim" />
                ) : draft.bg_image_url ? (
                  <img src={draft.bg_image_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-6 h-6 text-son-silver-dim/40" />
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="btn-secondary text-sm py-2 px-3"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                {draft.bg_image_url ? 'Trocar imagem' : 'Enviar imagem'}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-4 items-start">
          <div className="flex-1 space-y-3">
            <div>
              <label className="label">Tamanho — {(draft.bg_scale * 100).toFixed(0)}%</label>
              <input
                type="range"
                min={0.3}
                max={3}
                step={0.02}
                value={draft.bg_scale}
                onChange={(e) => patch({ bg_scale: parseFloat(e.target.value) })}
                className="w-full accent-son-pink"
              />
            </div>
            <div>
              <label className="label">Horizontal — {draft.bg_x}px</label>
              <input
                type="range"
                min={-400}
                max={400}
                step={2}
                value={draft.bg_x}
                onChange={(e) => patch({ bg_x: parseInt(e.target.value, 10) })}
                className="w-full accent-son-pink"
              />
            </div>
            <div>
              <label className="label">Vertical — {draft.bg_y}px</label>
              <input
                type="range"
                min={-400}
                max={400}
                step={2}
                value={draft.bg_y}
                onChange={(e) => patch({ bg_y: parseInt(e.target.value, 10) })}
                className="w-full accent-son-pink"
              />
            </div>
            {(draft.bg_mode === 'svg1' || draft.bg_mode === 'custom') && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => patch({ bg_fit: 'meet' })}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border ${
                    draft.bg_fit === 'meet' ? 'sunset-bg text-white border-transparent' : 'bg-son-surface-light border-white/10 text-son-silver'
                  }`}
                >
                  Ajustar (contido)
                </button>
                <button
                  type="button"
                  onClick={() => patch({ bg_fit: 'slice' })}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border ${
                    draft.bg_fit === 'slice' ? 'sunset-bg text-white border-transparent' : 'bg-son-surface-light border-white/10 text-son-silver'
                  }`}
                >
                  Cobrir (cheio)
                </button>
              </div>
            )}
          </div>

          {/* Preview proporcional — o MESMO componente usado no fundo
              real (BackgroundScene), só numa caixa pequena, refletindo o
              rascunho atual em tempo real antes de salvar de verdade. */}
          <div className="w-28 h-[200px] rounded-xl overflow-hidden border border-white/15 flex-shrink-0 relative bg-son-black">
            <BackgroundScene settings={draft} />
          </div>
        </div>

        {error && <p className="error-msg">{error}</p>}
        {saved && <p className="text-green-500 text-sm">Fundo salvo — já vale pra todo mundo que visita o site.</p>}
        <button onClick={save} disabled={saving} className="btn-primary text-sm py-2.5 px-3">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Salvar fundo
        </button>
      </div>
    </div>
  )
}

const LAYOUT_OPTIONS: { value: BadgesLayout; label: string }[] = [
  { value: 'row', label: 'Lado a lado' },
  { value: 'column', label: 'Um abaixo do outro' },
]

// Badges de texto do topo da landing — lista livre (editar/criar/
// remover), layout lado-a-lado ou empilhado, e espaçamento entre eles.
// Movido de /admin/conta pra cá pelo mesmo motivo do fundo do site.
function BadgesSettingsCard() {
  const [items, setItems] = useState<LandingBadge[] | null>(null)
  const [layout, setLayout] = useState<BadgesLayout>('row')
  const [gap, setGap] = useState(8)
  const [offsetY, setOffsetY] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.siteSettings.get().then((s) => {
      setItems(s.badges)
      setLayout(s.badges_layout)
      setGap(s.badges_gap)
      setOffsetY(s.badges_offset_y)
    })
  }, [])

  const patchItem = (id: string, p: Partial<LandingBadge>) =>
    setItems((prev) => (prev ? prev.map((b) => (b.id === id ? { ...b, ...p } : b)) : prev))

  const addItem = () =>
    setItems((prev) => [...(prev ?? []), { id: crypto.randomUUID(), text: '', bold: false }])

  const removeItem = (id: string) => setItems((prev) => (prev ? prev.filter((b) => b.id !== id) : prev))

  const save = async () => {
    if (!items) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const cleaned = items.map((b) => ({ ...b, text: b.text.trim() })).filter((b) => b.text)
      await api.admin.siteSettings.updateBadges({ badges: cleaned, badges_layout: layout, badges_gap: gap, badges_offset_y: offsetY })
      setItems(cleaned)
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar os badges.')
    } finally {
      setSaving(false)
    }
  }

  if (!items) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="bg-son-surface border border-white/5 rounded-2xl p-6 space-y-4">
        <div className="space-y-2">
          {items.map((b) => (
            <div key={b.id} className="flex items-center gap-2">
              <input
                className="input-field flex-1"
                value={b.text}
                onChange={(e) => patchItem(b.id, { text: e.target.value })}
                placeholder="Texto do badge"
              />
              <label className="flex items-center gap-1 text-xs text-son-silver flex-shrink-0">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-son-pink"
                  checked={b.bold}
                  onChange={(e) => patchItem(b.id, { bold: e.target.checked })}
                />
                Negrito
              </label>
              <button type="button" onClick={() => removeItem(b.id)} className="text-son-silver-dim hover:text-son-pink flex-shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-dashed border-son-gold/40 text-son-gold text-xs font-semibold hover:bg-son-gold/10"
          >
            <Plus className="w-3.5 h-3.5" /> Novo badge
          </button>
        </div>

        <div>
          <label className="label">Layout</label>
          <div className="flex gap-2">
            {LAYOUT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setLayout(o.value)}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                  layout === o.value ? 'sunset-bg text-white border-transparent' : 'bg-son-surface-light border-white/10 text-son-silver'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Espaçamento — {gap}px</label>
          <input type="range" min={0} max={32} step={1} value={gap} onChange={(e) => setGap(parseInt(e.target.value, 10))} className="w-full accent-son-pink" />
        </div>

        <div>
          <label className="label">Posição vertical — {offsetY}px {offsetY < 0 ? '(mais pra cima)' : offsetY > 0 ? '(mais pra baixo)' : ''}</label>
          <input
            type="range"
            min={-150}
            max={100}
            step={2}
            value={offsetY}
            onChange={(e) => setOffsetY(parseInt(e.target.value, 10))}
            className="w-full accent-son-pink"
          />
        </div>

        {error && <p className="error-msg">{error}</p>}
        {saved && <p className="text-green-500 text-sm">Badges salvos — já vale pra todo mundo.</p>}
        <button onClick={save} disabled={saving} className="btn-primary text-sm py-2.5 px-3">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Salvar badges
        </button>
      </div>
    </div>
  )
}

export default function AdminLayoutCliente() {
  const [pageKey, setPageKey] = useState<PageKey>('catalogo')
  const [byPage, setByPage] = useState<Partial<Record<PageKey, PageDecoration>>>({})
  const [loading, setLoading] = useState(true)
  const [bgUploading, setBgUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [selectedElId, setSelectedElId] = useState<string | null>(null)
  const [previewNonce, setPreviewNonce] = useState(0)
  const bgInputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const draggingId = useRef<string | null>(null)

  useEffect(() => {
    api.pageDecorations
      .list()
      .then((all) => {
        const map: Partial<Record<PageKey, PageDecoration>> = {}
        for (const d of all) map[d.page_key] = d
        setByPage(map)
      })
      .finally(() => setLoading(false))
  }, [])

  const current = byPage[pageKey] ?? emptyDecoration(pageKey)
  const selectedEl = current.elements.find((e) => e.id === selectedElId) ?? null

  const updateCurrent = (patch: Partial<PageDecoration>) => {
    setByPage((prev) => ({ ...prev, [pageKey]: { ...current, ...patch } }))
    setSaved(false)
  }

  const switchPage = (key: PageKey) => {
    setPageKey(key)
    setSelectedElId(null)
    setError(null)
    setSaved(false)
  }

  const handleBgChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    if (file.size > MAX_BG_MB * 1024 * 1024) {
      setError(`O arquivo tem ${(file.size / (1024 * 1024)).toFixed(1)}MB — o máximo é ${MAX_BG_MB}MB.`)
      return
    }
    setBgUploading(true)
    try {
      const { url } = await api.admin.products.uploadImage(file)
      updateCurrent({ background_image_url: url })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao enviar a imagem.')
    } finally {
      setBgUploading(false)
    }
  }

  const addElement = (type: DecorElementType) => {
    const el = newElement(type, pageKey)
    updateCurrent({ elements: [...current.elements, el] })
    setSelectedElId(el.id)
  }

  const removeElement = (id: string) => {
    updateCurrent({ elements: current.elements.filter((e) => e.id !== id) })
    if (selectedElId === id) setSelectedElId(null)
  }

  const patchElement = (id: string, patch: Partial<PageDecorationElement>) => {
    setByPage((prev) => {
      const c = prev[pageKey] ?? emptyDecoration(pageKey)
      return { ...prev, [pageKey]: { ...c, elements: c.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) } }
    })
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const result = await api.admin.pageDecorations.save(pageKey, current.background_image_url, current.elements)
      setByPage((prev) => ({ ...prev, [pageKey]: result }))
      setSaved(true)
      // Recarrega o preview pra refletir o que acabou de ser salvo — sem
      // isso o iframe (mesmo src) continua mostrando o layout antigo.
      setPreviewNonce((n) => n + 1)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o layout.')
    } finally {
      setSaving(false)
    }
  }

  const pinPointerDown = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    draggingId.current = id
    setSelectedElId(id)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const pinPointerMove = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingId.current !== id || !previewRef.current) return
    const rect = previewRef.current.getBoundingClientRect()
    const x = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100)
    const y = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100)
    patchElement(id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })
  }
  const pinPointerUp = () => {
    draggingId.current = null
  }

  const activeTab = PAGE_TABS.find((t) => t.key === pageKey)!
  const previewPath = activeTab.path ?? '/'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black">Layout das páginas do cliente</h1>
      </div>
      <p className="text-son-silver-dim text-sm mb-4">
        Escolha a página, envie uma imagem de fundo e adicione fumaça/fogo — arraste o elemento no preview pra posicionar; ele
        renderiza no mesmo lugar proporcional na página de verdade.
      </p>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-6">
        {PAGE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchPage(t.key)}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              pageKey === t.key ? 'sunset-bg text-white' : 'bg-son-surface border border-white/5 text-son-silver-dim hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-start">
          <div className="flex flex-col items-center gap-3">
            {pageKey === 'cart_icon' ? (
              <div
                className="relative rounded-2xl border border-white/10 overflow-hidden bg-son-black flex items-center justify-center"
                style={{ width: CART_ICON_PREVIEW_SIZE, height: CART_ICON_PREVIEW_SIZE }}
              >
                <div ref={previewRef} className="absolute inset-0">
                  {current.elements.map((el) => (
                    <div
                      key={el.id}
                      onPointerDown={pinPointerDown(el.id)}
                      onPointerMove={pinPointerMove(el.id)}
                      onPointerUp={pinPointerUp}
                      className={`absolute w-9 h-9 -ml-[18px] -mt-[18px] rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing border-2 z-10 ${
                        selectedElId === el.id ? 'border-son-gold' : 'border-white/40'
                      } ${el.type === 'smoke' ? 'bg-slate-500/70' : 'bg-orange-600/70'}`}
                      style={{ left: `${el.x}%`, top: `${el.y}%`, touchAction: 'none' }}
                    >
                      {el.type === 'smoke' ? <Wind className="w-4 h-4 text-white" /> : <Flame className="w-4 h-4 text-white" />}
                    </div>
                  ))}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <SunsetCartIcon scale={1.6} />
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="relative rounded-2xl border border-white/10 overflow-hidden"
                style={{ width: PREVIEW_W * PREVIEW_SCALE, height: PREVIEW_H * PREVIEW_SCALE, background: '#000' }}
              >
                <div
                  ref={previewRef}
                  className="relative"
                  style={{ width: PREVIEW_W, height: PREVIEW_H, transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}
                >
                  <iframe
                    key={pageKey}
                    src={`${previewPath}${previewPath.includes('?') ? '&' : '?'}_layoutPreview=${previewNonce}`}
                    title={`Preview ${activeTab.label}`}
                    className="absolute inset-0 w-full h-full border-0"
                    style={{ pointerEvents: 'none' }}
                  />
                  {current.elements.map((el) => (
                    <div
                      key={el.id}
                      onPointerDown={pinPointerDown(el.id)}
                      onPointerMove={pinPointerMove(el.id)}
                      onPointerUp={pinPointerUp}
                      className={`absolute w-9 h-9 -ml-[18px] -mt-[18px] rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing border-2 ${
                        selectedElId === el.id ? 'border-son-gold' : 'border-white/40'
                      } ${el.type === 'smoke' ? 'bg-slate-500/70' : 'bg-orange-600/70'}`}
                      style={{ left: `${el.x}%`, top: `${el.y}%`, touchAction: 'none' }}
                    >
                      {el.type === 'smoke' ? <Wind className="w-4 h-4 text-white" /> : <Flame className="w-4 h-4 text-white" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-son-silver-dim text-center max-w-[280px]">
              {pageKey === 'cart_icon'
                ? 'Preview ampliado do botão de carrinho (ele renderiza pequeno de verdade). Arraste os círculos pra posicionar ao redor dele.'
                : 'Preview em tamanho de celular (390×760). Arraste os círculos pra posicionar — a imagem de fundo mostrada é a última salva.'}
            </p>
          </div>

          <div className="space-y-4">
            {pageKey !== 'cart_icon' && (
            <Card className="p-5">
              <p className="font-bold text-white mb-1">Imagem de fundo</p>
              <p className="text-xs text-son-silver-dim mb-3">Fica atrás do conteúdo da página, cobrindo a tela toda.</p>
              <input
                ref={bgInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleBgChange}
              />
              <div className="flex items-center gap-3">
                <div className="w-20 h-20 rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden flex-shrink-0">
                  {bgUploading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-son-silver-dim" />
                  ) : current.background_image_url ? (
                    <img src={current.background_image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImagePlus className="w-6 h-6 text-son-silver-dim/40" />
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => bgInputRef.current?.click()}
                    disabled={bgUploading}
                    className="btn-secondary text-sm py-2 px-3"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    {current.background_image_url ? 'Trocar imagem' : 'Enviar imagem'}
                  </button>
                  {current.background_image_url && (
                    <button
                      type="button"
                      onClick={() => updateCurrent({ background_image_url: null })}
                      className="text-xs text-son-silver-dim hover:text-son-pink"
                    >
                      Remover imagem
                    </button>
                  )}
                </div>
              </div>
            </Card>
            )}

            <Card className="p-5">
              <p className="font-bold text-white mb-3">Elementos decorativos</p>
              <div className="flex gap-2 mb-3">
                <button type="button" onClick={() => addElement('smoke')} className="btn-secondary text-sm py-2 px-3">
                  <Plus className="w-3.5 h-3.5" />
                  <Wind className="w-3.5 h-3.5" /> Adicionar fumaça
                </button>
                <button type="button" onClick={() => addElement('fire')} className="btn-secondary text-sm py-2 px-3">
                  <Plus className="w-3.5 h-3.5" />
                  <Flame className="w-3.5 h-3.5" /> Adicionar fogo
                </button>
              </div>
              {current.elements.length === 0 ? (
                <p className="text-xs text-son-silver-dim">Nenhum elemento nessa página ainda.</p>
              ) : (
                <ul className="space-y-1.5">
                  {current.elements.map((el) => (
                    <li key={el.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedElId(el.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left ${
                          selectedElId === el.id ? 'bg-son-gold/10 border border-son-gold text-white' : 'bg-son-surface-light border border-transparent text-son-silver-dim hover:text-white'
                        }`}
                      >
                        {el.type === 'smoke' ? <Wind className="w-4 h-4" /> : <Flame className="w-4 h-4" />}
                        {el.type === 'smoke' ? 'Fumaça' : 'Fogo'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {selectedEl && (
              <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-white flex items-center gap-1.5">
                    {selectedEl.type === 'smoke' ? <Wind className="w-4 h-4" /> : <Flame className="w-4 h-4" />}
                    {selectedEl.type === 'smoke' ? 'Fumaça' : 'Fogo'} selecionado
                  </p>
                  <button type="button" onClick={() => removeElement(selectedEl.id)} className="text-son-silver-dim hover:text-son-pink">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {(selectedEl.type === 'smoke' ? SMOKE_FIELDS : FIRE_FIELDS).map((f) => (
                  <div key={f.key}>
                    <label className="label">
                      {f.label} — {selectedEl[f.key]}
                      {f.suffix ?? ''}
                    </label>
                    <input
                      type="range"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={selectedEl[f.key]}
                      onChange={(e) => patchElement(selectedEl.id, { [f.key]: parseFloat(e.target.value) } as Partial<PageDecorationElement>)}
                      className="w-full accent-son-pink"
                    />
                  </div>
                ))}
                <div>
                  <label className="label">Opacidade — {Math.round(selectedEl.opacity * 100)}%</label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(selectedEl.opacity * 100)}
                    onChange={(e) => patchElement(selectedEl.id, { opacity: parseInt(e.target.value, 10) / 100 })}
                    className="w-full accent-son-pink"
                  />
                </div>
              </Card>
            )}

            {error && <p className="error-msg">{error}</p>}
            <button onClick={save} disabled={saving} className="btn-primary text-sm py-2.5 px-4">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Salvar layout
            </button>
            {saved && <p className="text-green-500 text-sm">Layout salvo — já vale pra todo mundo.</p>}
          </div>
        </div>
      )}

      <div className="mt-10 space-y-10">
        <div>
          <h2 className="text-2xl font-black mb-1 flex items-center gap-2">
            <Palette className="w-5 h-5" /> Fundo do site
          </h2>
          <p className="text-son-silver-dim text-sm mb-6">
            Escolha o coqueiro padrão, o synthwave, as estrelas, ou envie uma imagem própria — e ajuste tamanho/posição.
          </p>
          <BackgroundSettingsCard />
        </div>

        <div>
          <h2 className="text-2xl font-black mb-1 flex items-center gap-2">
            <Tags className="w-5 h-5" /> Badges da landing
          </h2>
          <p className="text-son-silver-dim text-sm mb-6">
            Textos que aparecem no topo da página inicial — crie, edite, remova, escolha o layout e o espaçamento.
          </p>
          <BadgesSettingsCard />
        </div>
      </div>
    </div>
  )
}
