import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Eye, ExternalLink, FileText, Loader2, X } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import { fetchCatalog, type CatalogCategory, type CatalogItem, type ServiceRequestDto } from '../../lib/eletronicosApi'
import { generateDiagnosticPdf } from '../../lib/eletronicosPdf'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { resolveTenantSlug } from '../../lib/tenantConfig'

// Port 1:1 (parcial, gap disclosed abaixo) de src/components/DiagnosticSection.tsx
// do vrtech -- marca/modelo/serviços do catálogo real, total automático +
// ajuste manual, observações, fotos/vídeos, prévia de PDF, salvar e
// avançar (decideQuoteOutcome: valor final <= estimado avança sozinho pro
// reparo, senão fica aguardando aprovação do cliente), WhatsApp e link de
// confirmação. Gap disclosed: fotos entram como link no PDF, não embutidas
// como imagem (esse motor não tem o helper lib/pdfImages.ts do original).

type SelectedService = { id: string; repair_type: string; price: number }

export default function EletronicaDiagnosticSection({
  request,
  onSaved,
}: {
  request: ServiceRequestDto
  onSaved: (newStatus: string) => void
}) {
  const tenantConfig = useTenantConfig()
  const [brands, setBrands] = useState<CatalogCategory[]>([])
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(true)
  const [existingId, setExistingId] = useState<string | null>(null)

  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [selectedModelPill, setSelectedModelPill] = useState<string | null>(null)
  const [selectedServices, setSelectedServices] = useState<SelectedService[]>([])
  const [notes, setNotes] = useState('')
  const [customTotal, setCustomTotal] = useState('')

  const [saving, setSaving] = useState(false)
  const [previewingPdf, setPreviewingPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [mediaUrls, setMediaUrls] = useState<string[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)

  useEffect(() => {
    const slug = resolveTenantSlug()
    setLoadingCatalog(true)
    Promise.all([slug ? fetchCatalog(slug) : Promise.resolve({ categories: [], items: [] }), eletronicosAdmin.serviceRequests.getDiagnostic(request.id)])
      .then(([catalog, diag]) => {
        setBrands(catalog.categories)
        setCatalogItems(catalog.items)
        if (diag) {
          setExistingId(diag.id)
          setSelectedServices(diag.services_selected ?? [])
          setNotes(diag.notes ?? '')
          if (diag.pdf_url) setPdfUrl(diag.pdf_url)
          if (diag.quote_confirmed) setCustomTotal(String(diag.quote_confirmed))
          setMediaUrls(diag.media_urls ?? [])
        }
      })
      .finally(() => setLoadingCatalog(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id])

  const modelList = useMemo(() => {
    if (!selectedBrandId) return []
    const seen = new Set<string>()
    return catalogItems
      .filter((i) => i.category_id === selectedBrandId && i.model_name)
      .reduce<string[]>((acc, i) => {
        if (!seen.has(i.model_name!)) {
          seen.add(i.model_name!)
          acc.push(i.model_name!)
        }
        return acc
      }, [])
      .sort()
  }, [catalogItems, selectedBrandId])

  const serviceCards = useMemo(() => {
    if (!selectedBrandId || !selectedModelPill) return []
    return catalogItems.filter((i) => i.category_id === selectedBrandId && (i.model_name === selectedModelPill || i.model_name === null))
  }, [catalogItems, selectedBrandId, selectedModelPill])

  const autoTotal = selectedServices.reduce((s, i) => s + i.price, 0)
  const finalTotal = customTotal ? parseFloat(customTotal) || 0 : autoTotal

  const toggleService = (item: CatalogItem) => {
    setSelectedServices((prev) => {
      const exists = prev.find((s) => s.id === item.id)
      if (exists) return prev.filter((s) => s.id !== item.id)
      return [...prev, { id: item.id, repair_type: item.repair_type, price: Number(item.price) }]
    })
  }

  async function handleFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadingMedia(true)
    try {
      const uploaded: string[] = []
      for (const file of Array.from(files)) {
        const url = await eletronicosAdmin.uploadMedia(file, file.name)
        uploaded.push(url)
      }
      setMediaUrls((prev) => [...prev, ...uploaded])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao enviar mídia')
    } finally {
      setUploadingMedia(false)
    }
  }

  async function persist(finalized: boolean) {
    const doc = generateDiagnosticPdf(request, tenantConfig?.loja_nome || 'Assistência técnica', selectedServices, notes, finalTotal, mediaUrls)
    const url = await eletronicosAdmin.uploadMedia(doc, `diagnostico-${request.id}.pdf`)
    setPdfUrl(url)
    const updated = await eletronicosAdmin.serviceRequests.saveDiagnostic(request.id, {
      services_selected: selectedServices,
      notes: notes || undefined,
      pdf_url: url,
      quote_confirmed: finalTotal,
      media_urls: mediaUrls,
      finalized,
    })
    void existingId
    return updated
  }

  const handlePreview = async () => {
    setPreviewingPdf(true)
    setError(null)
    try {
      await persist(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar prévia do PDF')
    } finally {
      setPreviewingPdf(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const updated = await persist(true)
      setSaved(true)
      onSaved(updated.status)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar diagnóstico')
    } finally {
      setSaving(false)
    }
  }

  const whatsappUrl = () => {
    const phone = `55${request.customer_phone.replace(/\D/g, '')}`
    const servicesList = selectedServices.map((s) => `• ${s.repair_type}: R$ ${s.price.toFixed(2)}`).join('\n')
    const msg = [
      `Olá *${request.customer_name}*! 👋`,
      '',
      `Diagnóstico do${request.phone_model ? ` *${request.phone_model}*` : ' seu aparelho'} concluído.`,
      selectedServices.length > 0 ? `\n*Serviços identificados:*\n${servicesList}\n\n*Total: R$ ${finalTotal.toFixed(2)}*` : '',
      notes ? `\n*Obs:* ${notes}` : '',
      pdfUrl ? `\n📄 PDF do diagnóstico: ${pdfUrl}` : '',
      '\nDeseja confirmar o orçamento para iniciar o reparo?',
    ]
      .filter(Boolean)
      .join('\n')
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
  }

  if (loadingCatalog) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando catálogo...
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Diagnóstico do Aparelho</h3>

      {saved && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl p-3 text-green-700 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" />
          Diagnóstico salvo e enviado ao cliente!
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">Marca</p>
        <div className="flex flex-wrap gap-2">
          {brands.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setSelectedBrandId(b.id)
                setSelectedModelPill(null)
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                selectedBrandId === b.id ? 'bg-[#e0211a] text-white border-[#e0211a]' : 'bg-slate-100 border-slate-200 text-gray-600 hover:border-[#e0211a]/40'
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>

      {selectedBrandId && modelList.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">Modelo</p>
          <div className="flex flex-wrap gap-2">
            {modelList.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSelectedModelPill(m)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  selectedModelPill === m ? 'bg-[#e0211a] text-white border-[#e0211a]' : 'bg-slate-100 border-slate-200 text-gray-600 hover:border-[#e0211a]/40'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {serviceCards.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">
            Serviços
            {selectedServices.length > 0 && (
              <span className="text-[#e0211a] ml-1">
                · {selectedServices.length} selecionado{selectedServices.length !== 1 ? 's' : ''}
              </span>
            )}
          </p>
          <div className="overflow-x-auto flex gap-2 pb-1 -mx-1 px-1">
            {serviceCards.map((s) => {
              const sel = selectedServices.some((x) => x.id === s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleService(s)}
                  className={`shrink-0 w-40 rounded-xl p-3 text-left border-2 transition-all ${sel ? 'border-[#e0211a] bg-red-50' : 'border-slate-200 bg-white hover:border-[#e0211a]/40'}`}
                >
                  <div className="text-xs font-semibold text-gray-900 leading-tight">{s.repair_type}</div>
                  {s.description && <div className="text-[10px] text-gray-400 mt-1 leading-snug line-clamp-2">{s.description}</div>}
                  <div className="text-[#e0211a] font-bold text-xs mt-2">R$ {Number(s.price).toFixed(2)}</div>
                  {sel && <div className="text-[10px] text-[#e0211a] mt-0.5 font-semibold">✓</div>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {selectedServices.length > 0 && (
        <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
          {selectedServices.map((s) => (
            <div key={s.id} className="flex justify-between text-sm">
              <span className="text-gray-700">{s.repair_type}</span>
              <span className="font-semibold text-gray-900">R$ {s.price.toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t border-gray-200 pt-1.5 flex justify-between font-bold text-sm">
            <span>Total auto</span>
            <span className="text-[#e0211a]">R$ {autoTotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Valor ajustado do orçamento (R$) <span className="font-normal text-gray-400">— opcional</span>
        </label>
        <div className="relative">
          <span className="absolute left-4 top-3.5 text-gray-400 font-medium">R$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={customTotal}
            onChange={(e) => setCustomTotal(e.target.value)}
            placeholder={autoTotal > 0 ? autoTotal.toFixed(2) : '0,00'}
            className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#e0211a]"
          />
        </div>
        {customTotal && <p className="text-xs text-amber-600 mt-1">Orçamento ajustado: R$ {finalTotal.toFixed(2)}</p>}
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Observações técnicas</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ex: Tela com manchas internas, conector oxidado, bateria inchada..."
          rows={3}
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#e0211a] resize-none"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-500">Fotos/vídeos do aparelho</label>
          <label className="text-xs font-semibold text-[#e0211a] cursor-pointer">
            {uploadingMedia ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : '+ Adicionar'}
            <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => handleFilesPicked(e.target.files)} disabled={uploadingMedia} />
          </label>
        </div>
        {mediaUrls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {mediaUrls.map((url) => (
              <div key={url} className="relative w-14 h-14 rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                {/\.(mp4|mov|webm)$/i.test(url) ? (
                  <video src={url} className="w-full h-full object-cover" />
                ) : (
                  <img src={url} alt="" className="w-full h-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => setMediaUrls((prev) => prev.filter((u) => u !== url))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-2">
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewingPdf || uploadingMedia || saved}
          className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl py-2 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {previewingPdf || uploadingMedia ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          {previewingPdf || uploadingMedia ? 'Gerando prévia...' : 'Atualizar prévia do PDF (cliente já pode ver em /consultar)'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || saved}
          className="w-full rounded-xl bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-50 text-white font-semibold py-2.5 flex items-center justify-center gap-2 transition-all"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Salvando...
            </>
          ) : saved ? (
            '✓ Diagnóstico salvo!'
          ) : (
            '📄 Salvar diagnóstico e enviar ao cliente'
          )}
        </button>

        {(pdfUrl || selectedServices.length > 0) && (
          <div className="grid grid-cols-2 gap-2">
            <a
              href={pdfUrl ?? '#'}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl py-2 hover:bg-gray-50 transition-colors"
            >
              <FileText className="w-4 h-4" />
              Ver PDF
            </a>
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 text-sm font-medium text-green-600 border border-green-200 rounded-xl py-2 hover:bg-green-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              WhatsApp
            </a>
          </div>
        )}
      </div>
    </section>
  )
}
