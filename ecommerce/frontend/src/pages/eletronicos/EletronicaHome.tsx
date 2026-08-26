import { Link } from 'react-router-dom'
import {
  Award,
  BatteryCharging,
  CheckCircle2,
  ClipboardList,
  Plug,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Wrench,
  Zap,
} from 'lucide-react'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { withTenantSearch } from '../../lib/tenantConfig'

// Port 1:1 de src/app/page.tsx do vrtech -- mesma landing de marketing
// (Hero + Serviços + Diferenciais + Footer), mesmo texto, mesmas cores.
// StoreLink -> Link do react-router; logo/loja_nome vem de tenantConfig em
// vez de fetchPlatformStoreConfig (mesmo dado, fonte já carregada aqui).

const SERVICES = [
  { icon: Smartphone, title: 'Troca de tela', desc: 'Telas originais com garantia para todas as marcas.' },
  { icon: BatteryCharging, title: 'Troca de bateria', desc: 'Recupere a autonomia do seu aparelho.' },
  { icon: Plug, title: 'Conector de carga', desc: 'Resolva carregamento lento ou intermitente.' },
  { icon: Wrench, title: 'Manutenção geral', desc: 'Diagnóstico completo e reparo especializado.' },
]

const HIGHLIGHTS = [
  { icon: ShieldCheck, label: 'Garantia nos serviços' },
  { icon: Zap, label: 'Atendimento ágil' },
  { icon: Award, label: 'Equipe especializada' },
  { icon: CheckCircle2, label: 'Acabamento confiável' },
]

export default function EletronicaHome() {
  const tenantConfig = useTenantConfig()
  const lojaNome = tenantConfig?.loja_nome || 'VR Tech'

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      <header className="px-5 sm:px-10 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <Link to={`/${withTenantSearch()}`} className="font-black text-xl">
          {tenantConfig?.logo_url ? (
            <img src={tenantConfig.logo_url} alt={lojaNome} width={80} height={80} className="rounded-lg block" />
          ) : (
            lojaNome
          )}
        </Link>
        <div className="flex items-center gap-4 sm:gap-6">
          <Link
            to={`/consultar${withTenantSearch()}`}
            className="flex items-center gap-1.5 text-sm font-medium text-[#d4d4d8] hover:text-white transition-colors"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">Acompanhar pedido</span>
          </Link>
        </div>
      </header>

      <section className="px-5 sm:px-10 pt-8 pb-16 max-w-6xl mx-auto text-center">
        <span className="inline-block text-[#e0211a] text-xs font-bold tracking-[0.3em] uppercase mb-4">
          Assistência técnica premium
        </span>
        <h1 className="text-4xl sm:text-6xl font-black leading-tight mb-4">
          Conserto de celular
          <br />
          com <span className="text-[#e0211a]">rapidez</span>, <span className="text-[#e0211a]">qualidade</span> e{' '}
          <span className="text-[#e0211a]">garantia</span>
        </h1>
        <p className="text-[#d4d4d8]/70 max-w-xl mx-auto mb-8">
          Buscamos, consertamos e devolvemos seu aparelho no seu endereço. Peça um orçamento gratuito agora mesmo.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to={`/catalogo${withTenantSearch()}`}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#e0211a] hover:bg-[#a3140f] text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
          >
            <ShoppingBag className="w-4 h-4" />
            Produtos
          </Link>
          <Link
            to={`/catalogo-servico${withTenantSearch()}`}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#161618] hover:bg-[#232327] text-white font-semibold py-3 px-6 rounded-xl border border-white/10 transition-all duration-200"
          >
            <Wrench className="w-4 h-4" />
            Serviços e Orçamento
          </Link>
          <Link
            to={`/consultar${withTenantSearch()}`}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#161618] hover:bg-[#232327] text-white font-semibold py-3 px-6 rounded-xl border border-white/10 transition-all duration-200"
          >
            <ClipboardList className="w-4 h-4" />
            Meu pedido
          </Link>
        </div>
      </section>

      <section className="px-5 sm:px-10 py-12 bg-[#161618]/40 border-y border-white/5">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-center text-2xl sm:text-3xl font-bold mb-2">Nossos serviços</h2>
          <p className="text-center text-[#d4d4d8]/60 mb-10 text-sm">Foco total em assistência técnica de celulares</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {SERVICES.map((s) => (
              <div key={s.title} className="bg-[#161618] border border-white/5 rounded-2xl p-5 hover:border-[#e0211a]/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-[#e0211a]/10 text-[#e0211a] flex items-center justify-center mb-3">
                  <s.icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold mb-1">{s.title}</h3>
                <p className="text-[#d4d4d8]/60 text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 sm:px-10 py-12 max-w-6xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {HIGHLIGHTS.map((h) => (
            <div key={h.label} className="flex flex-col items-center text-center gap-2 p-4">
              <div className="w-12 h-12 rounded-full bg-[#e0211a]/10 text-[#e0211a] flex items-center justify-center">
                <h.icon className="w-5 h-5" />
              </div>
              <span className="text-sm font-medium text-[#d4d4d8]">{h.label}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="px-5 sm:px-10 py-10 border-t border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col items-center gap-6 text-center">
          <span className="font-black text-lg">{lojaNome}</span>
          <div className="flex flex-wrap items-center justify-center gap-4">
            {SERVICES.map((s) => (
              <span key={s.title} className="flex items-center gap-1.5 text-xs text-[#d4d4d8]/60">
                <s.icon className="w-3.5 h-3.5 text-[#e0211a]" />
                {s.title}
              </span>
            ))}
          </div>
          <p className="text-[#d4d4d8]/40 text-xs">
            © {new Date().getFullYear()} {lojaNome}. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </main>
  )
}
