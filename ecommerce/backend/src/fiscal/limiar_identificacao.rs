//! Limiar (em R$) a partir do qual identificar o comprador (CPF/CNPJ) deixa
//! de ser opcional -- varia por UF na legislação real de cada SEFAZ. Só
//! populado com valores CONFIRMADOS contra fonte oficial (mesmo padrão de
//! cautela do `UfWebserviceConfig` do lado Jubilados); qualquer UF fora
//! dessa tabela cai no fallback nacional mais conservador
//! (`IDENTIFICACAO_OBRIGATORIA_A_PARTIR_DE` = R$500), que nunca gera risco
//! de rejeição da SEFAZ -- só pede identificação mais cedo do que a lei
//! exige, uma fricção de UX, não um problema de conformidade.

use super::validation::IDENTIFICACAO_OBRIGATORIA_A_PARTIR_DE;

/// UF -> limiar confirmado contra fonte oficial. TO e SE ficam de fora de
/// propósito: TO tem conflito entre fonte primária (R$2.000, Portaria
/// 1328/2019) e fontes secundárias não confirmadas (R$3.000); SE só tem
/// fonte de 2013 com pelo menos 4 normas posteriores não lidas -- nenhum
/// dos dois com confiança suficiente pra virar regra de sistema.
fn limiar_confirmado(uf: &str) -> Option<f64> {
    match uf.trim().to_uppercase().as_str() {
        "PB" => Some(500.0),
        "AC" | "AP" | "DF" | "ES" | "PA" => Some(10_000.0),
        _ => None,
    }
}

pub fn limiar_para_uf(uf: Option<&str>) -> f64 {
    uf.and_then(limiar_confirmado).unwrap_or(IDENTIFICACAO_OBRIGATORIA_A_PARTIR_DE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uf_confirmada_usa_valor_proprio() {
        assert_eq!(limiar_para_uf(Some("PB")), 500.0);
        assert_eq!(limiar_para_uf(Some("ac")), 10_000.0); // case-insensitive
        assert_eq!(limiar_para_uf(Some("DF")), 10_000.0);
    }

    #[test]
    fn uf_nao_confirmada_cai_no_fallback_nacional() {
        assert_eq!(limiar_para_uf(Some("TO")), IDENTIFICACAO_OBRIGATORIA_A_PARTIR_DE);
        assert_eq!(limiar_para_uf(Some("SE")), IDENTIFICACAO_OBRIGATORIA_A_PARTIR_DE);
        assert_eq!(limiar_para_uf(Some("SP")), IDENTIFICACAO_OBRIGATORIA_A_PARTIR_DE);
        assert_eq!(limiar_para_uf(None), IDENTIFICACAO_OBRIGATORIA_A_PARTIR_DE);
    }
}
