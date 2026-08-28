import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Package, PackageX, Smartphone } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import {
  DevicesSection,
  ModelsSection,
  MarcasTab,
  EstoqueTab,
  StockAlertList,
  type Category,
  type StockItem,
  type DeviceType,
  type CatalogModelRow,
} from './EletronicaAdminEstoque'

// Página nova (rota /estoque) -- antes essas 6 seções ficavam dentro de
// Produtos/Serviços (EletronicaAdminEstoque.tsx), misturando cadastro
// comercial (produto/serviço vendido) com cadastro de infraestrutura
// (aparelho/marca/modelo/peça de estoque). Componentes continuam definidos
// lá e são só importados aqui, pra não duplicar lógica.

const TABS = [
  { key: 'aparelho', label: 'Aparelho', icon: Smartphone },
  { key: 'marca', label: 'Marca', icon: Smartphone },
  { key: 'modelo', label: 'Modelo', icon: Package },
  { key: 'item', label: 'Item de estoque', icon: Package },
  { key: 'alerta', label: 'Alerta de reposição', icon: AlertTriangle },
  { key: 'falta', label: 'Em falta', icon: PackageX },
] as const
type TabKey = (typeof TABS)[number]['key']

export default function EletronicaEstoquePage() {
  const [tab, setTab] = useState<TabKey>('aparelho')
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([])
  const [models, setModels] = useState<CatalogModelRow[]>([])
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
    eletronicosAdmin.deviceTypes.list().then(setDeviceTypes).catch(() => {})
    eletronicosAdmin.catalogModels.list().then(setModels).catch(() => {})
  }, [])

  const lowStockCount = useMemo(
    () => (stockItems ?? []).filter((it) => it.low_stock_threshold != null && it.quantity <= it.low_stock_threshold).length,
    [stockItems],
  )
  const outOfStockCount = useMemo(() => (stockItems ?? []).filter((it) => it.quantity <= 0).length, [stockItems])

  const loading = <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#e0211a]" /></div>

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <h1 className="text-lg font-bold text-white">Estoque</h1>

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

      {tab === 'aparelho' && <DevicesSection deviceTypes={deviceTypes} setDeviceTypes={setDeviceTypes} />}

      {tab === 'marca' && (categories ? <MarcasTab categories={categories} onChanged={loadCategories} deviceTypes={deviceTypes} /> : loading)}

      {tab === 'modelo' && (categories ? <ModelsSection categories={categories} models={models} setModels={setModels} /> : loading)}

      {tab === 'item' && (stockItems ? <EstoqueTab items={stockItems} onChanged={loadStock} /> : loading)}

      {tab === 'alerta' && (
        <StockAlertList
          title="Alerta de reposição"
          emptyMessage="Nenhum item em baixo estoque no momento."
          filter={(quantity, threshold) => threshold != null && quantity > 0 && quantity <= threshold}
        />
      )}
      {tab === 'falta' && (
        <StockAlertList title="Em falta" emptyMessage="Nenhum item em falta no momento." filter={(quantity) => quantity <= 0} />
      )}
    </div>
  )
}
