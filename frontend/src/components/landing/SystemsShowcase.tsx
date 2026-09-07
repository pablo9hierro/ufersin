import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bike, ChefHat, ClipboardList, CreditCard, FileText, Loader2, Package, ShoppingBag, Wrench } from 'lucide-react'
import { CmsText } from '../../lib/cms'
import { fetchDemoAdminAutoLoginUrl } from '../../lib/ecommerceUrl'
import FeaturePreviewDialog from './FeaturePreviewDialog'

type Item = {
  key: string
  icon: typeof FileText
  title: string
  desc: string
  /** Rota real do painel admin (motor de loja) -- carregada num iframe
   * autenticado em modo demo, é a tela de verdade, não print/mockup. */
  path: string
}

const ITEMS: Item[] = [
  {
    key: 'systems.fiscal',
    icon: FileText,
    title: 'Nota fiscal (NF-e/NFC-e)',
    desc: 'Emissão automática assim que o pagamento cai. Nunca mais tirar nota na mão.',
    path: '/admin/fiscal',
  },
  {
    key: 'systems.servicos',
    icon: Wrench,
    title: 'Catálogo de serviços',
    desc: 'Vende produto e serviço na mesma vitrine, sem precisar de outro sistema.',
    path: '/admin/produtos/servicos',
  },
  {
    key: 'systems.formulacao',
    icon: Package,
    title: 'Ficha técnica e estoque',
    desc: 'Cadastra os insumos de um produto e o estoque final é calculado sozinho.',
    path: '/admin/estoque',
  },
  {
    key: 'systems.estoque-servico',
    icon: ClipboardList,
    title: 'Serviço vinculado a estoque',
    desc: 'Liga uma peça ao serviço — ao concluir, o estoque baixa sozinho, sem lançar nada manual.',
    path: '/admin/produtos/servicos',
  },
  {
    key: 'systems.uber',
    icon: Bike,
    title: 'Uber Direct nativo',
    desc: 'Chama o entregador direto do painel e acompanha a corrida em tempo real, sem app terceiro.',
    path: '/admin/entregas-terceirizadas',
  },
  {
    key: 'systems.point',
    icon: CreditCard,
    title: 'Mercado Pago Point',
    desc: 'Cobra na maquininha direto do pedido — sem sair do painel pra outro app.',
    path: '/admin/mercadopago-point',
  },
  {
    key: 'systems.cozinha',
    icon: ChefHat,
    title: 'Tela de cozinha',
    desc: 'Pedido cai direto na cozinha, organizado por status — sem grito, sem papel.',
    path: '/cozinha',
  },
  {
    key: 'systems.pdv',
    icon: ShoppingBag,
    title: 'PDV com comandas',
    desc: 'Venda de balcão e comanda de mesa no mesmo sistema, sincronizado com o estoque.',
    path: '/admin/pdv',
  },
]

export default function SystemsShowcase() {
  const [open, setOpen] = useState<Item | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSrc(null)
    setPreviewError(null)
    // Sessão real (JWT de verdade) contra o tenant demo-ecommerce seedado em
    // produção -- não é mock local. É a tela de admin de verdade rodando.
    fetchDemoAdminAutoLoginUrl('ecommerce', open.path)
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setPreviewError('Não foi possível carregar o preview agora. Tente de novo em instantes.')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <section className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="uf-eyebrow mb-4">Como funciona</span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            <CmsText contentKey="systems.title">Clique e veja cada recurso na prática</CmsText>
          </h2>
          <p className="mt-4 text-uf-silver-dim max-w-xl mx-auto">
            <CmsText contentKey="systems.sub">
              Sem enrolação — a tela que abre é o painel de verdade, rodando com dados de demonstração.
            </CmsText>
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ITEMS.map((it) => (
            <button
              key={it.key}
              onClick={() => setOpen(it)}
              className="uf-glass uf-glass-hover rounded-2xl p-5 text-left transition-transform hover:-translate-y-0.5"
            >
              <div className="w-10 h-10 rounded-xl uf-bg flex items-center justify-center mb-3">
                <it.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-bold text-sm mb-1">
                <CmsText contentKey={`${it.key}.title`} fallback={it.title} />
              </h3>
              <p className="text-xs text-uf-silver-dim leading-relaxed">
                <CmsText contentKey={`${it.key}.desc`} fallback={it.desc} />
              </p>
            </button>
          ))}
        </div>
      </div>

      {open && (
        <FeaturePreviewDialog title={open.title} desc={open.desc} onClose={() => setOpen(null)} wide>
          {previewError ? (
            <p className="error-msg">{previewError}</p>
          ) : src ? (
            <iframe
              title={`Preview — ${open.title}`}
              src={src}
              className="w-full h-[65vh] rounded-xl border border-white/10 bg-black"
              allow="clipboard-write"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="h-[65vh] flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
            </div>
          )}
        </FeaturePreviewDialog>
      )}
    </section>
  )
}
