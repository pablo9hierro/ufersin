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
import EletronicaCarrinhoFlutuante from './EletronicaCarrinhoFlutuante'

const LOGO_FALLBACK = 'https://res.cloudinary.com/dkqhped8y/image/upload/v1783212643/iconelogo_rpcnvw.png'

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
        <Link to={`/${withTenantSearch()}`}>
          <img src={tenantConfig?.logo_url || LOGO_FALLBACK} alt={lojaNome} width={80} height={80} className="rounded-lg block" />
        </Link>
        <div className="flex items-center gap-4 sm:gap-6">
          <Link
            to={`/catalogo${withTenantSearch()}`}
            className="flex items-center gap-1.5 text-sm font-medium text-[#d4d4d8] hover:text-white transition-colors"
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="hidden sm:inline">Catálogo</span>
          </Link>
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
        <p
          data-cms-editable="text:hero-desc"
          data-cms-label="Descrição do topo"
          data-cms-default="Buscamos, consertamos e devolvemos seu aparelho no seu endereço. Peça um orçamento gratuito agora mesmo."
          className="text-[#d4d4d8]/70 max-w-xl mx-auto mb-8"
        >
          {tenantConfig?.landing_texts?.['hero-desc']?.trim() ||
            'Buscamos, consertamos e devolvemos seu aparelho no seu endereço. Peça um orçamento gratuito agora mesmo.'}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to={`/catalogo${withTenantSearch()}`}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#e0211a] hover:bg-[#a3140f] text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
          >
            <ShoppingBag className="w-4 h-4" />
            <span data-cms-editable="text:btn-produtos" data-cms-label="Botão — Produtos" data-cms-default="Produtos">
              {tenantConfig?.landing_texts?.['btn-produtos']?.trim() || 'Produtos'}
            </span>
          </Link>
          <Link
            to={`/catalogo-servico${withTenantSearch()}`}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#161618] hover:bg-[#232327] text-white font-semibold py-3 px-6 rounded-xl border border-white/10 transition-all duration-200"
          >
            <Wrench className="w-4 h-4" />
            <span data-cms-editable="text:btn-servicos" data-cms-label="Botão — Serviços e Orçamento" data-cms-default="Serviços e Orçamento">
              {tenantConfig?.landing_texts?.['btn-servicos']?.trim() || 'Serviços e Orçamento'}
            </span>
          </Link>
          <Link
            to={`/consultar${withTenantSearch()}`}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#161618] hover:bg-[#232327] text-white font-semibold py-3 px-6 rounded-xl border border-white/10 transition-all duration-200"
          >
            <ClipboardList className="w-4 h-4" />
            <span data-cms-editable="text:btn-acompanhar" data-cms-label="Botão — Meu pedido" data-cms-default="Meu pedido">
              {tenantConfig?.landing_texts?.['btn-acompanhar']?.trim() || 'Meu pedido'}
            </span>
          </Link>
        </div>
      </section>

      <section className="px-5 sm:px-10 py-12 bg-[#161618]/40 border-y border-white/5">
        <div className="max-w-6xl mx-auto">
          <h2
            data-cms-editable="text:secao-servicos-titulo"
            data-cms-label="Título — Nossos serviços"
            data-cms-default="Nossos serviços"
            className="text-center text-2xl sm:text-3xl font-bold mb-2"
          >
            {tenantConfig?.landing_texts?.['secao-servicos-titulo']?.trim() || 'Nossos serviços'}
          </h2>
          <p
            data-cms-editable="text:secao-servicos-sub"
            data-cms-label="Subtítulo — Nossos serviços"
            data-cms-default="Foco total em assistência técnica de celulares"
            className="text-center text-[#d4d4d8]/60 mb-10 text-sm"
          >
            {tenantConfig?.landing_texts?.['secao-servicos-sub']?.trim() || 'Foco total em assistência técnica de celulares'}
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {SERVICES.map((s, i) => {
              const h = tenantConfig?.landing_highlights?.[i]
              const title = h?.title?.trim() || s.title
              const desc = h?.desc?.trim() || s.desc
              return (
                <div key={i} className="bg-[#161618] border border-white/5 rounded-2xl p-5 hover:border-[#e0211a]/40 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-[#e0211a]/10 text-[#e0211a] flex items-center justify-center mb-3">
                    <s.icon className="w-5 h-5" />
                  </div>
                  <h3 data-cms-editable={`highlight:${i}:title`} data-cms-default={s.title} className="font-bold mb-1">
                    {title}
                  </h3>
                  <p data-cms-editable={`highlight:${i}:desc`} data-cms-default={s.desc} className="text-[#d4d4d8]/60 text-sm">
                    {desc}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="px-5 sm:px-10 py-12 max-w-6xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {HIGHLIGHTS.map((h, i) => {
            const key = `selo${i}`
            const label = tenantConfig?.landing_texts?.[key]?.trim() || h.label
            return (
              <div key={h.label} className="flex flex-col items-center text-center gap-2 p-4">
                <div className="w-12 h-12 rounded-full bg-[#e0211a]/10 text-[#e0211a] flex items-center justify-center">
                  <h.icon className="w-5 h-5" />
                </div>
                <span
                  data-cms-editable={`text:${key}`}
                  data-cms-label={`Selo ${i + 1}`}
                  data-cms-default={h.label}
                  className="text-sm font-medium text-[#d4d4d8]"
                >
                  {label}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <footer className="px-5 sm:px-10 py-10 border-t border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col items-center gap-6 text-center">
          <div>
            <p className="font-black text-lg">{lojaNome}</p>
            <p
              data-cms-editable="text:rodape-tagline"
              data-cms-label="Rodapé — texto abaixo do nome"
              data-cms-default="Assistência técnica especializada"
              className="text-[10px] tracking-[0.2em] uppercase text-[#d4d4d8]/40 mt-0.5"
            >
              {tenantConfig?.landing_texts?.['rodape-tagline']?.trim() || 'Assistência técnica especializada'}
            </p>
          </div>
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
      <EletronicaCarrinhoFlutuante />
    </main>
  )
}
