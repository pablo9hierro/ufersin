import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Battery,
  Camera,
  Check,
  ChevronDown,
  Search,
  ShoppingCart,
  Smartphone,
  Stethoscope,
  Wrench,
  Zap,
} from 'lucide-react'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { resolveTenantSlug, withTenantSearch } from '../../lib/tenantConfig'
import { fetchCatalog, type CatalogCategory, type CatalogItem } from '../../lib/eletronicosApi'
import EletronicaServiceRequestForm from './EletronicaServiceRequestForm'
import EletronicaCarrinhoFlutuante from './EletronicaCarrinhoFlutuante'

// Port 1:1 de src/app/catalogo-servico/page.tsx + DiagnosticoToggle.tsx +
// CatalogoClient.tsx do vrtech: header, título "Serviços e orçamento", o
// toggle "Quebrou o aparelho..." e a listagem completa por marca/modelo
// (banner com foto, filtro de tipo de reparo, busca, card com foto/tags).
//
// Única adaptação real: "Adicionar ao carrinho" do original manda pra um
// carrinho genérico (useCart) que finaliza como pedido de produto -- esse
// carrinho não existe pra serviço no motor novo (é um sistema à parte, não
// construído ainda). Em vez de fingir um carrinho que não leva a lugar
// nenhum, o clique abre o formulário de solicitação já com aparelho e
// serviço escolhidos (mesmo resultado prático: o cliente termina pedindo
// o orçamento desse serviço, só sem a etapa de carrinho no meio).

const REPAIR_ICONS: Record<string, React.ReactNode> = {
  'Troca de tela': <Smartphone className="w-4 h-4" />,
  'Troca de bateria': <Battery className="w-4 h-4" />,
  'Reparo de carregador': <Zap className="w-4 h-4" />,
  'Reparo de conector de carregador': <Zap className="w-4 h-4" />,
  'Troca de câmera traseira': <Camera className="w-4 h-4" />,
}
const repairIcon = (rt: string) => REPAIR_ICONS[rt] ?? <Wrench className="w-4 h-4" />

