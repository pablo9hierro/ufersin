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
  X,
  Pencil,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import BarcodePreview from '../../components/admin/BarcodePreview'
import CategorySelectField from '../../components/admin/CategorySelectField'
import PackageUnitFields from '../../components/admin/PackageUnitFields'
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

/** max-w-md (28rem) + 30% */
const DIALOG_MAX = 'max-w-[36.4rem]'

const MANUAL_FIELDS = [
  'Preço de venda (revenda)',
  'Alerta de estoque baixo (repor ao chegar em)',
  'Categoria',
  'Imagem',
  'Unidade padronizada (un/kg/mt/pacote)',
]

export default function AdminProdutosXml() {
  const [drafts, setDrafts] = useState<NfeImportDraft[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
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

  const openDraft = (i: number) => {
    setActiveIndex(i)
    setSaveError(null)
    setUploadError(null)
    setModalOpen(true)
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
      const firstNew = prev.length
      setActiveIndex(firstNew)
      setModalOpen(true)
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
    setSaveError(null)
    setUploadError(null)
  }

  const removeDraft = (id: string) => {
    const draft = drafts.find((d) => d.id === id)
    const catalogProductId = draft?.status === 'saved' ? draft.catalogProductId : undefined
    const message = catalogProductId
      ? 'Este produto já foi salvo no catálogo. Remover aqui também vai excluí-lo de Produtos. Deseja remover mesmo?'
      : 'Deseja remover mesmo?'
    askConfirm(message, async () => {
      if (catalogProductId) {
        try {
          await adminService.products.delete(catalogProductId)
        } catch (e) {
          setSaveError(e instanceof ApiError ? e.message : 'Falha ao excluir do catálogo.')
          return
        }
      }
      setDrafts((prev) => {
        const next = prev.filter((d) => d.id !== id)
        setActiveIndex((i) => Math.min(i, Math.max(0, next.length - 1)))
        if (next.length === 0) setModalOpen(false)
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
    if (!active) return
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
      if (active.status === 'saved' && active.catalogProductId) {
        await adminService.products.update(active.catalogProductId, payload)
        setDrafts((prev) =>
          prev.map((d) =>
            d.id === active.id ? { ...d, status: 'saved', updatedAt: new Date().toISOString() } : d
          )
        )
      } else {
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
      }
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Falha ao salvar no catálogo.')
    } finally {
      setSaving(false)
    }
  }

  const incompleteCount = drafts.filter((d) => d.status === 'incomplete').length

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
          Envie NF-e de <span className="text-emerald-400 font-semibold">entrada/compra do distribuidor</span> (não
          funciona com XML de saída/emissão da loja). Cada linha vira um rascunho neste navegador até você completar e
          salvar no catálogo.
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
          <p>Nenhum rascunho ainda. Envie um XML de NF-e de entrada para começar.</p>
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-hide">
          {drafts.map((d, i) => {
            const incomplete = d.status === 'incomplete'
            const selected = i === activeIndex && modalOpen
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => openDraft(i)}
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
                <p className="text-son-silver-dim truncate mt-0.5 flex items-center gap-1">
                  {d.status === 'saved' ? 'Salvo no catálogo' : 'Incompleto'}
                  <Pencil className="w-3 h-3 opacity-60" />
                </p>
              </button>
            )
          })}
        </div>
      )}

      {modalOpen && active && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setModalOpen(false)}
          data-testid="xml-product-modal-overlay"
        >
          <div className="flex items-center gap-2 sm:gap-3 w-full justify-center max-w-[min(100%,48rem)]">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                go(-1)
              }}
              className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-[#c4b45a] hover:bg-[#d4c46a] text-[#1a1a0a] font-black text-xl flex items-center justify-center shadow-lg"
              aria-label="Produto anterior"
              data-testid="xml-nav-prev"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            <div
              className={`glass rounded-2xl p-6 ${DIALOG_MAX} w-full max-h-[90vh] overflow-y-auto`}
              onClick={(e) => e.stopPropagation()}
              data-testid="xml-product-modal"
            >
              <div className="flex items-center justify-between mb-4 gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-white truncate">
                    {active.status === 'saved' ? 'Editar produto (XML)' : 'Completar cadastro (XML)'}
                  </h3>
                  <p className="text-xs text-son-silver-dim mt-0.5">
                    Produto {activeIndex + 1} de {drafts.length} · NF {active.source.nNF || '—'} · item{' '}
                    {active.source.nItem} · {active.source.emitName || active.source.fileName}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => removeDraft(active.id)}
                    className="text-son-silver-dim hover:text-son-pink"
                    title="Remover rascunho"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="text-son-silver-dim hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {active.status === 'saved' && (
                  <p className="text-sm text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Já no catálogo — edite e salve de novo para atualizar.
                  </p>
                )}

                <section className="rounded-xl border-2 border-emerald-500/60 bg-emerald-500/5 p-4 space-y-3">
                  <h4 className="text-sm font-bold text-emerald-400">Dados capturados pelo xml:</h4>
                  <div>
                    <label className="label">Nome</label>
                    <input
                      className="input-field"
                      value={active.form.name}
                      onChange={(e) => updateActiveForm({ name: e.target.value })}
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
                      />
                      <p className="text-[10px] text-son-silver-dim mt-1">NF-e: cProd</p>
                    </div>
                    <div>
                      <label className="label">NCM</label>
                      <input
                        className="input-field"
                        value={active.form.ncm}
                        onChange={(e) => updateActiveForm({ ncm: e.target.value })}
                      />
                      <p className="text-[10px] text-son-silver-dim mt-1">NF-e: NCM</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Estoque</label>
                      <input
                        className="input-field"
                        type="number"
                        step="any"
                        value={active.form.quantity}
                        onChange={(e) => updateActiveForm({ quantity: e.target.value })}
                      />
                      <p className="text-[10px] text-son-silver-dim mt-1">NF-e: qCom</p>
                    </div>
                    <div>
                      <label className="label">Valor de custo</label>
                      <input
                        className="input-field"
                        type="number"
                        step="0.01"
                        value={active.form.cost_price}
                        onChange={(e) => updateActiveForm({ cost_price: e.target.value })}
                      />
                      <p className="text-[10px] text-son-silver-dim mt-1">NF-e: vUnCom</p>
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
                      />
                      <button
                        type="button"
                        onClick={() => updateActiveForm({ barcode: generateBarcode() })}
                        className="btn-secondary text-sm py-2 px-3 flex-shrink-0"
                      >
                        <Sparkles className="w-3.5 h-3.5" /> Gerar
                      </button>
                    </div>
                    <p className="text-[10px] text-son-silver-dim mt-1">NF-e: cEAN</p>
                    {active.form.barcode && (
                      <div className="mt-2">
                        <BarcodePreview value={active.form.barcode} productName={active.form.name} />
                      </div>
                    )}
                  </div>
                  <PackageUnitFields
                    value={{
                      unit: active.form.unit,
                      package_qty: active.form.package_qty,
                      package_content_unit: active.form.package_content_unit,
                    }}
                    onChange={(patch) => updateActiveForm(patch)}
                    hint={`NF-e: uCom${active.form.unit_raw ? ` = ${active.form.unit_raw}` : ''}`}
                  />
                </section>

                <section className="rounded-xl border-2 border-red-500/60 bg-red-500/5 p-4 space-y-3">
                  <h4 className="text-sm font-bold text-red-400">Dados para complementar cadastro do produto:</h4>
                  <div>
                    <label className="label">Descrição (opcional)</label>
                    <textarea
                      className="input-field"
                      rows={2}
                      value={active.form.description}
                      onChange={(e) => updateActiveForm({ description: e.target.value })}
                      placeholder="Texto livre"
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
                      />
                    </div>
                    <div>
                      <label className="label">
                        Repor ao chegar em <span className="text-amber-400">*</span>
                      </label>
                      <input
                        className="input-field border-amber-500/40"
                        type="number"
                        placeholder="Obrigatório"
                        value={active.form.low_stock_threshold}
                        onChange={(e) => updateActiveForm({ low_stock_threshold: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">
                      Categoria <span className="text-amber-400">*</span>
                    </label>
                    <CategorySelectField
                      categories={categories}
                      value={active.form.category_id}
                      onChange={(category_id) => updateActiveForm({ category_id })}
                      onCreateCategory={async (name) => {
                        const created = await adminService.categories.create(name)
                        setCategories((prev) =>
                          prev.some((c) => c.id === created.id) ? prev : [...prev, created]
                        )
                        return created
                      }}
                    />
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
                        disabled={uploading}
                        className="btn-secondary text-sm py-2 px-3"
                      >
                        <ImagePlus className="w-3.5 h-3.5" />
                        {active.form.image_url ? 'Trocar imagem' : 'Enviar imagem'}
                      </button>
                    </div>
                    {uploadError && <p className="error-msg mt-1">{uploadError}</p>}
                  </div>
                </section>

                {saveError && <p className="error-msg">{saveError}</p>}

                <button type="button" onClick={saveToCatalog} disabled={saving} className="btn-primary w-full mt-1">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Salvar
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                go(1)
              }}
              className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-[#c4b45a] hover:bg-[#d4c46a] text-[#1a1a0a] font-black text-xl flex items-center justify-center shadow-lg"
              aria-label="Próximo produto"
              data-testid="xml-nav-next"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}

      {confirmDialogElement}
    </div>
  )
}
