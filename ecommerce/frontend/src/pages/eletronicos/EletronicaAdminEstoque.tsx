import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ExternalLink, Loader2, Package, PackageX, Pencil, Plus, Smartphone, Trash2, Wrench, X } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { EletronicaAdminCatalogItem } from '../../lib/eletronicosAdminApi'
import { withTenantSearch } from '../../lib/tenantConfig'

// Port simplificado (gaps disclosed abaixo) de
// src/app/dashboard/produtos/ProdutosClient.tsx do vrtech -- mesmas 6 abas
// (Produtos/Serviços/Estoque/Aparelho·Marca·Modelo/Alerta de reposição/Em
// falta). "Produtos" reaproveita a tela real e já existente /admin/produtos
// (mesma tabela `products` que a vitrine /loja já lê) em vez de duplicar.
// Serviços/Aparelho-Marca-Modelo são CRUD novo (backend não tinha rota
// nenhuma pra editar o catálogo de serviços, só leitura pública).
//
// Gaps disclosed: sem o vínculo multi-select aparelho/marca/modelo por
// serviço do original (aqui é 1 categoria só por serviço), sem peças de
// estoque como dependência de custo nem custos extras avulsos, sem
// hierarquia separada de "modelo" dentro da marca (aqui modelo é só um
// texto livre no próprio serviço, como já era antes).

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

function ServicosTab({ categories }: { categories: Category[] }) {
  const [items, setItems] = useState<EletronicaAdminCatalogItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EletronicaAdminCatalogItem | 'new' | null>(null)
  const [saving, setSaving] = useState(false)

  const [categoryId, setCategoryId] = useState('')
  const [modelName, setModelName] = useState('')
  const [repairType, setRepairType] = useState('')
  const [price, setPrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [duration, setDuration] = useState('60')
  const [description, setDescription] = useState('')
  const [active, setActive] = useState(true)

  async function load() {
    try {
      setItems(await eletronicosAdmin.catalogItems.list())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao carregar')
    }
  }

  useEffect(() => {
    load()
  }, [])

  function openNew() {
    setCategoryId(categories[0]?.id ?? '')
    setModelName('')
    setRepairType('')
    setPrice('')
    setCostPrice('')
    setDuration('60')
    setDescription('')
    setActive(true)
    setEditing('new')
  }

  function openEdit(item: EletronicaAdminCatalogItem) {
    setCategoryId(item.category_id)
    setModelName(item.model_name ?? '')
    setRepairType(item.repair_type)
    setPrice(String(item.price))
    setCostPrice(String(item.cost_price))
    setDuration(String(item.duration_minutes))
    setDescription(item.description ?? '')
    setActive(item.active)
    setEditing(item)
  }

  async function save() {
    if (!categoryId || !repairType.trim() || !price) return
    setSaving(true)
    setError(null)
    try {
      const payload = {
        category_id: categoryId,
        model_name: modelName.trim() || null,
        repair_type: repairType.trim(),
        price: Number(price.replace(',', '.')) || 0,
        cost_price: Number(costPrice.replace(',', '.')) || 0,
        duration_minutes: Number(duration) || 60,
        description: description.trim() || null,
        image_url: editing !== 'new' ? editing?.image_url ?? null : null,
        tags: editing !== 'new' ? editing?.tags ?? [] : [],
        active,
        sort_order: editing !== 'new' ? editing?.sort_order ?? 0 : 0,
      }
      if (editing === 'new') await eletronicosAdmin.catalogItems.create(payload)
      else if (editing) await eletronicosAdmin.catalogItems.update(editing.id, payload)
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
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Marca/aparelho</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={INPUT}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Modelo (opcional — vazio = universal)</label>
            <input value={modelName} onChange={(e) => setModelName(e.target.value)} className={INPUT} placeholder="Ex: iPhone 13" />
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Tipo de reparo</label>
            <input value={repairType} onChange={(e) => setRepairType(e.target.value)} className={INPUT} placeholder="Ex: Troca de tela" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-[#d4d4d8] mb-1.5">Preço (R$)</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} className={INPUT} placeholder="0,00" />
            </div>
            <div>
              <label className="block text-sm text-[#d4d4d8] mb-1.5">Custo (R$)</label>
              <input value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className={INPUT} placeholder="0,00" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Duração do atendimento (min)</label>
            <input value={duration} onChange={(e) => setDuration(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className="block text-sm text-[#d4d4d8] mb-1.5">Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${INPUT} resize-none`} />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#d4d4d8] cursor-pointer">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[#e0211a]" />
            Ativo (visível na vitrine)
          </label>
          <button
            onClick={save}
            disabled={saving || !categoryId || !repairType.trim() || !price}
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
