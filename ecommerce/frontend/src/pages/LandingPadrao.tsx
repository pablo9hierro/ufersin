import { motion } from 'framer-motion'
import { Clock, MapPin, MessageCircle, ShoppingBag, Star, Truck, Wallet } from 'lucide-react'

/**
 * Vitrine PADRÃO — tema novo, separado do tema do Sunset (que é
 * intransferível, feito sob medida pra marca Sunset Tabas). Esta é a Home
 * que um lojista novo assinante da Rodoletas (plano sem layout
 * personalizado) vê por padrão: pizzaria, tabacaria, loja de bairro em
 * geral — paleta clara/quente, cartões de produto grandes, foco em
 * conversão local (WhatsApp, Pix, entrega rápida).
 *
 * Conteúdo abaixo é só exemplo/mock — ainda não puxa dados reais do tenant
 * (isso depende do motor de multi-tenancy no frontend, que é trabalho
 * futuro; ver ecommerce/README-TENANCY.md). Rota de preview: /vitrine-padrao.
 */

const CATEGORIAS = ['Todos', 'Pizzas', 'Bebidas', 'Sobremesas', 'Promoções']

const PRODUTOS = [
  { emoji: '🍕', nome: 'Pizza Margherita', desc: 'Molho de tomate, mussarela e manjericão', preco: 'R$ 42,90' },
  { emoji: '🍕', nome: 'Pizza Calabresa', desc: 'Calabresa fatiada, cebola e azeitona', preco: 'R$ 44,90' },
  { emoji: '🥤', nome: 'Refrigerante 2L', desc: 'Gelado, várias opções', preco: 'R$ 12,00' },
  { emoji: '🍰', nome: 'Petit Gateau', desc: 'Com sorvete de creme', preco: 'R$ 18,90' },
]

const DESTAQUES = [
  { icon: Truck, title: 'Entrega rápida', desc: 'Saindo em minutos, direto na sua porta' },
  { icon: Wallet, title: 'Pague com Pix', desc: 'Aprovação na hora, sem complicação' },
  { icon: Star, title: '4,8 de avaliação', desc: 'Clientes satisfeitos toda semana' },
]

