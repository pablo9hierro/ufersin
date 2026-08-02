import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FileUp,
  ImagePlus,
  Loader2,
  Package,
  Sparkles,
  Trash2,
  Barcode,
  AlertCircle,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import BarcodePreview from '../../components/admin/BarcodePreview'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import { buildProductPayload } from '../../lib/productHelpers'
import { parseNfeFiles } from '../../lib/nfeXml'
import {
  composeNfeDescription,
  emptyNfeForm,
  isDraftReadyToSave,
  loadNfeImportDrafts,
  newNfeDraftId,
  saveNfeImportDrafts,
  type NfeImportDraft,
  type NfeImportForm,
} from '../../lib/nfeImportDrafts'
import type { Category } from '../../types'

function generateBarcode(): string {
  return `${String(Date.now()).slice(-10)}${String(Math.floor(Math.random() * 90) + 10)}`
}

const UNIT_OPTIONS: { value: NfeImportForm['unit']; label: string }[] = [
  { value: '', label: 'Selecionar…' },
  { value: 'un', label: 'un (unidade)' },
  { value: 'kg', label: 'kg (quilo)' },
  { value: 'mt', label: 'mt (metro)' },
]

const MANUAL_FIELDS = [
  'Preço de venda (revenda)',
  'Alerta de estoque baixo (repor ao chegar em)',
  'Categoria',
  'Imagem',
  'Unidade padronizada (se a NF não mapear para un/kg/mt)',
]

