import { useCallback, useEffect, useState } from 'react'
import {
  ClipboardList, Loader2, CheckSquare, Square, Plus, X, Wrench, PackageCheck,
  FileText, ShieldCheck, Eye, Download, RotateCcw, AlertTriangle, Boxes,
} from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { ServiceOrderDto, ServiceOrderUpdateDto, ChecklistItem, StockItemDto } from '../../lib/eletronicosAdminApi'
import type { ServiceRequestDto } from '../../lib/eletronicosApi'
import { generateServiceOrderPdf } from '../../lib/eletronicosPdf'
import { useTenantConfig } from '../../hooks/useTenantConfig'

// Port 1:1 de src/components/ServiceOrderPanel.tsx do vrtech (1215 linhas)
// -- checklist de avaliação por componente (com vínculo automático a peça
// de estoque, cadastro dinâmico de peça nova, busca de peça similar de
// outro modelo), timeline de atualizações por componente, conclusão com
// valor/observação/garantia por item (itens já comprometidos numa
// conclusão anterior ficam travados numa reabertura), resumo fechado com
// PDF (prévia/gerar/baixar) e reabertura (bloqueada se todas as garantias
// já expiraram). Adaptado pro motor Resolutoo: upload via
// eletronicosAdmin.uploadMedia em vez de Supabase Storage direto, sem
// canal realtime (Rust não expõe um -- os dados são recarregados a cada
// ação local, que já é quem os modifica).

const SERVICE_ORDER_COMPONENTS = [
  'Touch', 'Display/Tela', 'Carcaça', 'Botões', 'Sinal/Rede', 'Alto-falante',
  'Sensores', 'Microfone', 'Conector de carga', 'Bateria', 'Face ID / Digital',
  'Vibração', 'Câmeras', 'Flash', 'Wi-Fi / Bluetooth', 'Outro',
] as const

const ACTIVE_STATUSES = ['in_progress', 'em_entrega', 'completed', 'em_pagamento', 'delivered', 'finished']
export function isServiceOrderStatus(status: string) {
  return ACTIVE_STATUSES.includes(status)
}

function computeWarrantyExpiry(addedAt: string | null | undefined, warrantyDays: number | null | undefined): Date | null {
  if (!warrantyDays || !addedAt) return null
  const expiry = new Date(addedAt)
  expiry.setDate(expiry.getDate() + warrantyDays)
  return expiry
}
function isWarrantyActive(addedAt: string | null | undefined, warrantyDays: number | null | undefined): boolean {
  const expiry = computeWarrantyExpiry(addedAt, warrantyDays)
  return !!expiry && new Date() <= expiry
}

function buildInitialChecklist(): ChecklistItem[] {
  return SERVICE_ORDER_COMPONENTS.map((component) => ({
    component, checked: false, description: '', media_urls: [],
    value: null, note: null, warranty_days: null, stock_item_id: null, added_at: null,
  }))
}