export default function LandingPadrao() {
  return (
    <main className="min-h-screen bg-[#fffaf3] text-[#2b1b12]">
      {/* Barra de anúncio */}
      <div className="bg-[#d94f2b] text-white text-xs sm:text-sm text-center py-2 px-4">
        🔥 Aberto agora — pedidos até às 23h · Entrega em até 40min
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#fffaf3]/90 backdrop-blur border-b border-[#2b1b12]/10">
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#d94f2b] flex items-center justify-center text-white font-black text-sm">
              SL
            </div>
            <span className="font-black text-lg">Sua Loja</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="#cardapio"
              className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-[#2b1b12]/70 hover:text-[#2b1b12]"
            >
              Ver cardápio
            </a>
            <button className="w-10 h-10 rounded-full bg-[#2b1b12]/5 flex items-center justify-center relative">
              <ShoppingBag className="w-4.5 h-4.5" />
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#d94f2b] text-white text-[10px] font-bold flex items-center justify-center">
                2
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-5 pt-12 pb-10 sm:pt-20 sm:pb-16 grid md:grid-cols-2 gap-10 items-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-1.5 bg-[#d94f2b]/10 text-[#d94f2b] text-xs font-bold px-3 py-1.5 rounded-full mb-4">
              🍕 Feito na hora, todo dia
            </span>
            <h1 className="text-4xl sm:text-5xl font-black leading-tight mb-4">
              Fome? <span className="text-[#d94f2b]">A gente entrega</span> em minutos
            </h1>
            <p className="text-[#2b1b12]/70 text-base sm:text-lg mb-7 max-w-md">
              Pizzas, bebidas e sobremesas feitas com carinho. Peça pelo site ou chama a gente no WhatsApp.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href="#cardapio"
                className="inline-flex items-center justify-center gap-2 bg-[#d94f2b] text-white font-bold px-7 py-3.5 rounded-2xl hover:bg-[#c2431f] transition-colors"
              >
                Ver cardápio
              </a>
              <a
                href="#"
                className="inline-flex items-center justify-center gap-2 border-2 border-[#2b1b12]/15 font-bold px-7 py-3.5 rounded-2xl hover:border-[#2b1b12]/30 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Pedir pelo WhatsApp
              </a>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="relative"
          >
            <div className="aspect-square rounded-[2.5rem] bg-gradient-to-br from-[#f4a860] to-[#d94f2b] flex items-center justify-center text-[7rem] sm:text-[9rem] shadow-2xl shadow-[#d94f2b]/20">
              🍕
            </div>
            <div className="absolute -bottom-4 -left-4 bg-white rounded-2xl shadow-xl px-4 py-3 flex items-center gap-2.5">
              <Clock className="w-5 h-5 text-[#d94f2b]" />
              <div>
                <p className="text-xs text-[#2b1b12]/60">Tempo médio</p>
                <p className="text-sm font-bold">30-40 min</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Destaques de confiança */}
      <section className="max-w-6xl mx-auto px-5 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {DESTAQUES.map((d) => (
            <div key={d.title} className="bg-white rounded-2xl p-5 flex items-center gap-4 shadow-sm border border-[#2b1b12]/5">
              <div className="w-11 h-11 rounded-xl bg-[#d94f2b]/10 flex items-center justify-center shrink-0">
                <d.icon className="w-5 h-5 text-[#d94f2b]" />
              </div>
              <div>
                <p className="font-bold text-sm">{d.title}</p>
                <p className="text-xs text-[#2b1b12]/60">{d.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Categorias */}
      <section id="cardapio" className="max-w-6xl mx-auto px-5 pt-6 pb-2">
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {CATEGORIAS.map((c, i) => (
            <button
              key={c}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                i === 0 ? 'bg-[#2b1b12] text-white border-[#2b1b12]' : 'border-[#2b1b12]/15 text-[#2b1b12]/70 hover:border-[#2b1b12]/30'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </section>

      {/* Produtos */}
      <section className="max-w-6xl mx-auto px-5 py-8">
        <h2 className="text-2xl font-black mb-5">Mais pedidos</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {PRODUTOS.map((p) => (
            <motion.div
              key={p.nome}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.4 }}
              className="bg-white rounded-2xl overflow-hidden shadow-sm border border-[#2b1b12]/5 flex flex-col"
            >
              <div className="aspect-square bg-gradient-to-br from-[#fdebd9] to-[#f4a860]/40 flex items-center justify-center text-5xl">
                {p.emoji}
              </div>
              <div className="p-3.5 flex flex-col flex-1">
                <p className="font-bold text-sm">{p.nome}</p>
                <p className="text-xs text-[#2b1b12]/60 mt-0.5 flex-1">{p.desc}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="font-black text-sm">{p.preco}</span>
                  <button className="w-8 h-8 rounded-full bg-[#d94f2b] text-white flex items-center justify-center text-lg font-bold hover:bg-[#c2431f] transition-colors">
                    +
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Localização / rodapé */}
      <section className="mt-10 bg-[#2b1b12] text-white">
        <div className="max-w-6xl mx-auto px-5 py-12 grid sm:grid-cols-2 gap-8">
          <div>
            <p className="font-black text-xl mb-2">Sua Loja</p>
            <p className="text-white/60 text-sm max-w-xs">Feito com carinho pra você, todo santo dia.</p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end text-sm">
            <p className="flex items-center gap-2 text-white/80">
              <MapPin className="w-4 h-4 shrink-0" />
              Rua Exemplo, 123 - Centro
            </p>
            <p className="flex items-center gap-2 text-white/80">
              <Clock className="w-4 h-4 shrink-0" />
              Todos os dias, 18h às 23h
            </p>
            <a href="#" className="inline-flex items-center gap-2 bg-[#d94f2b] px-4 py-2.5 rounded-xl font-semibold mt-1">
              <MessageCircle className="w-4 h-4" />
              Falar no WhatsApp
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