export default function AdminProdutosXml() {
  const [drafts, setDrafts] = useState<NfeImportDraft[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const { askConfirm, confirmDialogElement } = useConfirmDialog()

  useEffect(() => {
    const loaded = loadNfeImportDrafts()
    setDrafts(loaded)
    const firstIncomplete = loaded.findIndex((d) => d.status === 'incomplete')
    setActiveIndex(firstIncomplete >= 0 ? firstIncomplete : 0)
    setHydrated(true)
    adminService.categories.list().then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveNfeImportDrafts(drafts)
  }, [drafts, hydrated])

  const updateActiveForm = (patch: Partial<NfeImportForm>) => {
    setDrafts((prev) => {
      const i = activeIndex
      if (i < 0 || i >= prev.length) return prev
      const copy = [...prev]
      const d = copy[i]
      copy[i] = {
        ...d,
        updatedAt: new Date().toISOString(),
        form: { ...d.form, ...patch },
        status: d.status === 'saved' ? 'saved' : 'incomplete',
      }
      return copy
    })
  }

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    setParseErrors([])
    const { results, errors } = await parseNfeFiles(files)
    if (errors.length) {
      setParseErrors(errors.map((x) => `${x.fileName}: ${x.message}`))
    }
    if (!results.length) return

    const now = new Date().toISOString()
    const created: NfeImportDraft[] = []
    for (const { fileName, parsed } of results) {
      for (const line of parsed.lines) {
        const form = emptyNfeForm()
        form.name = line.xProd
        form.supplier_code = line.cProd
        form.ncm = line.ncm
        form.cfop = line.cfop
        form.barcode = line.barcode
        form.cost_price = line.vUnCom != null ? String(Number(line.vUnCom.toFixed(4))) : ''
        form.quantity = line.qCom != null ? String(Math.round(line.qCom * 10000) / 10000) : ''
        form.unit = line.unit
        form.unit_raw = line.uCom
        form.price = ''
        form.low_stock_threshold = ''
        form.category_id = ''
        form.image_url = ''
        form.description = ''
        created.push({
          id: newNfeDraftId(),
          status: 'incomplete',
          collapsed: false,
          createdAt: now,
          updatedAt: now,
          source: {
            fileName,
            chNFe: parsed.chNFe,
            nNF: parsed.nNF,
            nItem: line.nItem,
            emitName: parsed.emitName,
          },
          form,
        })
      }
    }
    setDrafts((prev) => {
      const next = [...prev, ...created]
      setActiveIndex(prev.length)
      return next
    })
  }

  const active = drafts[activeIndex] ?? null

  const go = (dir: -1 | 1) => {
    if (!drafts.length) return
    setActiveIndex((i) => {
      const n = i + dir
      if (n < 0) return drafts.length - 1
      if (n >= drafts.length) return 0
      return n
    })
  }

  const toggleCollapse = (id: string) => {
    setDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, collapsed: !d.collapsed, updatedAt: new Date().toISOString() } : d))
    )
  }

  const removeDraft = (id: string) => {
    askConfirm('Deseja remover mesmo?', () => {
      setDrafts((prev) => {
        const next = prev.filter((d) => d.id !== id)
        setActiveIndex((i) => Math.min(i, Math.max(0, next.length - 1)))
        return next
      })
    })
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !active) return
    setUploadError(null)
    setUploading(true)
    try {
      const { url } = await adminService.products.uploadImage(file)
      updateActiveForm({ image_url: url })
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Erro ao enviar a imagem.')
    } finally {
      setUploading(false)
    }
  }

  const saveToCatalog = async () => {
    if (!active || active.status === 'saved') return
    const err = isDraftReadyToSave(active.form)
    if (err) {
      setSaveError(err)
      return
    }
    setSaveError(null)
    setSaving(true)
    try {
      const description = composeNfeDescription(active.form)
      const payload = buildProductPayload({
        name: active.form.name,
        description: description ?? '',
        price: active.form.price,
        quantity: active.form.quantity,
        image_url: active.form.image_url,
        category_id: active.form.category_id,
        barcode: active.form.barcode,
        cost_price: active.form.cost_price,
        low_stock_threshold: active.form.low_stock_threshold,
      })
      const created = await adminService.products.create(payload)
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === active.id
            ? {
                ...d,
                status: 'saved',
                collapsed: true,
                catalogProductId: created.id,
                updatedAt: new Date().toISOString(),
              }
            : d
        )
      )
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Falha ao salvar no catálogo.')
    } finally {
      setSaving(false)
    }
  }

  const incompleteCount = drafts.filter((d) => d.status === 'incomplete').length
  const formOpen = active && !active.collapsed

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link to="/admin/produtos" className="btn-secondary text-sm py-2 px-3">
            <ArrowLeft className="w-4 h-4" /> Produtos
          </Link>
          <h1 className="text-2xl font-black">Importar XML (NF-e)</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            multiple
            className="hidden"
            onChange={handleFiles}
          />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary text-sm py-2 px-4">
            <FileUp className="w-4 h-4" /> Enviar XML
          </button>
        </div>
      </div>

      <Card className="p-4 mb-6">
        <p className="text-sm text-son-silver-dim mb-2">
          Envie uma ou várias notas. Cada linha de produto vira um rascunho. Rascunhos incompletos ficam salvos neste
          navegador (por loja) até você preencher e salvar no catálogo.
          {incompleteCount > 0 ? (
            <span className="text-son-pink font-semibold"> {incompleteCount} pendente(s).</span>
          ) : null}
        </p>
        <p className="text-xs text-son-silver-dim mb-3">
          Preenchidos da NF-e quando existirem: nome, cód. fornecedor, código de barras, custo unitário, quantidade,
          NCM, unidade. Preencha manualmente o que a nota não traz:
        </p>
        <ul className="text-xs text-amber-400/90 list-disc pl-5 space-y-0.5">
          {MANUAL_FIELDS.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </Card>

      {parseErrors.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300 space-y-1">
          {parseErrors.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="text-center py-16 text-son-silver-dim">
          <FileUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Nenhum rascunho ainda. Envie um XML de NF-e para começar.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-hide">
            {drafts.map((d, i) => {
              const incomplete = d.status === 'incomplete'
              const selected = i === activeIndex
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setActiveIndex(i)
                    if (d.collapsed) toggleCollapse(d.id)
                  }}
                  className={`shrink-0 min-w-[140px] max-w-[200px] rounded-xl px-3 py-2.5 text-left text-xs transition-colors border ${
                    incomplete ? 'border-red-500/70' : 'border-emerald-500/50'
                  } ${selected ? 'bg-white/10' : 'bg-son-surface hover:bg-white/5'}`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    {d.status === 'saved' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    )}
                    <span className="font-bold text-white truncate">#{i + 1}</span>
                  </div>
                  <p className="text-son-silver truncate">{d.form.name || 'Sem nome'}</p>
                  <p className="text-son-silver-dim truncate mt-0.5">
                    {d.status === 'saved' ? 'Salvo no catálogo' : 'Incompleto'}
                  </p>
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between mb-4">
            <button type="button" onClick={() => go(-1)} className="btn-secondary py-2 px-3" aria-label="Anterior">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <p className="text-sm text-son-silver-dim">
              Produto {activeIndex + 1} de {drafts.length}
            </p>
            <button type="button" onClick={() => go(1)} className="btn-secondary py-2 px-3" aria-label="Próximo">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {active && (
            <Card
              className={`p-5 border ${
                active.status === 'incomplete' ? 'border-red-500/60' : 'border-emerald-500/40'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <h3 className="font-bold text-white truncate">{active.form.name || 'Produto'}</h3>
                  <p className="text-xs text-son-silver-dim mt-1">
                    NF {active.source.nNF || '—'} · item {active.source.nItem} · {active.source.emitName || active.source.fileName}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(active.id)}
                    className="btn-secondary text-sm py-2 px-3"
                  >
                    {active.collapsed ? 'Expandir' : 'Recolher'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDraft(active.id)}
                    className="btn-secondary text-sm py-2 px-3 hover:text-son-pink"
                    title="Remover rascunho"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {formOpen ? (
                <div className="space-y-3">
                  {active.status === 'saved' && (
                    <p className="text-sm text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Já salvo no catálogo. Você pode editar o rascunho, mas não
                      recria o produto.
                    </p>
                  )}

                  <div>
                    <label className="label">Nome</label>
                    <input
                      className="input-field"
                      value={active.form.name}
                      onChange={(e) => updateActiveForm({ name: e.target.value })}
                      disabled={active.status === 'saved'}
                    />
                    <p className="text-[10px] text-son-silver-dim mt-1">NF-e: xProd</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Cód. fornecedor</label>
                      <input
                        className="input-field"
                        value={active.form.supplier_code}
                        onChange={(e) => updateActiveForm({ supplier_code: e.target.value })}
                        disabled={active.status === 'saved'}
                      />
                      <p className="text-[10px] text-son-silver-dim mt-1">NF-e: cProd</p>
                    </div>
                    <div>
                      <label className="label">NCM</label>
                      <input
                        className="input-field"
                        value={active.form.ncm}
                        onChange={(e) => updateActiveForm({ ncm: e.target.value })}
                        disabled={active.status === 'saved'}
                      />
                      <p className="text-[10px] text-son-silver-dim mt-1">NF-e: NCM</p>
                    </div>
                  </div>

                  <div>
                    <label className="label">Descrição (opcional)</label>
                    <textarea
                      className="input-field"
                      rows={2}
                      value={active.form.description}
                      onChange={(e) => updateActiveForm({ description: e.target.value })}
                      disabled={active.status === 'saved'}
                      placeholder="Texto livre — cód. fornecedor/NCM/unidade entram automaticamente ao salvar"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">
                        Preço de venda <span className="text-amber-400">*</span>
                      </label>
                      <input
                        className="input-field border-amber-500/40"
                        type="number"
                        step="0.01"
                        placeholder="Preencher manualmente"
                        value={active.form.price}
                        onChange={(e) => updateActiveForm({ price: e.target.value })}
                        disabled={active.status === 'saved'}
                      />
                      <p className="text-[10px] text-amber-400/80 mt-1">Não vem da NF-e</p>
                    </div>
                    <div>
                      <label className="label">Estoque</label>
                      <input
                        className="input-field"
                        type="number"
                        step="any"
                        value={active.form.quantity}
                        onChange={(e) => updateActiveForm({ quantity: e.target.value })}
                        disabled={active.status === 'saved'}
                      />
                      <p className="text-[10px] text-son-silver-dim mt-1">NF-e: qCom (sugestão)</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Valor de custo</label>
                      <input
                        className="input-field"
                        type="number"
                        step="0.01"
                        value={active.form.cost_price}
                        onChange={(e) => updateActiveForm({ cost_price: e.target.value })}
                        disabled={active.status === 'saved'}
                      />
                      <p className="text-[10px] text-son-silver-dim mt-1">NF-e: vUnCom</p>
                    </div>
                    <div>
                      <label className="label">Repor ao chegar em</label>
                      <input
                        className="input-field border-amber-500/40"
                        type="number"
                        placeholder="Opcional — manual"
                        value={active.form.low_stock_threshold}
                        onChange={(e) => updateActiveForm({ low_stock_threshold: e.target.value })}
                        disabled={active.status === 'saved'}
                      />
                      <p className="text-[10px] text-amber-400/80 mt-1">Não vem da NF-e</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Unidade</label>
                      <select
                        className="input-field"
                        value={active.form.unit}
                        onChange={(e) => updateActiveForm({ unit: e.target.value as NfeImportForm['unit'] })}
                        disabled={active.status === 'saved'}
                      >
                        {UNIT_OPTIONS.map((o) => (
                          <option key={o.value || 'empty'} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-son-silver-dim mt-1">
                        NF-e: uCom{active.form.unit_raw ? ` = ${active.form.unit_raw}` : ''}
                        {!active.form.unit ? ' — selecione se não mapeou' : ''}
                      </p>
                    </div>
                    <div>
                      <label className="label">Categoria</label>
                      <select
                        className="input-field border-amber-500/40"
                        value={active.form.category_id}
                        onChange={(e) => updateActiveForm({ category_id: e.target.value })}
                        disabled={active.status === 'saved'}
                      >
                        <option value="">Sem categoria (manual)</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-amber-400/80 mt-1">Não vem da NF-e</p>
                    </div>
                  </div>

                  <div>
                    <label className="label flex items-center gap-1.5">
                      <Barcode className="w-3.5 h-3.5" /> Código de barras
                    </label>
                    <div className="flex gap-2">
                      <input
                        className="input-field"
                        placeholder="cEAN da nota ou gere um"
                        value={active.form.barcode}
                        onChange={(e) => updateActiveForm({ barcode: e.target.value })}
                        disabled={active.status === 'saved'}
                      />
                      <button
                        type="button"
                        onClick={() => updateActiveForm({ barcode: generateBarcode() })}
                        className="btn-secondary text-sm py-2 px-3 flex-shrink-0"
                        disabled={active.status === 'saved'}
                      >
                        <Sparkles className="w-3.5 h-3.5" /> Gerar
                      </button>
                    </div>
                    <p className="text-[10px] text-son-silver-dim mt-1">NF-e: cEAN (ignora SEM GTIN)</p>
                    {active.form.barcode && (
                      <div className="mt-2">
                        <BarcodePreview value={active.form.barcode} productName={active.form.name} />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="label">Imagem</label>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageChange}
                    />
                    <div className="flex items-center gap-3">
                      <div className="w-20 h-20 rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden flex-shrink-0 border border-amber-500/30">
                        {uploading ? (
                          <Loader2 className="w-5 h-5 animate-spin text-son-silver-dim" />
                        ) : active.form.image_url ? (
                          <img src={active.form.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-6 h-6 text-son-silver-dim/40" />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={uploading || active.status === 'saved'}
                        className="btn-secondary text-sm py-2 px-3"
                      >
                        <ImagePlus className="w-3.5 h-3.5" />
                        {active.form.image_url ? 'Trocar imagem' : 'Enviar imagem'}
                      </button>
                    </div>
                    <p className="text-[10px] text-amber-400/80 mt-1">Não vem da NF-e (opcional no catálogo)</p>
                    {uploadError && <p className="error-msg mt-1">{uploadError}</p>}
                  </div>

                  {saveError && <p className="error-msg">{saveError}</p>}

                  {active.status !== 'saved' && (
                    <button type="button" onClick={saveToCatalog} disabled={saving} className="btn-primary w-full mt-2">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Salvar para catálogo
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleCollapse(active.id)}
                  className="w-full text-left text-sm text-son-silver-dim hover:text-white py-2"
                >
                  Formulário recolhido — clique para expandir e {active.status === 'saved' ? 'revisar' : 'concluir'}.
                </button>
              )}
            </Card>
          )}
        </>
      )}

      {confirmDialogElement}
    </div>
  )
}
