import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { CmsText } from '../../lib/cms'
import { fetchPlans, getPlansByVertical, SEMESTRAL_DISCOUNT } from '../../lib/plans'
import type { BillingCycle } from '../../lib/api'
import PlanCardsGrid, { BillingCycleToggle } from '../PlanCardsGrid'

export default function Pricing() {
  const [ciclo, setCiclo] = useState<BillingCycle>('mensal')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    fetchPlans().finally(() => setReady(true))
  }, [])

  // Só renderiza a seção de assistência técnica se o ramo tiver plano ativo
  // cadastrado -- sem isso a landing mostraria um bloco vazio.
  const eletronicaPlans = ready ? getPlansByVertical('eletronicos') : []

  return (
    <section id="planos" className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <span className="uf-eyebrow mb-4"><CmsText contentKey="landing.pricing.eyebrow">Planos</CmsText></span>
          <CmsText
            contentKey="landing.pricing.title"
            as="h2"
            className="text-3xl sm:text-4xl md:text-5xl font-black mt-4 block"
          />
          <CmsText
            contentKey="landing.pricing.sub"
            as="p"
            className="mt-4 text-uf-silver-dim max-w-xl mx-auto block"
          />

          <div className="mt-8">
            <BillingCycleToggle ciclo={ciclo} onChange={setCiclo} />
          </div>
          {ciclo === 'semestral' && (
            <p className="mt-3 text-sm text-emerald-400/90">
              Assine semestralmente e ganhe {Math.round(SEMESTRAL_DISCOUNT * 100)}% de desconto no total do semestre.
            </p>
          )}
        </motion.div>

        {!ready ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
          </div>
        ) : (
          <>
            <PlanCardsGrid
              ciclo={ciclo}
              showDemo
              vertical="ecommerce"
              cta={{
                kind: 'link',
                to: (code, c) => `/cadastro?plano=${code}&ciclo=${c}`,
              }}
            />

            {/* Assistência técnica é um ramo à parte -- painel, vitrine e
                features próprios. Fica numa seção separada de propósito:
                no mesmo grid o cliente compararia preço de coisas que não
                competem entre si e poderia assinar o ramo errado. */}
            {eletronicaPlans.length > 0 && (
              <div className="mt-16">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.6 }}
                  className="text-center mb-8"
                >
                  <span className="uf-eyebrow mb-4">
                    <CmsText contentKey="landing.pricing.eletronica.eyebrow">Assistência técnica</CmsText>
                  </span>
                  <h3 className="text-2xl sm:text-3xl font-black mt-4">
                    <CmsText contentKey="landing.pricing.eletronica.title">
                      Tem uma loja de conserto de eletrônicos?
                    </CmsText>
                  </h3>
                  <p className="mt-3 text-uf-silver-dim max-w-xl mx-auto">
                    <CmsText contentKey="landing.pricing.eletronica.sub">
                      Plano com ordem de serviço, diagnóstico, agenda de coleta e entrega — feito pro
                      seu ramo, não adaptado do ecommerce.
                    </CmsText>
                  </p>
                </motion.div>
                <PlanCardsGrid
                  ciclo={ciclo}
                  vertical="eletronicos"
                  columns={1}
                  testId="planos-assinar-cards-eletronica"
                  cta={{
                    kind: 'link',
                    to: (code, c) => `/cadastro?plano=${code}&ciclo=${c}`,
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
