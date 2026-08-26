import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Battery, Camera, ChevronDown, Search, Smartphone, Stethoscope, Wrench, Zap } from 'lucide-react'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { resolveTenantSlug, withTenantSearch } from '../../lib/tenantConfig'
import { fetchCatalog, type CatalogCategory, type CatalogItem } from '../../lib/eletronicosApi'
import EletronicaServiceRequestForm from './EletronicaServiceRequestForm'

// Port 1:1 de src/app/catalogo-servico/page.tsx + DiagnosticoToggle.tsx do
// vrtech: header simples, título "Serviços e orçamento", o toggle
// "Quebrou o aparelho e não sabe onde exatamente ele quebrou?" (abre o
// mesmo wizard em modo diagnóstico) e a tabela de preços por marca/modelo
// (src/app/catalogo-servico/CatalogoClient.tsx) -- aqui sem "adicionar ao
// carrinho" porque o carrinho de serviços ainda não existe no motor novo,
// só a consulta de preço, que é o uso real desta página.

const REPAIR_ICONS: Record<string, React.ReactNode> = {
  'Troca de tela': <Smartphone className="w-4 h-4" />,
  'Troca de bateria': <Battery className="w-4 h-4" />,
  'Reparo de carregador': <Zap className="w-4 h-4" />,
  'Reparo de conector de carregador': <Zap className="w-4 h-4" />,
  'Troca de câmera traseira': <Camera className="w-4 h-4" />,
}
const repairIcon = (rt: string) => REPAIR_ICONS[rt] ?? <Wrench className="w-4 h-4" />

function DiagnosticoToggle() {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-[#161618] border border-white/5 rounded-2xl overflow-hidden mb-10">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-4 p-6 text-left hover:bg-white/[0.02] transition-colors">
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
            <EletronicaServiceRequestForm diagnosisOnly />
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return categoryItems
    return categoryItems.filter(
      (i) =>
        (i.model_name ?? '').toLowerCase().includes(q) ||
        i.repair_type.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q),
    )
  }, [categoryItems, search])

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

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      <header className="px-5 sm:px-10 py-5 flex items-center justify-between max-w-6xl mx-auto border-b border-white/5">
        <Link to={`/${withTenantSearch()}`} className="font-black text-lg">
          VR Tech
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

        <DiagnosticoToggle />

        {categories.length === 0 ? (
          <div className="text-center py-16 text-[#d4d4d8]/40">
            <Wrench className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Catálogo em construção. Em breve!</p>
          </div>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveSlug(c.slug)}
                  className={`shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                    activeSlug === c.slug ? 'bg-[#e0211a] text-white' : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:border-[#e0211a]/40'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <div className="relative mb-6">
              <Search className="w-4 h-4 text-[#d4d4d8]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar modelo ou tipo de reparo..."
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 bg-[#161618] text-white placeholder-white/25 focus:border-[#e0211a]/60 outline-none transition-all"
              />
            </div>

            <div className="space-y-6">
              {Array.from(byModel.entries()).map(([model, list]) => (
                <div key={model}>
                  <h3 className="text-sm font-bold text-[#d4d4d8]/70 mb-2">{model}</h3>
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    {list.map((item) => (
                      <div key={item.id} className="bg-[#161618] border border-white/5 rounded-2xl p-3.5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[#e0211a] shrink-0">{repairIcon(item.repair_type)}</span>
                          <span className="text-sm font-bold text-white">{item.repair_type}</span>
                        </div>
                        {item.description && <p className="text-xs text-[#d4d4d8]/55 mb-2">{item.description}</p>}
                        <span className="text-[#e0211a] font-black text-sm">R$ {Number(item.price).toFixed(2).replace('.', ',')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && <p className="text-center text-[#d4d4d8]/40 text-sm py-8">Nenhum serviço encontrado.</p>}
            </div>
          </>
        )}
      </section>
    </main>
  )
}
