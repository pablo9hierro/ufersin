/** Textos de consentimento / responsabilidades Resolutoo (produto). */

export type PoliticaSlug =
  | 'compra'
  | 'compra-mais-18'
  | 'lojista'
  | 'plano-essential'

export type PoliticaSection = {
  id?: string
  title: string
  paragraphs: string[]
  bullets?: string[]
}

export type PoliticaDoc = {
  slug: PoliticaSlug
  title: string
  subtitle: string
  updatedLabel: string
  sections: PoliticaSection[]
}

export const POLITICA_PATHS = {
  compra: '/politicas-de-privacidade/compra',
  'compra-mais-18': '/politicas-de-privacidade/compra-mais-18',
  lojista: '/politicas-de-privacidade/lojista',
  'plano-essential': '/politicas-de-privacidade/plano-essential',
} as const satisfies Record<PoliticaSlug, string>

const UPDATED = 'Atualizado em agosto de 2026'

export const politicaCompra: PoliticaDoc = {
  slug: 'compra',
  title: 'Termos de compra — cliente',
  subtitle:
    'Consentimento do cliente ao finalizar um pedido na vitrine da loja. A Resolutoo orquestra o checkout; o pagamento Pix da compra vai para a conta Mercado Pago do lojista.',
  updatedLabel: UPDATED,
  sections: [
    {
      title: 'Quem faz o quê',
      paragraphs: [
        'Você (cliente) compra produtos ou serviços oferecidos pela loja (lojista) por meio da plataforma Resolutoo.',
        'A Resolutoo é o provedor da plataforma: disponibiliza a vitrine, o carrinho e a orquestração do pagamento. O valor da compra em Pix é cobrado na conta Mercado Pago do lojista — não na conta da Resolutoo.',
      ],
    },
    {
      title: 'Cancelamento do pedido',
      paragraphs: [
        'Você pode cancelar o pedido pela própria plataforma enquanto ele ainda não tiver saído para entrega (antes do status “em rota de entrega” / entregas).',
        'Depois que o pedido sai para entrega, o cancelamento automático pelo cliente deixa de estar disponível. Nesse caso, entre em contato com a loja. A loja pode aprovar ou recusar o cancelamento tardio; a decisão é do lojista.',
      ],
      bullets: [
        'Antes de sair para entrega: cancelamento pelo cliente na plataforma.',
        'Após sair para entrega: somente via loja; aprovação ou recusa fica a cargo do lojista.',
      ],
    },
    {
      title: 'Reembolso de Pix pago',
      paragraphs: [
        'Se o pedido pago via Pix (Mercado Pago da loja) for cancelado com direito a estorno, o reembolso é processado automaticamente pelo Mercado Pago, conforme as regras e prazos desse provedor.',
        'Problemas de conta, saldo, saque ou estorno no Mercado Pago do lojista são tratados entre lojista e Mercado Pago — a Resolutoo não opera a conta MP da loja.',
      ],
    },
    {
      title: 'Aceite no checkout',
      paragraphs: [
        'Ao marcar o checkbox de termos de compra no checkout, você declara ter lido e aceito estas regras para aquele pedido.',
      ],
    },
  ],
}

export const politicaCompraMais18: PoliticaDoc = {
  slug: 'compra-mais-18',
  title: 'Termos de compra 18+ — cliente',
  subtitle:
    'Consentimento adicional quando a loja vende produtos ou serviços restritos a maiores de 18 anos. Vale em conjunto com os termos de compra gerais.',
  updatedLabel: UPDATED,
  sections: [
    {
      title: 'Idade e responsabilidade',
      paragraphs: [
        'Esta loja pode oferecer itens restritos a maiores de 18 anos. Ao informar a data de nascimento e aceitar este consentimento, você declara ser maior de 18 anos e estar legalmente apto a adquirir esses produtos ou serviços.',
        'A entrega ou retirada pode exigir comprovação de idade, conforme política da loja e a legislação aplicável. A recusa em comprovar idade pode impedir a conclusão da venda.',
      ],
    },
    {
      title: 'Cancelamento e reembolso',
      paragraphs: [
        'Aplicam-se as mesmas regras dos termos de compra gerais: cancelamento livre na plataforma antes de o pedido sair para entrega; após isso, somente com a loja, que pode aprovar ou recusar.',
        'Pedidos Pix pagos e cancelados com estorno seguem o reembolso automático via Mercado Pago da loja.',
      ],
    },
    {
      id: 'mais-18',
      title: 'Aceite no checkout',
      paragraphs: [
        'O checkbox 18+ no checkout registra este consentimento junto com os termos de compra normais. Ambos são obrigatórios quando a loja opera com venda 18+.',
      ],
    },
  ],
}