function AccordionTags({ tags }: { tags?: string[] | null }) {
  const [open, setOpen] = useState(false)
  if (!tags || tags.length === 0) return null
  return (
    <div className="border-t border-white/5 mt-1 pt-1">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="w-full flex items-center justify-between text-[10px] py-1 text-[#d4d4d8]/40 hover:text-[#d4d4d8]/70 transition-colors"
      >
        <span>Detalhes</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-wrap gap-1 pb-1.5">
          {tags.map((tag) => (
            <span key={tag} className="text-[10px] rounded-full px-2 py-0.5 text-[#d4d4d8]/60 bg-white/5">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function DiagnosticoToggle({
  open,
  onOpenChange,
  selection,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  selection: React.ComponentProps<typeof EletronicaServiceRequestForm>['initialSelection']
}) {
  return (
    <div className="bg-[#161618] border border-white/5 rounded-2xl overflow-hidden mb-10">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="w-full flex items-center gap-4 p-6 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="w-12 h-12 rounded-xl bg-[#e0211a]/10 text-[#e0211a] flex items-center justify-center shrink-0">
          <Stethoscope className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold">Quebrou o aparelho e não sabe onde exatamente ele quebrou?</h2>
          <p className="text-[#d4d4d8]/60 text-sm mt-0.5">
            Solicite seu orçamento — faça um diagnóstico para saber qual o problema do aparelho danificado.
          </p>
        </div>
        <ChevronDown className={`w-5 h-5 text-[#d4d4d8]/50 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="p-6 pt-0">
          <div className="border-t border-white/5 pt-6">
            <EletronicaServiceRequestForm diagnosisOnly={!selection} initialSelection={selection} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function EletronicaCatalogoServico() {
  useTenantConfig()
  const slug = resolveTenantSlug()
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [items, setItems] = useState<CatalogItem[]>([])
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedRepairTypes, setSelectedRepairTypes] = useState<Set<string>>(new Set())
  const [toggleOpen, setToggleOpen] = useState(false)
  const [addedSelection, setAddedSelection] = useState<
    React.ComponentProps<typeof EletronicaServiceRequestForm>['initialSelection']
  >(null)
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!slug) return
    fetchCatalog(slug).then((res) => {
      const cats = res.categories.filter((c) => !c.slug.startsWith('servicos-'))
      setCategories(cats)
      setItems(res.items)
      setActiveSlug(cats[0]?.slug ?? null)
    })
  }, [slug])

  const activeCategory = categories.find((c) => c.slug === activeSlug)
  const categoryItems = useMemo(
    () => (activeCategory ? items.filter((i) => i.category_id === activeCategory.id) : items),
    [items, activeCategory],
  )

  const allRepairTypes = useMemo(() => {
    const types = new Set<string>()
    for (const i of categoryItems) types.add(i.repair_type)
    return Array.from(types).sort()
  }, [categoryItems])

  function handleBrandChange(slugKey: string) {
    setActiveSlug(slugKey)
    setSelectedRepairTypes(new Set())
    setSearch('')
  }

  function toggleRepairType(rt: string) {
    setSelectedRepairTypes((prev) => {
      const next = new Set(prev)
      if (next.has(rt)) next.delete(rt)
      else next.add(rt)
      return next
    })
  }

  const filtered = useMemo(() => {
    let base = categoryItems
    if (selectedRepairTypes.size > 0) base = base.filter((i) => selectedRepairTypes.has(i.repair_type))
    const q = search.trim().toLowerCase()
    if (!q) return base
    return base.filter(
      (i) =>
        (i.model_name ?? '').toLowerCase().includes(q) ||
        i.repair_type.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q) ||
        (i.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    )
  }, [categoryItems, selectedRepairTypes, search])

  const byModel = useMemo(() => {
    const map = new Map<string, CatalogItem[]>()
    for (const item of filtered) {
      const key = item.model_name ?? 'Universal (todos os modelos)'
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return map
  }, [filtered])

  function handleAdd(item: CatalogItem) {
    if (!activeCategory) return
    setAddedSelection({
      deviceType: activeCategory.device_type as 'celular' | 'tablet' | 'notebook' | 'computador',
      brandId: activeCategory.id,
      modelName: item.model_name ?? 'Universal',
      serviceId: item.id,
    })
    setToggleOpen(true)
    setRecentlyAdded((prev) => {
      const next = new Set(prev)
      next.add(item.id)
      setTimeout(() => setRecentlyAdded((p) => { const n = new Set(p); n.delete(item.id); return n }), 1500)
      return next
    })
    document.getElementById('diagnostico-toggle')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      <header className="px-5 sm:px-10 py-5 flex items-center justify-between max-w-6xl mx-auto border-b border-white/5">
        <Link to={`/${withTenantSearch()}`}>
          <img
            src="https://res.cloudinary.com/dkqhped8y/image/upload/v1783212643/iconelogo_rpcnvw.png"
            alt="VR Tech"
            width={56}
            height={56}
            className="rounded-lg block"
          />
        </Link>
        <Link to={`/${withTenantSearch()}`} className="flex items-center gap-1.5 text-sm font-medium text-[#d4d4d8] hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </Link>
      </header>

      <section className="px-5 sm:px-10 py-10 max-w-5xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-black mb-2">
          Serviços e <span className="text-[#e0211a]">orçamento</span>
        </h1>
        <p className="text-[#d4d4d8]/60 mb-8 text-sm max-w-lg">
          Consulte os valores por modelo de celular e tipo de reparo. Preços sujeitos a alteração — confirme no orçamento.
        </p>

        <div id="diagnostico-toggle">
          <DiagnosticoToggle open={toggleOpen} onOpenChange={setToggleOpen} selection={addedSelection} />
        </div>

        {categories.length === 0 ? (
          <div className="text-center py-16 text-[#d4d4d8]/40">
            <Wrench className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Catálogo em construção. Em breve!</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((cat) => (
                <button
                  key={cat.slug}
                  type="button"
                  onClick={() => handleBrandChange(cat.slug)}
                  className={`shrink-0 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    activeSlug === cat.slug
                      ? 'bg-[#e0211a] text-white shadow-lg shadow-[#e0211a]/20'
                      : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:border-[#e0211a]/30'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {activeCategory?.image_url && (
              <div className="relative w-full h-36 rounded-2xl overflow-hidden">
                <img src={activeCategory.image_url} alt={activeCategory.name} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0b]/80 via-[#0a0a0b]/40 to-transparent" />
                <div className="absolute inset-0 flex items-center px-6">
                  <div>
                    <p className="text-xs font-semibold text-[#e0211a] uppercase tracking-widest mb-1">Reparos</p>
                    <h2 className="text-2xl font-black text-white">{activeCategory.name}</h2>
                    <p className="text-[#d4d4d8]/60 text-xs mt-0.5">{categoryItems.length} serviços disponíveis</p>
                  </div>
                </div>
              </div>
            )}

            {allRepairTypes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {allRepairTypes.map((rt) => {
                  const sel = selectedRepairTypes.has(rt)
                  return (
                    <button
                      key={rt}
                      type="button"
                      onClick={() => toggleRepairType(rt)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                        sel ? 'bg-[#e0211a]/20 border-[#e0211a] text-[#e0211a]' : 'bg-transparent border-white/10 text-[#d4d4d8]/60 hover:border-white/30 hover:text-white'
                      }`}
                    >
                      {sel && <Check className="w-3 h-3" />}
                      {rt}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="relative">
              <Search className="w-4 h-4 text-[#d4d4d8]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar modelo ou tipo de reparo..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#161618] border border-white/5 text-white placeholder-[#d4d4d8]/40 text-sm outline-none focus:border-[#e0211a]/40 transition-colors"
              />
            </div>

            {byModel.size === 0 ? (
              <div className="text-center py-12 text-[#d4d4d8]/40">
                <p>Nenhum serviço encontrado.</p>
              </div>
            ) : (
              <div className="space-y-10">
                {Array.from(byModel.entries()).map(([modelName, modelItems]) => {
                  const modelImage = modelItems[0]?.image_url
                  return (
                    <section key={modelName}>
                      <div className="flex items-center gap-3 mb-4">
                        {modelImage ? (
                          <div className="w-14 h-14 rounded-xl overflow-hidden border border-white/10 shrink-0 bg-[#161618]">
                            <img src={modelImage} alt={modelName} className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-[#161618] border border-white/10 shrink-0 flex items-center justify-center">
                            <Smartphone className="w-6 h-6 text-[#d4d4d8]/30" />
                          </div>
                        )}
                        <div>
                          <h3 className="text-white font-bold text-base">{modelName}</h3>
                          <p className="text-[#d4d4d8]/40 text-xs">
                            {modelItems.length} serviço{modelItems.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {modelItems.map((item) => {
                          const added = recentlyAdded.has(item.id)
                          return (
                            <div key={item.id} className="bg-[#161618] border border-white/5 rounded-2xl overflow-hidden hover:border-[#e0211a]/20 transition-all group">
                              {modelImage && (
                                <div className="h-24 overflow-hidden relative">
                                  <img
                                    src={modelImage}
                                    alt={modelName}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#161618]" />
                                </div>
                              )}
                              <div className="p-4">
                                <div className="flex items-start justify-between gap-3 mb-3">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-[#e0211a] shrink-0">{repairIcon(item.repair_type)}</span>
                                    <span className="text-sm font-bold text-white leading-tight">{item.repair_type}</span>
                                  </div>
                                  <span className="text-[#e0211a] font-black text-base whitespace-nowrap shrink-0">
                                    R$ {Number(item.price).toFixed(2).replace('.', ',')}
                                  </span>
                                </div>
                                {item.description && <p className="text-xs text-[#d4d4d8]/55 leading-relaxed mb-3">{item.description}</p>}
                                <button
                                  type="button"
                                  onClick={() => handleAdd(item)}
                                  className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                                    added
                                      ? 'bg-green-600 text-white'
                                      : 'bg-[#0a0a0b] border border-white/10 text-[#d4d4d8] hover:border-[#e0211a]/40 hover:text-white'
                                  }`}
                                >
                                  {added ? (
                                    <>
                                      <Check className="w-3.5 h-3.5" /> Adicionado!
                                    </>
                                  ) : (
                                    <>
                                      <ShoppingCart className="w-3.5 h-3.5" /> Adicionar ao carrinho
                                    </>
                                  )}
                                </button>
                                <AccordionTags tags={item.tags} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </section>
      <EletronicaCarrinhoFlutuante />
    </main>
  )
}
