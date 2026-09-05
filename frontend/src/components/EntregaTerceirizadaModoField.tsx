/** Compartilhado por MeuPlano.tsx e Onboarding.tsx -- mesma preferência
 * (`entrega_terceirizada_modo`) cobre tanto a entrega de pedidos/produtos
 * (orders) quanto, no ramo eletrônica, a coleta/entrega de aparelhos em
 * conserto (service_requests) -- por isso o texto muda conforme `vertical`,
 * mas o campo salvo é o mesmo, um só por tenant. */
export default function EntregaTerceirizadaModoField({
  vertical,
  value,
  onChange,
}: {
  vertical: 'ecommerce' | 'eletronicos' | null
  value: 'manual' | 'automatico'
  onChange: (v: 'manual' | 'automatico') => void
}) {
  const isEletronicos = vertical === 'eletronicos'
  const manualDesc = isEletronicos
    ? 'Você liga pro motoboy/99pop terceiro pra buscar/entregar aparelhos em conserto e despachar pedidos de produtos, como já funciona hoje.'
    : 'Você liga pro motoboy/99pop terceiro, como já funciona hoje.'
  const autoDesc = isEletronicos
    ? 'Uber Direct busca e entrega aparelhos em conserto automaticamente, além de despachar pedidos de produtos. Você ainda precisa conectar sua conta Uber Direct em Configurações → Entregas terceirizadas.'
    : 'Entrega é chamada automaticamente pela Uber Direct. Você ainda precisa conectar sua conta Uber Direct em Configurações → Entregas terceirizadas.'

  return (
    <div className="uf-glass rounded-xl px-3 py-2.5" data-testid="pref-entrega-terceirizada-modo">
      <span className="block text-uf-silver text-xs font-semibold mb-2">Como você despacha a entrega terceirizada?</span>
      <label className="flex items-start gap-2.5 cursor-pointer mb-2">
        <input
          type="radio"
          name="entrega_terceirizada_modo"
          checked={value === 'manual'}
          onChange={() => onChange('manual')}
          className="w-4 h-4 mt-0.5"
          data-testid="pref-entrega-modo-manual"
        />
        <span className="text-xs text-uf-silver-dim">
          <span className="block text-uf-silver font-semibold mb-0.5">Eu mesmo chamo (manual)</span>
          {manualDesc}
        </span>
      </label>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="radio"
          name="entrega_terceirizada_modo"
          checked={value === 'automatico'}
          onChange={() => onChange('automatico')}
          className="w-4 h-4 mt-0.5"
          data-testid="pref-entrega-modo-automatico"
        />
        <span className="text-xs text-uf-silver-dim">
          <span className="block text-uf-silver font-semibold mb-0.5">Uso Uber Direct (automática)</span>
          {autoDesc}
        </span>
      </label>
    </div>
  )
}
