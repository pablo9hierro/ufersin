import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, DollarSign, ExternalLink, Loader2, Package, PackageX, Pencil, Plus, Search, Smartphone, Trash2, Wrench, X } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { EletronicaAdminCatalogItem } from '../../lib/eletronicosAdminApi'
import { withTenantSearch } from '../../lib/tenantConfig'

// Port de src/app/dashboard/produtos/ProdutosClient.tsx + ServicosTab.tsx do
// vrtech -- mesmas 6 abas (Produtos/Serviços/Estoque/Aparelho·Marca·Modelo/
// Alerta de reposição/Em falta). "Produtos" reaproveita a tela real e já
// existente /admin/produtos (mesma tabela `products` que a vitrine /loja já
// lê) em vez de duplicar. Serviços tem o vínculo multi-select real de
// aparelho(s)/marca(s)/modelo(s) via service_item_devices/brands/models,
// peças de estoque como dependência de custo (service_catalog_item_parts) e
// custos avulsos (service_catalog_item_extra_costs) -- mesmas tabelas do
// schema espelhado do vrtech.

const TABS = [
  { key: 'produtos', label: 'Produtos', icon: Package },
  { key: 'servicos', label: 'Serviços', icon: Wrench },
  { key: 'estoque', label: 'Estoque', icon: Package },
  { key: 'marcas', label: 'Aparelho/Marca/Modelo', icon: Smartphone },
  { key: 'alerta', label: 'Alerta de reposição', icon: AlertTriangle },
  { key: 'falta', label: 'Em falta', icon: PackageX },
] as const
type TabKey = (typeof TABS)[number]['key']

const INPUT = 'w-full rounded-xl border border-white/10 bg-[#0a0a0b] px-3 py-2 text-sm text-white placeholder:text-[#d4d4d8]/30 outline-none focus:border-[#e0211a] transition-colors'

type Category = { id: string; name: string; slug: string; sort_order: number; device_type: string; image_url: string | null }
type StockItem = { id: string; name: string; unit: string; quantity: number; price: number | null; low_stock_threshold: number | null }

