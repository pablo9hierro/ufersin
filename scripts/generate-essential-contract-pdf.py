"""Gera PDF do contrato Plano Essential Resolutoo (sem segredos)."""
from pathlib import Path
from fpdf import FPDF

OUT = Path(r"C:\Users\pablo\Documents\resolutoo-contrato-plano-essential.pdf")
FONT = r"C:\Windows\Fonts\arial.ttf"
FONT_B = r"C:\Windows\Fonts\arialbd.ttf"


class PDF(FPDF):
    def footer(self):
        self.set_y(-14)
        self.set_font("ArialUni", "I", 8)
        self.set_text_color(110, 110, 110)
        self.cell(
            0,
            8,
            f"Resolutoo — Contrato Plano Essential — página {self.page_no()}/{{nb}}",
            align="C",
        )


def main() -> None:
    pdf = PDF(format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_font("ArialUni", "", FONT)
    pdf.add_font("ArialUni", "B", FONT_B)
    pdf.add_font("ArialUni", "I", FONT)
    pdf.add_page()
    pdf.set_margins(18, 16, 18)

    def h1(text: str) -> None:
        pdf.set_font("ArialUni", "B", 15)
        pdf.set_text_color(15, 15, 15)
        pdf.multi_cell(0, 7.5, text)
        pdf.ln(2)

    def h2(text: str) -> None:
        pdf.ln(2.5)
        pdf.set_font("ArialUni", "B", 11)
        pdf.set_text_color(15, 15, 15)
        pdf.multi_cell(0, 6, text)
        pdf.ln(1)

    def p(text: str, bold: bool = False) -> None:
        pdf.set_font("ArialUni", "B" if bold else "", 10)
        pdf.set_text_color(25, 25, 25)
        pdf.multi_cell(0, 5.1, text)
        pdf.ln(0.8)

    h1("CONTRATO DE ASSINATURA — PLANO ESSENTIAL RESOLUTOO")
    p("Versão: agosto de 2026. Documento para upload/template no PandaDoc (assinatura eletrônica do lojista).", bold=False)
    p("Partes e objeto abaixo. Ao assinar eletronicamente, o lojista declara ter lido e aceito integralmente este contrato.")

    h2("PARTES")
    p(
        "CONTRATADA (Provedora da plataforma): Resolutoo (“Resolutoo”, “plataforma”, “nós”)."
    )
    p(
        "CONTRATANTE (Lojista / Assinante): a pessoa física ou jurídica que assina o Plano Essential "
        "(ou outro plano da plataforma Resolutoo) em resolutoo.com, identificada no momento da contratação "
        "e neste documento eletrônico (“você”, “lojista”, “assinante”)."
    )

    h2("1. OBJETO")
    p(
        "1.1. Este contrato regula a assinatura do Plano Essential (e, no que couber, demais planos da "
        "plataforma Resolutoo) para acesso à plataforma: vitrine/loja online, painel administrativo e "
        "recursos do plano vigente no momento da contratação."
    )
    p(
        "1.2. A Resolutoo atua como provedora da plataforma (software e orquestração). A assinatura da "
        "plataforma é cobrada pela Resolutoo, pelos meios disponibilizados em /assinar (ex.: Mercado Pago "
        "e/ou outros gateways indicados)."
    )
    p(
        "1.3. Este contrato não substitui as responsabilidades do lojista na operação da loja perante seus "
        "clientes, nem as políticas publicadas em resolutoo.com (incluindo "
        "/politicas-de-privacidade/plano-essential e /politicas-de-privacidade/lojista)."
    )

    h2("2. PAPEL DA RESOLUTOO E DA CONTA MERCADO PAGO DO LOJISTA")
    p(
        "2.1. A Resolutoo disponibiliza a vitrine, o carrinho e a orquestração do checkout das vendas da loja."
    )
    p(
        "2.2. Os pagamentos Pix (e demais meios da loja) das compras dos clientes são recebidos na conta "
        "Mercado Pago do lojista (conta do assinante), e não na conta da Resolutoo."
    )
    p(
        "2.3. Saques, limites, cadastro, bloqueios, disputas, falhas de estorno/saque e suporte da conta "
        "Mercado Pago da loja são de responsabilidade do lojista perante o Mercado Pago. A Resolutoo não "
        "administra e não é responsável por problemas nessa conta."
    )
    p(
        "2.4. Distinção: (a) Assinatura do plano Resolutoo → cobrança pela plataforma Resolutoo; "
        "(b) Vendas na vitrine → pagamento na conta Mercado Pago do lojista; "
        "(c) Conta MP do lojista → gestão e suporte com o Mercado Pago."
    )

    h2("3. PREÇO, COBRANÇA E VIGÊNCIA")
    p(
        "3.1. O valor, periodicidade e benefícios do Plano Essential (ou plano escolhido) são os vigentes "
        "na oferta apresentada em /assinar no momento da contratação."
    )
    p(
        "3.2. A assinatura permanece ativa enquanto o pagamento recorrente (ou o período pago) estiver em dia, "
        "conforme regras do meio de pagamento utilizado, salvo cancelamento nos termos deste contrato."
    )
    p(
        "3.3. A Resolutoo pode atualizar preços e recursos de planos mediante comunicação prévia nos canais "
        "da plataforma, respeitando o ciclo já pago quando aplicável."
    )

    h2("4. CANCELAMENTO E REEMBOLSO (REGRA DOS 7 DIAS)")
    p(
        "4.1. Prazo de arrependimento / estorno (até 7 dias): o assinante pode cancelar a assinatura em até "
        "7 (sete) dias corridos, contados da data da assinatura / contratação do plano. Nesse caso, a "
        "Resolutoo promoverá o estorno / reembolso do valor pago da assinatura via Mercado Pago (ou via o "
        "mesmo provedor de pagamento utilizado na cobrança), observados os prazos e regras operacionais "
        "desse provedor.",
        bold=True,
    )
    p(
        "4.2. Após 7 dias: o assinante pode cancelar o plano a qualquer momento pelos meios disponibilizados "
        "na plataforma (ex.: área do assinante / cancelamento), sem direito a reembolso, estorno ou "
        "devolução proporcional do valor já pago referente ao período em curso, salvo obrigação legal "
        "diversa ou política promocional expressa e escrita da Resolutoo.",
        bold=True,
    )
    p(
        "4.3. O cancelamento encerra o acesso aos recursos do plano conforme o fluxo operacional da "
        "plataforma (imediatamente ou ao fim do período já pago, conforme indicado no produto no momento "
        "do cancelamento)."
    )
    p(
        "4.4. Cancelamento de pedidos de clientes na loja (compras na vitrine) segue regras próprias dos "
        "termos de compra / responsabilidades do lojista — não se confunde com o cancelamento da assinatura "
        "do Plano Essential."
    )

    h2("5. ACEITE ELETRÔNICO E ASSINATURA")
    p(
        "5.1. O aceite pode ocorrer por checkbox em /assinar e/ou por assinatura eletrônica neste documento "
        "(PandaDoc ou meio equivalente)."
    )
    p(
        "5.2. Ao assinar / aceitar, o lojista declara ter lido e concordado com este contrato e com as "
        "responsabilidades do lojista publicadas em /politicas-de-privacidade/lojista."
    )
    p(
        "5.3. Registros de aceite (data, canal, identificação do assinante) poderão ser armazenados pela "
        "Resolutoo para comprovação contratual."
    )

    h2("6. OBRIGAÇÕES DO LOJISTA")
    p(
        "6.1. Utilizar a plataforma de forma lícita, fornecer dados cadastrais verdadeiros e manter a conta "
        "Mercado Pago da loja em condições de operar."
    )
    p(
        "6.2. Cumprir a legislação aplicável às suas vendas (incluindo regras de idade 18+ quando ativar "
        "essa modalidade), entrega, atendimento e políticas perante o consumidor."
    )
    p(
        "6.3. Não utilizar a plataforma para fins ilícitos, fraudulentos ou que violem direitos de terceiros."
    )

    h2("7. LIMITAÇÃO E EXCLUSÕES")
    p(
        "7.1. A Resolutoo não garante disponibilidade ininterrupta da plataforma, mas envidará esforços "
        "razoáveis de operação e suporte."
    )
    p(
        "7.2. A Resolutoo não se responsabiliza por: (a) atos ou omissões do lojista perante clientes; "
        "(b) problemas da conta Mercado Pago do lojista; (c) indisponibilidades de terceiros (Mercado Pago, "
        "hospedagem, internet, etc.), na medida permitida pela lei."
    )

    h2("8. PRIVACIDADE E DADOS")
    p(
        "8.1. O tratamento de dados pessoais observados na operação da plataforma segue as políticas "
        "publicadas em resolutoo.com e a legislação aplicável (incluindo a LGPD, quando cabível)."
    )

    h2("9. FORO E DISPOSIÇÕES GERAIS")
    p(
        "9.1. Este contrato constitui o acordo entre as partes quanto à assinatura do plano da plataforma, "
        "prevalecendo sobre comunicações informais conflitantes, sem prejuízo de políticas publicadas no site."
    )
    p("9.2. A invalidade de qualquer cláusula não prejudica as demais.")
    p(
        "9.3. Fica eleito o foro da comarca da sede da Resolutoo, salvo foro obrigatório diverso por lei "
        "(ex.: consumidor, quando aplicável)."
    )

    h2("CAMPOS PARA PREENCHIMENTO / TOKENS PANDADOC")
    p(
        "Nome / razão social do lojista · E-mail do assinante · CPF/CNPJ · Plano (Essential ou outro) · "
        "Data da assinatura · Valor mensal vigente."
    )
    p(
        "Espaço para assinatura eletrônica do lojista (PandaDoc). Não incluir chaves de API neste documento."
    )

    pdf.ln(8)
    p("Assinatura do Lojista / Assinante: _________________________________", bold=False)
    pdf.ln(4)
    p("Data: ____ / ____ / ________", bold=False)

    pdf.output(str(OUT))
    print(OUT)
    print("bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