export const politicaLojista: PoliticaDoc = {
  slug: 'lojista',
  title: 'Responsabilidades do lojista',
  subtitle:
    'Regras do comerciante que opera a vitrine Resolutoo: pagamentos na sua conta Mercado Pago, cancelamentos tardios e limites da plataforma.',
  updatedLabel: UPDATED,
  sections: [
    {
      title: 'Pagamentos da loja',
      paragraphs: [
        'Os pagamentos Pix das compras dos clientes são recebidos na conta Mercado Pago do lojista (sua conta). Saques, limites, dados cadastrais e gestão dessa conta são de responsabilidade do lojista perante o Mercado Pago.',
        'Problemas na conta Mercado Pago (bloqueios, falhas de saque, disputas, dados incorretos etc.) devem ser tratados com o suporte do Mercado Pago. A Resolutoo não é responsável por esses problemas e não administra a conta MP do lojista.',
      ],
    },
    {
      title: 'Cancelamentos após saída para entrega',
      paragraphs: [
        'Enquanto o pedido não saiu para entrega, o cliente pode cancelar pela plataforma.',
        'Depois que o pedido sai para entrega, solicitações de cancelamento passam pela loja: o lojista deve aprovar ou recusar. Essa decisão é sua responsabilidade operacional perante o cliente.',
      ],
    },
    {
      title: 'Papel da Resolutoo',
      paragraphs: [
        'A Resolutoo é o provedor da plataforma (vitrine, painel, orquestração do checkout). A assinatura do plano da plataforma é cobrada pela Resolutoo; o dinheiro das vendas da loja segue para a conta MP do lojista.',
      ],
    },
  ],
}

export const politicaPlanoEssential: PoliticaDoc = {
  slug: 'plano-essential',
  title: 'Termos de assinatura — Plano Essential',
  subtitle:
    'Consentimento do lojista ao assinar o Plano Essential (e demais planos da plataforma) em resolutoo.com. Cobre a relação com a Resolutoo como provedora — não substitui as responsabilidades do lojista na operação da loja.',
  updatedLabel: UPDATED,
  sections: [
    {
      title: 'Assinatura da plataforma',
      paragraphs: [
        'Ao assinar o Plano Essential (ou outro plano Resolutoo), você contrata o acesso à plataforma: vitrine, painel administrativo e recursos do plano escolhido, conforme a oferta vigente no momento da contratação.',
        'O pagamento da assinatura é processado pela Resolutoo (provedor da plataforma), pelos meios disponibilizados em /assinar — distinto do Pix das vendas, que vai para a sua conta Mercado Pago.',
      ],
    },
    {
      title: 'O que a Resolutoo faz e o que não faz',
      paragraphs: [
        'A Resolutoo orquestra o checkout da vitrine e encaminha o pagamento das compras para a conta Mercado Pago do lojista.',
        'A Resolutoo não é responsável por problemas na conta Mercado Pago do lojista (saques, bloqueios, suporte MP, cadastro). Esses temas são entre lojista e Mercado Pago.',
      ],
      bullets: [
        'Assinatura do plano: cobrança pela plataforma Resolutoo.',
        'Vendas na vitrine: Pix na conta Mercado Pago do lojista.',
        'Conta MP: gestão e suporte com o Mercado Pago.',
      ],
    },
    {
      title: 'Aceite em /assinar',
      paragraphs: [
        'Ao marcar o checkbox de aceite do contrato de assinatura, você confirma ter lido estes termos e as responsabilidades do lojista publicadas em /politicas-de-privacidade/lojista.',
      ],
    },
  ],
}

export const POLITICAS_BY_SLUG: Record<PoliticaSlug, PoliticaDoc> = {
  compra: politicaCompra,
  'compra-mais-18': politicaCompraMais18,
  lojista: politicaLojista,
  'plano-essential': politicaPlanoEssential,
}

export const POLITICA_SLUGS = Object.keys(POLITICAS_BY_SLUG) as PoliticaSlug[]

export function isPoliticaSlug(value: string): value is PoliticaSlug {
  return value in POLITICAS_BY_SLUG
}
