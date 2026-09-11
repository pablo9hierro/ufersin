//! Validacao de FORMATO apenas (nunca de existencia num catalogo fechado)
//! pros codigos fiscais que o contador informa -- CFOP/NCM/CST/CSOSN/CEST
//! sao texto livre no cadastro (perfil e produto), validado so por regex,
//! igual ao pedido explicito: "nao inventar codigo, nao usar placeholder,
//! contador e a fonte da verdade". CPF/CNPJ do destinatario da venda usa o
//! mesmo algoritmo de digito verificador ja usado em
//! `ufersin/backend/src/routes/onboarding.rs` (duplicado aqui porque sao
//! crates/binarios diferentes), agora testado.

/// A partir deste valor (em R$), identificar o comprador (CPF/CNPJ) deixa
/// de ser opcional -- vira exigido antes de fechar a venda, no PDV e no
/// checkout da vitrine (regra de negócio explícita, não da SEFAZ).
pub const IDENTIFICACAO_OBRIGATORIA_A_PARTIR_DE: f64 = 500.0;

fn only_digits(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit()).collect()
}

pub fn valid_cpf(cpf: &str) -> bool {
    let d = only_digits(cpf);
    if d.len() != 11 || d.chars().all(|c| c == d.chars().next().unwrap()) {
        return false;
    }
    let digits: Vec<u32> = d.chars().map(|c| c.to_digit(10).unwrap()).collect();
    let calc = |slice: &[u32], start: u32| -> u32 {
        let sum: u32 = slice.iter().enumerate().map(|(i, v)| v * (start - i as u32)).sum();
        let r = (sum * 10) % 11;
        if r == 10 { 0 } else { r }
    };
    calc(&digits[0..9], 10) == digits[9] && calc(&digits[0..10], 11) == digits[10]
}

pub fn valid_cnpj(cnpj: &str) -> bool {
    let d = only_digits(cnpj);
    if d.len() != 14 || d.chars().all(|c| c == d.chars().next().unwrap()) {
        return false;
    }
    let digits: Vec<u32> = d.chars().map(|c| c.to_digit(10).unwrap()).collect();
    let calc = |slice: &[u32]| -> u32 {
        let weights: &[u32] = if slice.len() == 12 {
            &[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        } else {
            &[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        };
        let sum: u32 = slice.iter().zip(weights).map(|(v, w)| v * w).sum();
        let r = sum % 11;
        if r < 2 { 0 } else { 11 - r }
    };
    calc(&digits[0..12]) == digits[12] && calc(&digits[0..13]) == digits[13]
}

/// CFOP: sempre 4 digitos (grupos 1xxx a 7xxx conforme Convenio SINIEF).
pub fn valid_cfop_format(v: &str) -> bool {
    let d = only_digits(v);
    d.len() == 4 && d != "0000"
}

/// NCM: sempre 8 digitos (Nomenclatura Comum do Mercosul).
pub fn valid_ncm_format(v: &str) -> bool {
    only_digits(v).len() == 8
}

/// CST (ICMS regime normal): 2 digitos.
pub fn valid_cst_format(v: &str) -> bool {
    only_digits(v).len() == 2
}

/// CSOSN (Simples Nacional): 3 digitos.
pub fn valid_csosn_format(v: &str) -> bool {
    only_digits(v).len() == 3
}

/// CEST: 7 digitos.
pub fn valid_cest_format(v: &str) -> bool {
    only_digits(v).len() == 7
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpf_valido_passa() {
        assert!(valid_cpf("529.982.247-25"));
    }

    #[test]
    fn cpf_todos_digitos_iguais_falha() {
        assert!(!valid_cpf("111.111.111-11"));
    }

    #[test]
    fn cpf_digito_verificador_errado_falha() {
        assert!(!valid_cpf("529.982.247-26"));
    }

    #[test]
    fn cnpj_valido_passa() {
        assert!(valid_cnpj("11.222.333/0001-81"));
    }

    #[test]
    fn cnpj_digito_verificador_errado_falha() {
        assert!(!valid_cnpj("11.222.333/0001-82"));
    }

    #[test]
    fn cfop_quatro_digitos_passa() {
        assert!(valid_cfop_format("5102"));
        assert!(!valid_cfop_format("510"));
        assert!(!valid_cfop_format("0000"));
    }

    #[test]
    fn ncm_oito_digitos_passa() {
        assert!(valid_ncm_format("12345678"));
        assert!(!valid_ncm_format("1234567"));
    }

    #[test]
    fn cest_sete_digitos_passa() {
        assert!(valid_cest_format("1234567"));
        assert!(!valid_cest_format("123456"));
    }

    #[test]
    fn cst_dois_digitos_passa() {
        assert!(valid_cst_format("00"));
        assert!(valid_cst_format("41"));
        assert!(!valid_cst_format("0"));
        assert!(!valid_cst_format("000"));
    }

    #[test]
    fn csosn_tres_digitos_passa() {
        assert!(valid_csosn_format("102"));
        assert!(valid_csosn_format("900"));
        assert!(!valid_csosn_format("10"));
        assert!(!valid_csosn_format("1020"));
    }
}
