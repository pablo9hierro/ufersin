import { useState } from 'react'
import { motion } from 'framer-motion'
import { LayoutDashboard, Play, Smartphone, Store } from 'lucide-react'

const SCREENS = [
  { icon: Store, label: 'Loja do cliente', desc: 'Catálogo, carrinho e checkout que seu cliente final vê.' },
  { icon: LayoutDashboard, label: 'Painel admin', desc: 'Pedidos, produtos e financeiro, tudo em tempo real.' },
  { icon: Smartphone, label: 'App do motoboy', desc: 'Fila de entregas, rota otimizada e confirmação de pagamento.' },
]

/**
 * "Vídeo demonstrativo" fake — sem gravação real ainda, então isso é uma
 * prévia visual clicável (troca de mockup) em vez de fingir um player de
 * vídeo funcional com um src inválido.
 */
export default function Demo() {
  const [active, setActive] = useState(0)
  const Screen = SCREENS[active]

  return (
    <section id="demonstracao" className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="uf-eyebrow mb-4">Demonstração</span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            Veja a <span className="uf-text">Rodoletas</span> por dentro
          </h2>
        </motion.div>

        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6 items-center">
          <div className="flex lg:flex-col gap-3 order-2 lg:order-1">
            {SCREENS.map((s, i) => (
              <button
                key={s.label}
                onClick={() => setActive(i)}
                className={`text-left flex items-start gap-3 p-4 rounded-2xl border transition-all ${
                  active === i ? 'uf-glass border-white/20' : 'border-white/5 hover:border-white/10'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${active === i ? 'uf-bg' : 'bg-white/5'}`}>
                  <s.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{s.label}</p>
                  <p className="text-xs text-uf-silver-dim mt-0.5 hidden sm:block">{s.desc}</p>
                </div>
              </button>
            ))}
          </div>

          <motion.div
            key={active}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
            className="uf-glass rounded-3xl p-2 sm:p-3 order-1 lg:order-2"
          >
            <div className="rounded-2xl bg-uf-surface aspect-video relative overflow-hidden flex items-center justify-center group cursor-pointer">
              <div className="uf-mesh opacity-50" />
              <div className="relative z-10 flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full uf-bg flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Play className="w-6 h-6 text-white ml-1" fill="white" />
                </div>
                <p className="text-sm text-uf-silver-dim">{Screen.label}</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