async function downloadPdf(url: string, fileName: string) {
  const res = await fetch(url)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

const INPUT = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#e0211a] transition-colors'
const LABEL = 'block text-xs text-gray-500 mb-1'

export default function EletronicaServiceOrderPanel({
  request, status, readOnly = false, onQuoteValueChange, onOrderStateChange,
}: {
  request: ServiceRequestDto
  status: string
  readOnly?: boolean
  onQuoteValueChange?: (value: number) => void
  onOrderStateChange?: (state: { closed: boolean; hasUpdate: boolean }) => void
}) {
  const tenantConfig = useTenantConfig()
  const requestId = request.id
  const [order, setOrder] = useState<ServiceOrderDto | null>(null)
  const [updates, setUpdates] = useState<ServiceOrderUpdateDto[]>([])
  const [loading, setLoading] = useState(true)
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [checklistFiles, setChecklistFiles] = useState<Record<number, File[]>>({})
  const [savingChecklist, setSavingChecklist] = useState(false)

  const [updatingComponent, setUpdatingComponent] = useState<string | null>(null)
  const [updateText, setUpdateText] = useState('')
  const [updateFiles, setUpdateFiles] = useState<File[]>([])
  const [addingUpdate, setAddingUpdate] = useState(false)

  const [completedServices, setCompletedServices] = useState('')
  const [savingCompletion, setSavingCompletion] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [previewingPdf, setPreviewingPdf] = useState(false)
  const [confirmingReopen, setConfirmingReopen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [reopening, setReopening] = useState(false)

  const [conclusionNoteDrafts, setConclusionNoteDrafts] = useState<Record<number, string>>({})

  const [stockItems, setStockItems] = useState<StockItemDto[]>([])
  const [pendingStockItem, setPendingStockItem] = useState<{ idx: number; name: string } | null>(null)
  const [newPartStock, setNewPartStock] = useState('')
  const [newPartPrice, setNewPartPrice] = useState('')
  const [newPartWarranty, setNewPartWarranty] = useState('')
  const [creatingPart, setCreatingPart] = useState(false)
  const [partError, setPartError] = useState<string | null>(null)
  const [similarSearch, setSimilarSearch] = useState('')
  const [similarSearchOpen, setSimilarSearchOpen] = useState(false)
  const [checklistError, setChecklistError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const existing = await eletronicosAdmin.serviceOrders.getOrCreate(requestId)
    setOrder(existing)
    setChecklist(existing.checklist?.length ? existing.checklist : buildInitialChecklist())
    const ups = await eletronicosAdmin.serviceOrders.listUpdates(existing.id)
    setUpdates([...ups].sort((a, b) => a.created_at.localeCompare(b.created_at)))
    try {
      const saved = JSON.parse(localStorage.getItem(`os-drafts-${existing.id}`) ?? '{}')
      setCompletedServices(saved.completedServices ?? existing.completed_services ?? '')
      if (saved.conclusionNoteDrafts) setConclusionNoteDrafts(saved.conclusionNoteDrafts)
    } catch {
      setCompletedServices(existing.completed_services ?? '')
    }
    setLoading(false)
  }, [requestId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!order?.id) return
    try {
      localStorage.setItem(`os-drafts-${order.id}`, JSON.stringify({ completedServices, conclusionNoteDrafts }))
    } catch { /* ignore */ }
  }, [order?.id, completedServices, conclusionNoteDrafts])

  useEffect(() => {
    if (readOnly) return
    eletronicosAdmin.stockItems.list().then(setStockItems).catch(() => {})
  }, [readOnly])

  useEffect(() => {
    const hasUpdate = updates.some((u) => u.action_type === 'update')
    onOrderStateChange?.({ closed: !!order?.closed_at, hasUpdate })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.closed_at, updates])

  const resolveStockForComponent = (idx: number, component: string) => {
    const fullName = `${component} ${request.phone_model ?? ''}`.trim()
    const matched = stockItems.find((s) => s.name.toLowerCase() === fullName.toLowerCase())
    if (matched) {
      setChecklist((prev) => prev.map((it, i) => (i === idx ? {
        ...it, stock_item_id: matched.id, value: it.value ?? matched.price ?? null, warranty_days: matched.warranty_days ?? null,
      } : it)))
      return
    }
    setPendingStockItem({ idx, name: fullName })
    setNewPartStock('')
    setNewPartPrice('')
    setNewPartWarranty('')
    setPartError(null)
    setSimilarSearch('')
  }

  const toggleChecklistItem = (idx: number, checked: boolean) => {
    setChecklist((prev) => prev.map((item, i) => (i === idx ? { ...item, checked } : item)))
    if (!checked) return
    const item = checklist[idx]
    if (item.stock_item_id) return
    resolveStockForComponent(idx, item.component)
  }

  const handleConfirmNewStockItem = async () => {
    if (!pendingStockItem) return
    setPartError(null)
    const stockQty = parseFloat(newPartStock)
    if (!newPartStock || isNaN(stockQty) || stockQty < 0) { setPartError('Informe uma quantidade de estoque válida.'); return }
    const priceNum = parseFloat(newPartPrice)
    if (!newPartPrice || isNaN(priceNum) || priceNum < 0) { setPartError('Informe o valor do reparo.'); return }
    if (!newPartWarranty.trim()) { setPartError('Informe a garantia da peça.'); return }
    const warrantyDays = parseInt(newPartWarranty, 10)
    if (isNaN(warrantyDays) || warrantyDays < 0) { setPartError('Informe a garantia em dias (número).'); return }

    setCreatingPart(true)
    try {
      const item = await eletronicosAdmin.stockItems.create({
        name: pendingStockItem.name, unit: 'unidade', quantity: stockQty, price: priceNum, warranty_days: warrantyDays,
      })
      setStockItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))
      setChecklist((prev) => prev.map((it, i) => (i === pendingStockItem.idx ? {
        ...it, stock_item_id: item.id, value: it.value ?? item.price ?? null, warranty_days: item.warranty_days ?? null,
      } : it)))
      setPendingStockItem(null)
    } catch (e) {
      setPartError(e instanceof Error ? e.message : 'Não foi possível cadastrar o item.')
    } finally {
      setCreatingPart(false)
    }
  }

  const selectSimilarComponent = (stockItem: StockItemDto) => {
    if (!pendingStockItem) return
    setChecklist((prev) => prev.map((it, i) => (i === pendingStockItem.idx ? {
      ...it, stock_item_id: stockItem.id, value: it.value ?? stockItem.price ?? null, warranty_days: stockItem.warranty_days ?? null,
    } : it)))
    setPendingStockItem(null)
    setSimilarSearch('')
    setSimilarSearchOpen(false)
  }

  const similarSuggestions = similarSearch.trim()
    ? stockItems.filter((i) => i.name.toLowerCase().includes(similarSearch.trim().toLowerCase())).slice(0, 6)
    : []

  const updateChecklistDescription = (idx: number, description: string) => {
    setChecklist((prev) => prev.map((item, i) => (i === idx ? { ...item, description } : item)))
  }

  const addChecklistFiles = (idx: number, files: File[]) => {
    if (files.length === 0) return
    setChecklistFiles((prev) => ({ ...prev, [idx]: [...(prev[idx] ?? []), ...files] }))
  }
  const removeChecklistFile = (idx: number, fileIdx: number) => {
    setChecklistFiles((prev) => ({ ...prev, [idx]: (prev[idx] ?? []).filter((_, i) => i !== fileIdx) }))
  }

  const handleSaveChecklist = async () => {
    if (!order) return
    setChecklistError(null)
    const unresolved = checklist.filter((i) => i.checked && !i.stock_item_id)
    if (unresolved.length > 0) {
      setChecklistError(`Vincule uma peça de estoque para: ${unresolved.map((i) => i.component).join(', ')}.`)
      return
    }
    setSavingChecklist(true)
    try {
      const updatedChecklist = await Promise.all(
        checklist.map(async (item, idx) => {
          const files = checklistFiles[idx] ?? []
          if (files.length === 0) return item
          const uploaded = await Promise.all(files.map((f) => eletronicosAdmin.uploadMedia(f, f.name)))
          return { ...item, media_urls: [...(item.media_urls ?? []), ...uploaded] }
        }),
      )
      const updated = await eletronicosAdmin.serviceOrders.saveChecklist(order.id, updatedChecklist)
      setOrder(updated)
      setChecklist(updatedChecklist)
      setChecklistFiles({})

      const checkedItemsNow = updatedChecklist.filter((i) => i.checked)
      const summary = checkedItemsNow.length
        ? checkedItemsNow.map((i) => `${i.component}${i.description ? `: ${i.description}` : ''}${i.value != null ? ` (R$ ${Number(i.value).toFixed(2)})` : ''}`).join('; ')
        : 'Nenhum componente marcado'
      const logEntry = await eletronicosAdmin.serviceOrders.addUpdate(order.id, { message: `Checklist de avaliação atualizado — ${summary}` })
      setUpdates((prev) => [...prev, { ...logEntry, action_type: 'checklist_update' }])

      const itemsWithValue = checkedItemsNow.filter((i) => i.value != null)
      if (itemsWithValue.length > 0) {
        const newTotal = itemsWithValue.reduce((sum, i) => sum + Number(i.value), 0)
        await eletronicosAdmin.serviceRequests.updateQuoteValue(requestId, newTotal)
        onQuoteValueChange?.(newTotal)
      }
    } catch (e) {
      setChecklistError(e instanceof Error ? e.message : 'Falha ao salvar checklist.')
    } finally {
      setSavingChecklist(false)
    }
  }

  const handleAddUpdate = async (component: string) => {
    if (!order) return
    if (!updateText.trim() && updateFiles.length === 0) return
    setAddingUpdate(true)
    try {
      const mediaUrls = await Promise.all(updateFiles.map((f) => eletronicosAdmin.uploadMedia(f, f.name)))
      const inserted = await eletronicosAdmin.serviceOrders.addUpdate(order.id, { message: updateText.trim() || undefined, media_urls: mediaUrls, component })
      setUpdates((prev) => [...prev, inserted])
      setUpdateText('')
      setUpdateFiles([])
      setUpdatingComponent(null)
    } finally {
      setAddingUpdate(false)
    }
  }

  const everCompleted = updates.some((u) => u.action_type === 'completed')

  const handleSaveCompletion = async () => {
    if (!order) return
    setCompletionError(null)
    setSavingCompletion(true)
    try {
      const result = await eletronicosAdmin.serviceOrders.complete(order.id, {
        checklist,
        completed_services: completedServices || undefined,
        shipping_price: !request.self_pickup ? request.shipping_price ?? undefined : undefined,
      })
      setOrder(result.service_order)
      setChecklist(result.service_order.checklist)
      onQuoteValueChange?.(result.final_value)

      const ups = await eletronicosAdmin.serviceOrders.listUpdates(order.id)
      setUpdates([...ups].sort((a, b) => a.created_at.localeCompare(b.created_at)))

      let pdfUrl: string | null = null
      try {
        const blob = await generateServiceOrderPdf(request, result.service_order, tenantConfig?.loja_nome || 'Assistência técnica', result.service_order.checklist)
        pdfUrl = await eletronicosAdmin.uploadMedia(blob, `os-${order.id}.pdf`)
        await eletronicosAdmin.serviceOrders.setPdf(order.id, pdfUrl)
        setOrder((prev) => (prev ? { ...prev, pdf_url: pdfUrl } : prev))
      } catch {
        setPdfError('Não foi possível gerar o PDF. Tente novamente abaixo.')
      }

      try { localStorage.removeItem(`os-drafts-${order.id}`) } catch { /* ignore */ }
    } catch (e) {
      setCompletionError(e instanceof Error ? e.message : 'Falha ao concluir ordem de serviço.')
    } finally {
      setSavingCompletion(false)
    }
  }

  const updateConclusionNote = (idx: number, raw: string) => {
    setConclusionNoteDrafts((prev) => ({ ...prev, [idx]: raw }))
    setChecklist((prev) => prev.map((it, i) => (i === idx ? { ...it, note: raw } : it)))
  }

  const handlePreviewPdf = async () => {
    if (!order) return
    setPreviewingPdf(true)
    setPdfError(null)
    try {
      const previewOrder: ServiceOrderDto = { ...order, checklist }
      const blob = await generateServiceOrderPdf(request, previewOrder, tenantConfig?.loja_nome || 'Assistência técnica', checklist)
      const pdfUrl = await eletronicosAdmin.uploadMedia(blob, `os-${order.id}.pdf`)
      await eletronicosAdmin.serviceOrders.setPdf(order.id, pdfUrl)
      setOrder((prev) => (prev ? { ...prev, pdf_url: pdfUrl } : prev))
    } catch {
      setPdfError('Não foi possível gerar a prévia do PDF.')
    } finally {
      setPreviewingPdf(false)
    }
  }

  const handleGeneratePdf = async () => {
    if (!order || !order.closed_at) return
    setGeneratingPdf(true)
    setPdfError(null)
    try {
      const blob = await generateServiceOrderPdf(request, order, tenantConfig?.loja_nome || 'Assistência técnica', order.checklist)
      const pdfUrl = await eletronicosAdmin.uploadMedia(blob, `os-${order.id}.pdf`)
      await eletronicosAdmin.serviceOrders.setPdf(order.id, pdfUrl)
      setOrder((prev) => (prev ? { ...prev, pdf_url: pdfUrl } : prev))
    } catch {
      setPdfError('Não foi possível gerar o PDF.')
    } finally {
      setGeneratingPdf(false)
    }
  }

  const handleReopen = async () => {
    if (!order || !reopenReason.trim()) return
    setReopening(true)
    try {
      const updated = await eletronicosAdmin.serviceOrders.reopen(order.id, `Motivo da reabertura: ${reopenReason.trim()}`)
      setOrder(updated)
      const ups = await eletronicosAdmin.serviceOrders.listUpdates(order.id)
      setUpdates([...ups].sort((a, b) => a.created_at.localeCompare(b.created_at)))
      setConfirmingReopen(false)
      setReopenReason('')
    } finally {
      setReopening(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  if (!order) return null

  const checkedItems = checklist.filter((i) => i.checked)
  const resolvedItems = checklist.filter((i) => i.checked && i.stock_item_id)
  const osOpenForRepair = !order.closed_at && (status === 'in_progress' || everCompleted)
  const showChecklist = osOpenForRepair
  const showTimeline = osOpenForRepair
  const checklistEditable = showChecklist && !readOnly
  const updatesEditable = showTimeline && !readOnly
  const showCompletion = !readOnly && !order.closed_at && (status === 'completed' || everCompleted)
  const showClosedSummary = !!order.closed_at
  const committedItems = (order.checklist ?? []).filter((i) => i.checked && i.added_at)
  const canReopen = committedItems.length === 0 || committedItems.some((i) => isWarrantyActive(i.added_at, i.warranty_days))

  if (!showChecklist && !showTimeline && !showCompletion && !showClosedSummary) return null

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
        <ClipboardList className="w-3.5 h-3.5" />
        Ordem de serviço
      </h3>

      {showChecklist && (
        <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Checklist de avaliação</p>
          {checklistEditable ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">
                Marque os componentes com problema, descreva o estado e anexe fotos/vídeos. Ao marcar, o componente já é vinculado a uma peça do estoque — o valor do reparo vem de lá.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {checklist.map((item, idx) => (
                  <div key={item.component} className="flex flex-col">
                    <button type="button" onClick={() => toggleChecklistItem(idx, !item.checked)} className="flex items-center gap-2 text-sm text-gray-700 py-1 text-left">
                      {item.checked ? <CheckSquare className="w-4 h-4 text-[#e0211a] shrink-0" /> : <Square className="w-4 h-4 text-gray-300 shrink-0" />}
                      {item.component}
                    </button>
                    {item.checked && (
                      <div className="space-y-1.5 mt-1">
                        <textarea
                          value={item.description}
                          onChange={(e) => updateChecklistDescription(idx, e.target.value)}
                          placeholder="Descreva o estado atual deste item..."
                          rows={2}
                          className={`${INPUT} text-xs resize-none`}
                        />
                        <label className="text-xs text-[#e0211a] font-semibold cursor-pointer">
                          + Foto/vídeo
                          <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { addChecklistFiles(idx, Array.from(e.target.files ?? [])); e.target.value = '' }} />
                        </label>
                        {(item.media_urls?.length || checklistFiles[idx]?.length) ? (
                          <div className="flex flex-wrap gap-1.5">
                            {item.media_urls?.map((url) => (
                              <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1 text-[#e0211a]">anexo</a>
                            ))}
                            {(checklistFiles[idx] ?? []).map((f, fi) => (
                              <span key={fi} className="flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-lg px-2 py-1">
                                {f.name}
                                <button type="button" onClick={() => removeChecklistFile(idx, fi)}><X className="w-3 h-3 text-gray-400" /></button>
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {item.stock_item_id ? (
                          <p className="text-xs text-green-600">
                            Peça vinculada{item.value != null ? ` · R$ ${Number(item.value).toFixed(2)}` : ''}{item.warranty_days != null ? ` · garantia ${item.warranty_days} dias` : ''}
                          </p>
                        ) : (
                          <p className="text-xs text-amber-600">Peça ainda não vinculada ao estoque.</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {checklistError && <p className="text-xs text-red-500">{checklistError}</p>}
              <button onClick={handleSaveChecklist} disabled={savingChecklist} className="w-full rounded-xl bg-[#e0211a] hover:bg-[#a3140f] text-white font-semibold py-2.5 flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
                {savingChecklist ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                Salvar checklist de avaliação
              </button>
            </div>
          ) : checkedItems.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhum item registrado ainda.</p>
          ) : (
            <ul className="space-y-2">
              {checkedItems.map((item) => (
                <li key={item.component} className="text-sm">
                  <span className="font-semibold text-gray-800">{item.component}</span>
                  {item.description && <span className="text-gray-600"> — {item.description}</span>}
                  {item.value != null && <span className="text-gray-600"> — R$ {Number(item.value).toFixed(2)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showTimeline && (
        <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Acompanhamento / linha do tempo</p>
          {resolvedItems.length === 0 ? (
            <p className="text-sm text-gray-400">Marque e vincule a uma peça de estoque ao menos um componente na checklist (OS 1) para registrar atualizações.</p>
          ) : (
            <div className="space-y-3">
              {resolvedItems.map((item) => {
                const componentUpdates = updates.filter((u) => u.action_type === 'update' && u.component === item.component)
                const isUpdatingThis = updatingComponent === item.component
                return (
                  <div key={item.component} className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
                    <p className="text-sm font-semibold text-gray-800">{item.component}</p>
                    {componentUpdates.length === 0 ? (
                      <p className="text-xs text-gray-400">Sem atualizações ainda.</p>
                    ) : (
                      <ul className="space-y-2">
                        {componentUpdates.map((u) => (
                          <li key={u.id} className="text-sm border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                            <span className="text-xs text-gray-400">{new Date(u.created_at).toLocaleString('pt-BR')}</span>
                            {u.message && <p className="text-gray-700 mt-0.5">{u.message}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {updatesEditable && (
                      isUpdatingThis ? (
                        <div className="space-y-1.5 pt-2 border-t border-gray-100">
                          <textarea value={updateText} onChange={(e) => setUpdateText(e.target.value)} placeholder="Descreva uma ocorrência/atualização deste componente..." rows={2} className={`${INPUT} text-sm resize-none`} />
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleAddUpdate(item.component)} disabled={addingUpdate || (!updateText.trim() && updateFiles.length === 0)} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold bg-[#e0211a] text-white rounded-lg px-3 py-2 hover:bg-[#a3140f] transition-colors disabled:opacity-50">
                              {addingUpdate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                              Adicionar
                            </button>
                            <button type="button" onClick={() => { setUpdatingComponent(null); setUpdateText(''); setUpdateFiles([]) }} disabled={addingUpdate} className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-2">Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => { setUpdatingComponent(item.component); setUpdateText(''); setUpdateFiles([]) }} className="flex items-center gap-1.5 text-xs font-semibold text-[#e0211a] hover:text-[#a3140f] transition-colors pt-1">
                          <Plus className="w-3.5 h-3.5" /> Atualização
                        </button>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {showCompletion && (
        <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Concluir ordem de serviço</p>
          {checkedItems.length > 0 && (
            <div className="space-y-3 pb-3 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Itens reparados</p>
              {checklist.map((item, idx) => {
                if (!item.checked) return null
                const locked = !!item.added_at
                const expiry = computeWarrantyExpiry(item.added_at, item.warranty_days)
                const expired = locked && !!expiry && new Date() > expiry
                return (
                  <div key={item.component} className={`rounded-xl border p-3 space-y-2 ${locked ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200'}`}>
                    <p className="text-sm font-semibold text-gray-800">{item.component}</p>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs text-gray-500">Valor do reparo</span>
                      <span className="text-sm font-semibold text-gray-900">R$ {(item.value ?? 0).toFixed(2)}</span>
                    </div>
                    <div>
                      <label className={LABEL}>Observação (opcional)</label>
                      <input disabled={locked} value={conclusionNoteDrafts[idx] ?? (item.note ?? '')} onChange={(e) => updateConclusionNote(idx, e.target.value)} placeholder="Detalhe algo sobre este item, se necessário..." className={`${INPUT} disabled:opacity-60`} />
                    </div>
                    <p className={`text-xs ${expired ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                      {item.warranty_days == null
                        ? 'Garantia não informada'
                        : locked
                          ? expired ? `Garantia expirada em ${expiry!.toLocaleDateString('pt-BR')}` : `Garantia: ${item.warranty_days} dias (até ${expiry!.toLocaleDateString('pt-BR')})`
                          : `Garantia: ${item.warranty_days} dias (a partir da conclusão)`}
                    </p>
                  </div>
                )
              })}
              <p className="text-sm font-bold text-gray-800">
                Valor total do serviço: R$ {checklist.filter((i) => i.checked && !i.added_at).reduce((sum, i) => sum + (i.value ?? 0), 0).toFixed(2)}
              </p>
            </div>
          )}
          <div>
            <label className={LABEL}>Serviços realizados</label>
            <textarea value={completedServices} onChange={(e) => setCompletedServices(e.target.value)} placeholder="Ex: Troca de tela, Troca de bateria" rows={2} className={`${INPUT} resize-none`} />
          </div>
          {completionError && <p className="text-xs text-red-500">{completionError}</p>}
          {pdfError && <p className="text-xs text-red-500">{pdfError}</p>}
          <button type="button" onClick={handlePreviewPdf} disabled={previewingPdf} className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl py-2 hover:bg-gray-50 transition-colors disabled:opacity-50">
            {previewingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            {previewingPdf ? 'Gerando prévia...' : 'Atualizar prévia do PDF (cliente já pode ver em /consultar)'}
          </button>
          <button onClick={handleSaveCompletion} disabled={savingCompletion} className="w-full rounded-xl bg-[#e0211a] hover:bg-[#a3140f] text-white font-semibold py-2.5 flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
            {savingCompletion ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            Concluir e registrar OS
          </button>
        </div>
      )}

      {pendingStockItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !creatingPart && setPendingStockItem(null)}>
          <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800">Este item ainda não está cadastrado, deseja cadastrar agora?</p>
            <p className="text-xs text-gray-400">Será salvo em estoque como &quot;{pendingStockItem.name}&quot;.</p>
            <div>
              <label className={LABEL}>Quantidade em estoque *</label>
              <input type="number" min="0" step="0.01" value={newPartStock} onChange={(e) => setNewPartStock(e.target.value)} placeholder="0" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Valor do reparo (R$) *</label>
              <input type="number" min="0" step="0.01" value={newPartPrice} onChange={(e) => setNewPartPrice(e.target.value)} placeholder="0,00" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Garantia (dias) *</label>
              <input type="number" min="0" step="1" value={newPartWarranty} onChange={(e) => setNewPartWarranty(e.target.value)} placeholder="Ex: 90" className={INPUT} />
            </div>
            {partError && <p className="text-xs text-red-500">{partError}</p>}
            <button onClick={handleConfirmNewStockItem} disabled={creatingPart} className="w-full rounded-xl bg-[#e0211a] hover:bg-[#a3140f] text-white font-semibold py-2.5 flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
              {creatingPart ? <Loader2 className="w-4 h-4 animate-spin" /> : <Boxes className="w-4 h-4" />}
              Cadastrar e vincular
            </button>
            <div className="pt-2 border-t border-gray-100 space-y-2">
              <p className="text-sm font-semibold text-gray-800">Deseja usar o mesmo componente de outro modelo para este reparo?</p>
              <p className="text-xs text-gray-400">Se não tiver a peça exata, busque uma já cadastrada em outro aparelho que sirva pra este reparo.</p>
              <div className="relative">
                <input
                  value={similarSearch}
                  onChange={(e) => { setSimilarSearch(e.target.value); setSimilarSearchOpen(true) }}
                  onFocus={() => setSimilarSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSimilarSearchOpen(false), 150)}
                  placeholder="Buscar peça já cadastrada..."
                  className={`${INPUT} text-sm`}
                  autoComplete="off"
                />
                {similarSearchOpen && similarSuggestions.length > 0 && (
                  <ul className="absolute z-20 mt-1 w-full max-h-40 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1">
                    {similarSuggestions.map((s) => (
                      <li key={s.id}>
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => selectSimilarComponent(s)} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-red-50 hover:text-[#e0211a] transition-colors">
                          {s.name}
                          <span className="text-xs text-gray-400"> (R$ {Number(s.price ?? 0).toFixed(2)}{s.warranty_days != null ? ` · ${s.warranty_days} dias` : ''})</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setPendingStockItem(null)} disabled={creatingPart} className="text-sm font-semibold text-gray-500 px-3">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {order.closed_at && (
        <div className="bg-green-50 border border-green-100 rounded-2xl p-4 space-y-1.5">
          <p className="text-xs font-bold text-green-700 uppercase tracking-wide flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Reparo concluído em {new Date(order.closed_at).toLocaleString('pt-BR')}
          </p>
          {order.completed_services && <p className="text-sm text-gray-700"><strong>Serviços:</strong> {order.completed_services}</p>}
          {order.final_value != null && <p className="text-sm text-gray-700"><strong>Valor:</strong> R$ {Number(order.final_value).toFixed(2)}</p>}
          {(order.checklist ?? []).filter((i) => i.checked).length > 0 && (
            <p className="text-sm text-gray-700"><strong>Componentes reparados:</strong> {(order.checklist ?? []).filter((i) => i.checked).map((i) => i.component).join(', ')}</p>
          )}
          {order.warranty && <p className="text-sm text-gray-700"><strong>Garantia:</strong> {order.warranty}</p>}
          {order.pdf_url ? (
            <div className="flex items-center gap-3 mt-1">
              <a href={order.pdf_url} target="_blank" rel="noreferrer" className="text-sm text-[#e0211a] hover:text-[#a3140f] font-semibold flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" /> Visualizar OS
              </a>
              <button type="button" onClick={() => downloadPdf(order.pdf_url!, `OS-${order.id.slice(0, 8)}.pdf`)} className="text-sm text-[#e0211a] hover:text-[#a3140f] font-semibold flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Baixar PDF
              </button>
            </div>
          ) : !readOnly && (
            <div className="mt-1 space-y-1">
              <button type="button" onClick={handleGeneratePdf} disabled={generatingPdf} className="text-sm text-[#e0211a] hover:text-[#a3140f] font-semibold flex items-center gap-1.5 disabled:opacity-50">
                {generatingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                Gerar PDF da OS
              </button>
              {pdfError && <p className="text-xs text-red-500">{pdfError}</p>}
            </div>
          )}

          {!readOnly && !canReopen && (
            <div className="pt-2 mt-1 border-t border-green-100">
              <p className="text-xs text-red-600 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Todas as garantias dos componentes reparados já expiraram — não é possível reabrir esta OS.
              </p>
            </div>
          )}

          {!readOnly && canReopen && (
            <div className="pt-2 mt-1 border-t border-green-100">
              {confirmingReopen ? (
                <div className="bg-white border border-amber-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-amber-700 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Reabrir a OS libera o acompanhamento e a conclusão/garantia para edição.
                  </p>
                  <div>
                    <label className={LABEL}>Motivo da reabertura *</label>
                    <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Descreva por que esta OS está sendo reaberta..." rows={2} className={`${INPUT} text-sm resize-none`} />
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleReopen} disabled={reopening || !reopenReason.trim()} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold bg-amber-500 text-white rounded-lg px-3 py-2 hover:bg-amber-600 transition-colors disabled:opacity-50">
                      {reopening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      Confirmar reabertura
                    </button>
                    <button type="button" onClick={() => { setConfirmingReopen(false); setReopenReason('') }} disabled={reopening} className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-3 py-2">Cancelar</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmingReopen(true)} className="text-sm text-gray-500 hover:text-amber-600 font-semibold flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" /> Reabrir ordem de serviço
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