const DEVICE_TYPES = ['celular', 'tablet', 'notebook', 'computador']

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-[#161618] border border-white/10 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 sticky top-0 bg-[#161618] z-10">
          <h2 className="font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-[#d4d4d8]/50 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

type DeviceType = { id: string; name: string; slug: string; icon_key: string; sort_order: number }
type CatalogModelRow = { id: string; brand_id: string; name: string; sort_order: number }
type StockItemRow = { id: string; name: string; unit: string; price: number | null; quantity: number }
type SelectedPart = { stock_item_id: string; name: string; unit: string; price: number; quantity: number }
type ExtraCostRow = { name: string; value: number }

// Multi-select com busca + criação inline -- port funcional (não visual
// pixel-a-pixel) de components/ui/SearchCreateMultiSelect.tsx do vrtech.
function SearchCreateMultiSelect({
  label,
  placeholder,
  options,
  selectedIds,
  onChange,
  onCreate,
}: {
  label: string
  placeholder: string
  options: { id: string; name: string }[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  onCreate?: (name: string) => Promise<{ id: string; name: string }>
}) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return options.filter((o) => o.name.toLowerCase().includes(q) && !selectedIds.includes(o.id)).slice(0, 8)
  }, [query, options, selectedIds])
  const exact = options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase())
  const selected = selectedIds.map((id) => options.find((o) => o.id === id)).filter(Boolean) as { id: string; name: string }[]

  const create = async () => {
    if (!onCreate || !query.trim() || exact) return
    setCreating(true)
    try {
      const created = await onCreate(query.trim())
      onChange([...selectedIds, created.id])
      setQuery('')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'erro ao criar')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <label className="block text-sm text-[#d4d4d8] mb-1.5">{label}</label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {selected.map((s) => (
            <span key={s.id} className="flex items-center gap-1 bg-[#e0211a]/15 text-[#e0211a] text-xs px-2 py-1 rounded-full">
              {s.name}
              <button type="button" onClick={() => onChange(selectedIds.filter((id) => id !== s.id))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-[#d4d4d8]/40 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className={`${INPUT} pl-8`} />
        {(matches.length > 0 || (onCreate && query.trim() && !exact)) && (
          <div className="absolute z-20 mt-1 w-full bg-[#0a0a0b] border border-white/10 rounded-lg overflow-hidden shadow-lg max-h-48 overflow-y-auto">
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange([...selectedIds, m.id])
                  setQuery('')
                }}
                className="w-full text-left px-3 py-2 text-sm text-white hover:bg-[#e0211a]/15 transition-colors"
              >
                {m.name}
              </button>
            ))}
            {onCreate && query.trim() && !exact && (
              <button
                type="button"
                onClick={create}
                disabled={creating}
                className="w-full text-left px-3 py-2 text-sm text-[#e0211a] hover:bg-[#e0211a]/15 transition-colors flex items-center gap-1.5"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Cadastrar "{query.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ServicosTab({ categories }: { categories: Category[] }) {
  const [items, setItems] = useState<EletronicaAdminCatalogItem[] | null>(null)
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([])
  const [models, setModels] = useState<CatalogModelRow[]>([])
  const [stockItems, setStockItems] = useState<StockItemRow[]>([])
  const [itemDevices, setItemDevices] = useState<{ service_catalog_item_id: string; device_type_id: string }[]>([])
  const [itemBrands, setItemBrands] = useState<{ service_catalog_item_id: string; brand_id: string }[]>([])
  const [itemModels, setItemModels] = useState<{ service_catalog_item_id: string; model_id: string }[]>([])
  const [itemParts, setItemParts] = useState<{ service_catalog_item_id: string; stock_item_id: string; quantity: number; name: string; unit: string; price: number }[]>([])
  const [itemExtraCosts, setItemExtraCosts] = useState<{ service_catalog_item_id: string; name: string; value: number }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EletronicaAdminCatalogItem | 'new' | null>(null)
  const [saving, setSaving] = useState(false)

  const [deviceIds, setDeviceIds] = useState<string[]>([])
  const [brandIds, setBrandIds] = useState<string[]>([])
  const [modelIds, setModelIds] = useState<string[]>([])
  const [repairType, setRepairType] = useState('')
  const [price, setPrice] = useState('')
  const [duration, setDuration] = useState('60')
  const [description, setDescription] = useState('')
  const [active, setActive] = useState(true)
  const [selectedParts, setSelectedParts] = useState<SelectedPart[]>([])
  const [partsQuery, setPartsQuery] = useState('')
  const [extraCosts, setExtraCosts] = useState<ExtraCostRow[]>([])
  const [extraCostName, setExtraCostName] = useState('')
  const [extraCostValue, setExtraCostValue] = useState('')
  const [extraCostOpen, setExtraCostOpen] = useState(false)

  async function load() {
    try {
      const [its, devs, mods, stock, links, brs, mls, prts, extras] = await Promise.all([
        eletronicosAdmin.catalogItems.list(),
        eletronicosAdmin.deviceTypes.list(),
        eletronicosAdmin.catalogModels.list(),
        eletronicosAdmin.stockItems.list(),
        eletronicosAdmin.catalogItems.devices(),
        eletronicosAdmin.catalogItems.brands(),
        eletronicosAdmin.catalogItems.models(),
        eletronicosAdmin.catalogItems.parts(),
        eletronicosAdmin.catalogItems.extraCosts(),
      ])
      setItems(its)
      setDeviceTypes(devs)
      setModels(mods)
      setStockItems(stock)
      setItemDevices(links)
      setItemBrands(brs)
      setItemModels(mls)
      setItemParts(prts)
      setItemExtraCosts(extras)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao carregar')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const modelOptions = brandIds.length > 0 ? models.filter((m) => brandIds.includes(m.brand_id)) : models

  const partMatches = useMemo(() => {
    const q = partsQuery.trim().toLowerCase()
    if (!q) return []
    return stockItems.filter((s) => s.name.toLowerCase().includes(q) && !selectedParts.some((p) => p.stock_item_id === s.id)).slice(0, 6)
  }, [partsQuery, stockItems, selectedParts])

  const costPrice = selectedParts.reduce((sum, p) => sum + p.price * p.quantity, 0) + extraCosts.reduce((sum, c) => sum + c.value, 0)

  function openNew() {
    setDeviceIds([])
    setBrandIds(categories[0] ? [categories[0].id] : [])
    setModelIds([])
    setRepairType('')
    setPrice('')
    setDuration('60')
    setDescription('')
    setActive(true)
    setSelectedParts([])
    setExtraCosts([])
    setEditing('new')
  }

  function openEdit(item: EletronicaAdminCatalogItem) {
    setDeviceIds(itemDevices.filter((l) => l.service_catalog_item_id === item.id).map((l) => l.device_type_id))
    setBrandIds(itemBrands.filter((l) => l.service_catalog_item_id === item.id).map((l) => l.brand_id))
    setModelIds(itemModels.filter((l) => l.service_catalog_item_id === item.id).map((l) => l.model_id))
    setRepairType(item.repair_type)
    setPrice(String(item.price))
    setDuration(String(item.duration_minutes))
    setDescription(item.description ?? '')
    setActive(item.active)
    setSelectedParts(
      itemParts
        .filter((p) => p.service_catalog_item_id === item.id)
        .map((p) => ({ stock_item_id: p.stock_item_id, name: p.name, unit: p.unit, price: p.price, quantity: p.quantity })),
    )
    setExtraCosts(itemExtraCosts.filter((c) => c.service_catalog_item_id === item.id).map((c) => ({ name: c.name, value: c.value })))
    setEditing(item)
  }

  async function save() {
    if (brandIds.length === 0 || !repairType.trim() || !price) return
    setSaving(true)
    setError(null)
    try {
      const modelName = modelIds.length === 1 ? models.find((m) => m.id === modelIds[0])?.name ?? null : null
      const payload = {
        category_id: brandIds[0],
        model_name: modelName,
        repair_type: repairType.trim(),
        price: Number(price.replace(',', '.')) || 0,
        cost_price: costPrice,
        duration_minutes: Number(duration) || 60,
        description: description.trim() || null,
        image_url: editing !== 'new' ? editing?.image_url ?? null : null,
        tags: editing !== 'new' ? editing?.tags ?? [] : [],
        active,
        sort_order: editing !== 'new' ? editing?.sort_order ?? 0 : 0,
      }
      const saved = editing === 'new' ? await eletronicosAdmin.catalogItems.create(payload) : await eletronicosAdmin.catalogItems.update((editing as EletronicaAdminCatalogItem).id, payload)
      await eletronicosAdmin.catalogItems.saveLinks(saved.id, {
        device_ids: deviceIds,
        brand_ids: brandIds,
        model_ids: modelIds,
        parts: selectedParts.map((p) => ({ stock_item_id: p.stock_item_id, quantity: p.quantity })),
        extra_costs: extraCosts,
      })
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    try {
      await eletronicosAdmin.catalogItems.delete(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao excluir')
    }
  }

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—'

  if (!items) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-[#e0211a]" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#d4d4d8]/50">{items.length} serviço{items.length === 1 ? '' : 's'} cadastrado{items.length === 1 ? '' : 's'}</p>
        <button
          type="button"
          onClick={openNew}
          disabled={categories.length === 0}
          className="flex items-center gap-1.5 bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-40 text-white text-sm font-medium px-3.5 py-2 rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo serviço
        </button>
      </div>
      {categories.length === 0 && <p className="text-xs text-amber-400">Cadastre uma marca/aparelho primeiro na aba "Aparelho/Marca/Modelo".</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.id} className="bg-[#161618] rounded-xl border border-white/5 p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white truncate">{it.repair_type}</p>
                {!it.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-[#d4d4d8]/50">inativo</span>}
              </div>
              <p className="text-xs text-[#d4d4d8]/50">
                {categoryName(it.category_id)} {it.model_name && `· ${it.model_name}`}
              </p>
              <p className="text-sm text-[#e0211a] font-bold mt-1">{currency(it.price)}</p>
              {it.cost_price > 0 && <p className="text-xs text-[#d4d4d8]/40">custo {currency(it.cost_price)}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => openEdit(it)} className="text-[#d4d4d8]/60 hover:text-white p-1.5">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => remove(it.id)} className="text-[#d4d4d8]/60 hover:text-red-400 p-1.5">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-[#d4d4d8]/40 py-4">Nenhum serviço cadastrado.</p>}
      </div>

      {editing && (
        <Dialog title={editing === 'new' ? 'Novo serviço' : 'Editar serviço'} onClose={() => setEditing(null)}>
          <div className="grid grid-cols-1 gap-3">
            <SearchCreateMultiSelect
              label="Aparelho(s)"
              placeholder="Buscar aparelho..."
              options={deviceTypes}
              selectedIds={deviceIds}
              onChange={setDeviceIds}
              onCreate={async (name) => {
                const created = await eletronicosAdmin.deviceTypes.create(name)
                setDeviceTypes((prev) => [...prev, created])
                return created
              }}
            />
            <SearchCreateMultiSelect
              label="Marca(s)"
              placeholder="Buscar marca..."
              options={categories}
              selectedIds={brandIds}
              onChange={(ids) => {
                setBrandIds(ids)
                setModelIds([])
              }}
            />
            <SearchCreateMultiSelect
              label="Modelo(s) — opcional, vazio = universal"
              placeholder="Buscar modelo..."
              options={modelOptions}
              selectedIds={modelIds}
              onChange={setModelIds}
              onCreate={
                brandIds[0]
                  ? async (name) => {
                      const created = await eletronicosAdmin.catalogModels.create(brandIds[0], name)
                      setModels((prev) => [...prev, created])
                      return created
                    }
                  : undefined
              }
            />
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Tipo de reparo</label>
            <input value={repairType} onChange={(e) => setRepairType(e.target.value)} className={INPUT} placeholder="Ex: Troca de tela" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-[#d4d4d8] mb-1.5">Preço final (R$)</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} className={INPUT} placeholder="0,00" />
            </div>
            <div>
              <label className="block text-sm text-[#d4d4d8] mb-1.5">Duração (min)</label>
              <input value={duration} onChange={(e) => setDuration(e.target.value)} className={INPUT} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${INPUT} resize-none`} />
          </div>

          <div className="border-t border-white/10 pt-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#d4d4d8]/70">
              <Wrench className="w-3.5 h-3.5 text-[#e0211a]" />
              Peças usadas (dependência de estoque)
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#d4d4d8]/40 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={partsQuery} onChange={(e) => setPartsQuery(e.target.value)} placeholder="Buscar peça no estoque..." className={`${INPUT} pl-8`} />
              {partMatches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-[#0a0a0b] border border-white/10 rounded-lg overflow-hidden shadow-lg">
                  {partMatches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSelectedParts((prev) => [...prev, { stock_item_id: s.id, name: s.name, unit: s.unit, price: s.price ?? 0, quantity: 1 }])
                        setPartsQuery('')
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-[#e0211a]/15 transition-colors flex items-center justify-between"
                    >
                      <span>{s.name}</span>
                      <span className="text-[#d4d4d8]/40 text-xs">{currency(s.price ?? 0)} · estoque {s.quantity}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedParts.length > 0 && (
              <div className="space-y-1.5">
                {selectedParts.map((p) => (
                  <div key={p.stock_item_id} className="flex items-center gap-2 bg-[#0a0a0b] border border-white/8 rounded-lg px-3 py-1.5">
                    <span className="text-sm text-white flex-1 truncate">{p.name}</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={p.quantity}
                      onChange={(e) => setSelectedParts((prev) => prev.map((x) => (x.stock_item_id === p.stock_item_id ? { ...x, quantity: Number(e.target.value) || 1 } : x)))}
                      className="w-16 px-2 py-1 rounded bg-[#161618] border border-white/10 text-white text-xs text-center outline-none focus:border-[#e0211a]/50"
                    />
                    <span className="text-xs text-[#d4d4d8]/40 w-8">{p.unit}</span>
                    <span className="text-xs text-[#d4d4d8]/60 w-20 text-right">{currency(p.price * p.quantity)}</span>
                    <button onClick={() => setSelectedParts((prev) => prev.filter((x) => x.stock_item_id !== p.stock_item_id))} className="text-[#d4d4d8]/30 hover:text-red-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-white/10 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#d4d4d8]/70">
                <DollarSign className="w-3.5 h-3.5 text-[#e0211a]" />
                Custos avulsos (externo)
              </div>
              <button type="button" onClick={() => setExtraCostOpen(true)} className="flex items-center gap-1 text-xs font-semibold bg-[#0a0a0b] border border-white/10 text-white px-2.5 py-1.5 rounded-lg hover:border-[#e0211a]/40 transition-colors">
                <Plus className="w-3 h-3" /> Custo
              </button>
            </div>
            {extraCosts.length > 0 && (
              <div className="space-y-1.5">
                {extraCosts.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 bg-[#0a0a0b] border border-white/8 rounded-lg px-3 py-1.5">
                    <span className="text-sm text-white flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-[#d4d4d8]/60 w-20 text-right">{currency(c.value)}</span>
                    <button onClick={() => setExtraCosts((prev) => prev.filter((_, idx) => idx !== i))} className="text-[#d4d4d8]/30 hover:text-red-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between text-sm pt-1">
              <span className="text-[#d4d4d8]/60">Custo do serviço (peças + avulsos)</span>
              <span className="font-bold text-white">{currency(costPrice)}</span>
            </div>
            {price && Number(price) > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#d4d4d8]/40">Margem (preço final − custo)</span>
                <span className={Number(price) - costPrice >= 0 ? 'text-green-400' : 'text-red-400'}>{currency(Number(price) - costPrice)}</span>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-[#d4d4d8] cursor-pointer">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[#e0211a]" />
            Ativo (visível na vitrine)
          </label>
          <button
            onClick={save}
            disabled={saving || brandIds.length === 0 || !repairType.trim() || !price}
            className="w-full bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-40 text-white font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Salvar
          </button>
        </Dialog>
      )}

      {extraCostOpen && (
        <Dialog title="Novo custo avulso" onClose={() => setExtraCostOpen(false)}>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Nome do custo</label>
            <input value={extraCostName} onChange={(e) => setExtraCostName(e.target.value)} placeholder="Ex: mão de obra terceirizada" className={INPUT} />
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Valor (R$)</label>
            <input type="number" step="0.01" min="0" value={extraCostValue} onChange={(e) => setExtraCostValue(e.target.value)} placeholder="0,00" className={INPUT} />
          </div>
          <button
            type="button"
            onClick={() => {
              const value = Number(extraCostValue)
              if (!extraCostName.trim() || !Number.isFinite(value) || value < 0) return
              setExtraCosts((prev) => [...prev, { name: extraCostName.trim(), value }])
              setExtraCostName('')
              setExtraCostValue('')
              setExtraCostOpen(false)
            }}
            disabled={!extraCostName.trim() || !extraCostValue}
            className="w-full bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-40 text-white font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Adicionar custo
          </button>
        </Dialog>
      )}
    </div>
  )
}

function MarcasTab({ categories, onChanged }: { categories: Category[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const [name, setName] = useState('')
  const [deviceType, setDeviceType] = useState(DEVICE_TYPES[0])
  const [imageUrl, setImageUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openNew() {
    setName('')
    setDeviceType(DEVICE_TYPES[0])
    setImageUrl('')
    setEditing('new')
  }

  function openEdit(c: Category) {
    setName(c.name)
    setDeviceType(c.device_type)
    setImageUrl(c.image_url ?? '')
    setEditing(c)
  }

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const payload = { name: name.trim(), device_type: deviceType, image_url: imageUrl.trim() || undefined }
      if (editing === 'new') await eletronicosAdmin.catalogCategories.create(payload)
      else if (editing) await eletronicosAdmin.catalogCategories.update(editing.id, payload)
      setEditing(null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    try {
      await eletronicosAdmin.catalogCategories.delete(id)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao excluir (verifique se não há serviços usando essa marca)')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#d4d4d8]/50">{categories.length} marca{categories.length === 1 ? '' : 's'}/aparelho{categories.length === 1 ? '' : 's'}</p>
        <button onClick={openNew} className="flex items-center gap-1.5 bg-[#e0211a] hover:bg-[#a3140f] text-white text-sm font-medium px-3.5 py-2 rounded-xl transition-colors">
          <Plus className="w-4 h-4" /> Nova marca/aparelho
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {categories.map((c) => (
          <div key={c.id} className="bg-[#161618] rounded-xl border border-white/5 p-3">
            <div className="aspect-video bg-[#0a0a0b] rounded-lg overflow-hidden mb-2 flex items-center justify-center">
              {c.image_url ? <img src={c.image_url} alt={c.name} className="w-full h-full object-cover" /> : <Smartphone className="w-6 h-6 text-[#d4d4d8]/20" />}
            </div>
            <p className="text-sm font-semibold text-white truncate">{c.name}</p>
            <p className="text-xs text-[#d4d4d8]/50">{c.device_type}</p>
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => openEdit(c)} className="text-xs text-[#d4d4d8]/70 hover:text-white flex items-center gap-1">
                <Pencil className="w-3 h-3" /> Editar
              </button>
              <button onClick={() => remove(c.id)} className="text-xs text-[#d4d4d8]/70 hover:text-red-400 flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Excluir
              </button>
            </div>
          </div>
        ))}
        {categories.length === 0 && <p className="text-sm text-[#d4d4d8]/40 py-4 col-span-full">Nenhuma marca/aparelho cadastrado.</p>}
      </div>

      {editing && (
        <Dialog title={editing === 'new' ? 'Nova marca/aparelho' : 'Editar marca/aparelho'} onClose={() => setEditing(null)}>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} placeholder="Ex: iPhone" />
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Tipo de aparelho</label>
            <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className={INPUT}>
              {DEVICE_TYPES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">URL da imagem (banner)</label>
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className={INPUT} placeholder="https://..." />
          </div>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="w-full bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-40 text-white font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Salvar
          </button>
        </Dialog>
      )}
    </div>
  )
}

function EstoqueTab({ items, onChanged, filter }: { items: StockItem[]; onChanged: () => void; filter?: 'alerta' | 'falta' }) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('unidade')
  const [quantity, setQuantity] = useState('0')
  const [price, setPrice] = useState('')
  const [creating, setCreating] = useState(false)
  const [entryFor, setEntryFor] = useState<string | null>(null)
  const [entryQty, setEntryQty] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      await eletronicosAdmin.stockItems.create({
        name: name.trim(),
        unit,
        quantity: Number(quantity.replace(',', '.')) || 0,
        price: price.trim() ? Number(price.replace(',', '.')) : undefined,
      })
      setName('')
      setQuantity('0')
      setPrice('')
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao criar')
    } finally {
      setCreating(false)
    }
  }

  async function handleEntry(id: string) {
    const qty = Number(entryQty.replace(',', '.'))
    if (!qty || qty <= 0) return
    try {
      await eletronicosAdmin.stockItems.stockEntry(id, qty)
      setEntryFor(null)
      setEntryQty('')
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao lançar entrada')
    }
  }

  const visible = filter === 'alerta'
    ? items.filter((it) => it.low_stock_threshold != null && it.quantity <= it.low_stock_threshold)
    : filter === 'falta'
      ? items.filter((it) => it.quantity <= 0)
      : items

  return (
    <div className="space-y-3">
      {!filter && (
        <div className="bg-[#161618] rounded-2xl border border-white/5 p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da peça" className={`col-span-2 sm:col-span-1 ${INPUT}`} />
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unidade" className={INPUT} />
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Qtd inicial" className={INPUT} />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Custo (R$)" className={INPUT} />
          <button
            type="button"
            disabled={creating || !name.trim()}
            onClick={handleCreate}
            className="col-span-2 sm:col-span-4 rounded-xl bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-40 text-white font-semibold py-2 flex items-center justify-center gap-2 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> Cadastrar item
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="space-y-2">
        {visible.map((it) => (
          <div key={it.id} className="bg-[#161618] rounded-xl border border-white/5 p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">{it.name}</p>
              <p className="text-xs text-[#d4d4d8]/50">
                {it.quantity} {it.unit}
                {it.price != null && ` · ${currency(it.price)}`}
                {it.low_stock_threshold != null && it.quantity <= it.low_stock_threshold && <span className="text-amber-400 ml-2">estoque baixo</span>}
              </p>
            </div>
            {entryFor === it.id ? (
              <div className="flex items-center gap-2">
                <input value={entryQty} onChange={(e) => setEntryQty(e.target.value)} placeholder="qtd" className="w-20 rounded-lg border border-white/10 bg-[#0a0a0b] px-2 py-1.5 text-sm outline-none focus:border-[#e0211a]" />
                <button type="button" onClick={() => handleEntry(it.id)} className="rounded-lg bg-[#e0211a] text-white text-xs font-semibold px-3 py-1.5">
                  OK
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setEntryFor(it.id)} className="text-xs text-[#e0211a] hover:underline shrink-0">
                + Estoque
              </button>
            )}
          </div>
        ))}
        {visible.length === 0 && <p className="text-sm text-[#d4d4d8]/40 py-4">Nenhum item {filter === 'alerta' ? 'com estoque baixo' : filter === 'falta' ? 'em falta' : 'cadastrado'}.</p>}
      </div>
    </div>
  )
}

export default function EletronicaAdminEstoque() {
  const [tab, setTab] = useState<TabKey>('produtos')
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [stockItems, setStockItems] = useState<StockItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadCategories() {
    try {
      setCategories(await eletronicosAdmin.catalogCategories.list())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao carregar')
    }
  }
  async function loadStock() {
    try {
      setStockItems(await eletronicosAdmin.stockItems.list())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao carregar')
    }
  }

  useEffect(() => {
    loadCategories()
    loadStock()
  }, [])

  const lowStockCount = useMemo(() => (stockItems ?? []).filter((it) => it.low_stock_threshold != null && it.quantity <= it.low_stock_threshold).length, [stockItems])
  const outOfStockCount = useMemo(() => (stockItems ?? []).filter((it) => it.quantity <= 0).length, [stockItems])

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <h1 className="text-lg font-bold text-white">Produtos/Serviços</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tab === t.key ? 'bg-[#e0211a] text-white' : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:bg-[#232327]'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {t.key === 'alerta' && lowStockCount > 0 && <span className="ml-1 bg-white/20 rounded-full px-1.5 text-xs">{lowStockCount}</span>}
            {t.key === 'falta' && outOfStockCount > 0 && <span className="ml-1 bg-white/20 rounded-full px-1.5 text-xs">{outOfStockCount}</span>}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {tab === 'produtos' && (
        <div className="bg-[#161618] rounded-2xl border border-white/5 p-6 text-center space-y-3">
          <Package className="w-10 h-10 mx-auto text-[#d4d4d8]/30" />
          <p className="text-sm text-[#d4d4d8]/60">Catálogo de produtos físicos (peças, acessórios, aparelhos usados) — mesma tela e mesmo catálogo que a vitrine /loja já lê.</p>
          <Link
            to={`/admin/produtos${withTenantSearch()}`}
            className="inline-flex items-center gap-1.5 bg-[#e0211a] hover:bg-[#a3140f] text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
          >
            Abrir gerenciador de produtos <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {tab === 'servicos' && (categories ? <ServicosTab categories={categories} /> : <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#e0211a]" /></div>)}
      {tab === 'marcas' && (categories ? <MarcasTab categories={categories} onChanged={loadCategories} /> : <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#e0211a]" /></div>)}
      {(tab === 'estoque' || tab === 'alerta' || tab === 'falta') &&
        (stockItems ? (
          <EstoqueTab items={stockItems} onChanged={loadStock} filter={tab === 'alerta' ? 'alerta' : tab === 'falta' ? 'falta' : undefined} />
        ) : (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[#e0211a]" />
          </div>
        ))}
    </div>
  )
}
