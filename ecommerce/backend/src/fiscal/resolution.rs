//! Motor central de resolucao fiscal -- combina Perfil fiscal + overrides
//! do produto + contexto da venda pra produzir os valores EFETIVOS usados
//! na emissao, sem nunca exigir edicao do produto pra vender pra outro
//! estado/tipo de cliente. Principio do pedido original: "o cadastro
//! fiscal de um produto nao representa obrigatoriamente o resultado fiscal
//! de toda venda futura daquele produto".
//!
//! Precedencia (mais especifico primeiro): override no produto > perfil
//! selecionado (manual ou automatico) > erro claro (nunca inventa/usa
//! placeholder). Isso e so a CAMADA DE DADOS -- quem decide interna vs
//! interestadual e o comparativo uf_origem/uf_destino, feito aqui; quem
//! sabe montar o XML/emitir continua sendo so o Jubilados (jubilados_client.rs).

use serde::Serialize;

#[derive(Debug, Clone)]
pub struct OperationContext {
    pub uf_origem: String,
    pub uf_destino: Option<String>,
    pub documento_tipo: Option<String>, // "cpf" | "cnpj" | None (nao identificado)
}

impl OperationContext {
    /// Interna = mesmo estado; interestadual = estados diferentes; se o
    /// destino nao foi informado (venda sem endereco, ex. balcao), trata
    /// como interna -- e a suposicao mais segura pra nao bloquear o fluxo
    /// atual do PDV, que hoje nao pede UF de destino nenhuma.
    pub fn is_interestadual(&self) -> bool {
        match &self.uf_destino {
            Some(uf) => !uf.eq_ignore_ascii_case(&self.uf_origem),
            None => false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct FiscalProfile {
    pub id: String,
    pub nome: String,
    pub cfop: Option<String>,
    pub cst: Option<String>,
    pub csosn: Option<String>,
    pub cclass_trib: Option<String>,
    pub is_default: bool,
}

/// Overrides opcionais cadastrados diretamente no produto -- mesmos campos
/// que ja existiam em `products` antes dos perfis (migration 0050), agora
/// tratados como override em vez de valor final.
#[derive(Debug, Clone, Default)]
pub struct ProductFiscalOverrides {
    pub cfop: Option<String>,
    pub cst: Option<String>,
    pub csosn: Option<String>,
    pub cclass_trib: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FieldSource {
    pub value: String,
    /// "override" | "perfil"
    pub origem: &'static str,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct FiscalResolution {
    pub cfop: Option<FieldSource>,
    pub cst: Option<FieldSource>,
    pub csosn: Option<FieldSource>,
    pub cclass_trib: Option<FieldSource>,
    pub fiscal_profile_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FiscalResolutionError {
    CampoObrigatorioAusente(&'static str),
}

impl FiscalResolutionError {
    pub fn message(&self) -> String {
        match self {
            FiscalResolutionError::CampoObrigatorioAusente(campo) => {
                format!("nenhum perfil fiscal ou override do produto define {campo} -- configure um perfil fiscal ou o campo direto no produto antes de emitir")
            }
        }
    }
}

fn non_empty(v: Option<&str>) -> Option<String> {
    v.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn resolve_field(
    field_name: &'static str,
    override_value: Option<&str>,
    profile_value: Option<&str>,
    required: bool,
) -> Result<Option<FieldSource>, FiscalResolutionError> {
    if let Some(v) = non_empty(override_value) {
        return Ok(Some(FieldSource { value: v, origem: "override" }));
    }
    if let Some(v) = non_empty(profile_value) {
        return Ok(Some(FieldSource { value: v, origem: "perfil" }));
    }
    if required {
        Err(FiscalResolutionError::CampoObrigatorioAusente(field_name))
    } else {
        Ok(None)
    }
}

fn nome_bate_uf(nome: &str, interestadual: bool) -> bool {
    if interestadual {
        nome.contains("interestadual")
    } else {
        nome.contains("interna") && !nome.contains("interestadual")
    }
}

/// Escolhe automaticamente entre os perfis do tenant, do mais especifico
/// pro mais generico -- heuristica simples e explicita por NOME do perfil,
/// nunca "inteligente" demais:
/// 1. Perfil cujo nome bate com UF (interna/interestadual) E com o tipo de
///    documento do destinatario (ex: "Venda interestadual CNPJ") -- so
///    aplica quando o documento foi informado (venda com nota fiscal).
/// 2. Perfil cujo nome bate só com UF (interna/interestadual).
/// 3. Perfil `is_default`.
/// O lojista sempre pode sobrepor escolhendo "Manual" em vez de
/// "Automatico" (ver PdvFiscalInput) quando a heuristica não serve.
pub fn select_automatic_profile<'a>(
    ctx: &OperationContext,
    perfis: &'a [FiscalProfile],
) -> Option<&'a FiscalProfile> {
    let interestadual = ctx.is_interestadual();

    if let Some(doc_tipo) = ctx.documento_tipo.as_deref() {
        let by_uf_and_doc = perfis.iter().find(|p| {
            let nome = p.nome.to_lowercase();
            nome_bate_uf(&nome, interestadual) && nome.contains(doc_tipo)
        });
        if by_uf_and_doc.is_some() {
            return by_uf_and_doc;
        }
    }

    // Sem documento (cliente nao identificado, ex. balcao) -- nunca cai
    // num perfil nomeado especificamente pra CPF/CNPJ so por coincidir a
    // UF; so usa perfis "genericos" (sem menção a documento no nome).
    let by_uf = perfis.iter().find(|p| {
        let nome = p.nome.to_lowercase();
        nome_bate_uf(&nome, interestadual) && !nome.contains("cpf") && !nome.contains("cnpj")
    });
    by_uf.or_else(|| perfis.iter().find(|p| p.is_default))
}

/// Combina perfil + overrides do produto em cima do contexto -- essa e a
/// unica funcao que `fiscal.rs` deve chamar pra saber os valores efetivos
/// (substitui o `effective_cfop` isolado + defaults soltos que existiam
/// antes dos perfis).
pub fn resolve(
    overrides: &ProductFiscalOverrides,
    profile: Option<&FiscalProfile>,
) -> Result<FiscalResolution, FiscalResolutionError> {
    let cfop = resolve_field("CFOP", overrides.cfop.as_deref(), profile.and_then(|p| p.cfop.as_deref()), true)?;
    let cclass_trib = resolve_field(
        "Classificação Tributária (IBS/CBS)",
        overrides.cclass_trib.as_deref(),
        profile.and_then(|p| p.cclass_trib.as_deref()),
        true,
    )?;
    let cst = resolve_field("CST", overrides.cst.as_deref(), profile.and_then(|p| p.cst.as_deref()), false)?;
    let csosn = resolve_field("CSOSN", overrides.csosn.as_deref(), profile.and_then(|p| p.csosn.as_deref()), false)?;
    if cst.is_none() && csosn.is_none() {
        return Err(FiscalResolutionError::CampoObrigatorioAusente("CST/CSOSN"));
    }
    Ok(FiscalResolution {
        cfop,
        cst,
        csosn,
        cclass_trib,
        fiscal_profile_id: profile.map(|p| p.id.clone()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(uf_origem: &str, uf_destino: Option<&str>) -> OperationContext {
        OperationContext {
            uf_origem: uf_origem.to_string(),
            uf_destino: uf_destino.map(str::to_string),
            documento_tipo: None,
        }
    }

    fn ctx_com_documento(uf_origem: &str, uf_destino: Option<&str>, documento_tipo: &str) -> OperationContext {
        OperationContext { documento_tipo: Some(documento_tipo.to_string()), ..ctx(uf_origem, uf_destino) }
    }

    fn profile(nome: &str, cfop: &str, is_default: bool) -> FiscalProfile {
        FiscalProfile {
            id: format!("perfil-{nome}"),
            nome: nome.to_string(),
            cfop: Some(cfop.to_string()),
            cst: Some("00".to_string()),
            csosn: None,
            cclass_trib: Some("000001".to_string()),
            is_default,
        }
    }

    #[test]
    fn venda_interna_mesma_uf_nao_e_interestadual() {
        assert!(!ctx("PB", Some("PB")).is_interestadual());
    }

    #[test]
    fn venda_para_outra_uf_e_interestadual() {
        assert!(ctx("PB", Some("PE")).is_interestadual());
    }

    #[test]
    fn sem_uf_destino_trata_como_interna() {
        assert!(!ctx("PB", None).is_interestadual());
    }

    #[test]
    fn automatico_escolhe_perfil_interestadual_por_nome() {
        let perfis = vec![profile("Venda interna PB", "5102", true), profile("Venda interestadual", "6102", false)];
        let escolhido = select_automatic_profile(&ctx("PB", Some("PE")), &perfis).unwrap();
        assert_eq!(escolhido.cfop.as_deref(), Some("6102"));
    }

    #[test]
    fn automatico_sem_perfil_nomeado_cai_no_default() {
        let perfis = vec![profile("Servico geral", "5933", true)];
        let escolhido = select_automatic_profile(&ctx("PB", Some("PE")), &perfis).unwrap();
        assert_eq!(escolhido.id, "perfil-Servico geral");
    }

    #[test]
    fn automatico_prefere_perfil_especifico_de_cnpj_sobre_generico() {
        let perfis = vec![
            profile("Venda interestadual", "6102", false),
            profile("Venda interestadual CNPJ", "6108", true),
        ];
        let escolhido = select_automatic_profile(&ctx_com_documento("PB", Some("PE"), "cnpj"), &perfis).unwrap();
        assert_eq!(escolhido.cfop.as_deref(), Some("6108"));
    }

    #[test]
    fn automatico_prefere_perfil_especifico_de_cpf_sobre_generico() {
        let perfis = vec![
            profile("Venda interestadual", "6102", false),
            profile("Venda interestadual CPF", "6108", false),
        ];
        let escolhido = select_automatic_profile(&ctx_com_documento("PB", Some("PE"), "cpf"), &perfis).unwrap();
        assert_eq!(escolhido.cfop.as_deref(), Some("6108"));
    }

    #[test]
    fn automatico_sem_documento_ignora_perfis_especificos_de_documento() {
        let perfis = vec![profile("Venda interestadual CNPJ", "6108", false), profile("Venda interestadual", "6102", true)];
        // Cliente sem identificacao (documento_tipo = None, ex. balcao) --
        // nao deve cair num perfil pensado pra CNPJ so porque o nome bate
        // com a UF; usa o generico.
        let escolhido = select_automatic_profile(&ctx("PB", Some("PE")), &perfis).unwrap();
        assert_eq!(escolhido.cfop.as_deref(), Some("6102"));
    }

    #[test]
    fn venda_interestadual_nao_altera_produto_so_troca_perfil_escolhido() {
        let overrides = ProductFiscalOverrides::default();
        let interna = profile("interna", "5102", true);
        let interestadual = profile("interestadual", "6102", false);
        let r1 = resolve(&overrides, Some(&interna)).unwrap();
        let r2 = resolve(&overrides, Some(&interestadual)).unwrap();
        assert_eq!(r1.cfop.unwrap().value, "5102");
        assert_eq!(r2.cfop.unwrap().value, "6102");
    }

    #[test]
    fn override_produto_tem_precedencia_sobre_perfil() {
        let overrides = ProductFiscalOverrides { cfop: Some("5949".to_string()), ..Default::default() };
        let perfil = profile("interna", "5102", true);
        let r = resolve(&overrides, Some(&perfil)).unwrap();
        let f = r.cfop.unwrap();
        assert_eq!(f.value, "5949");
        assert_eq!(f.origem, "override");
    }

    #[test]
    fn mudar_perfil_default_propaga_pra_quem_nao_tem_override() {
        let overrides = ProductFiscalOverrides::default();
        let perfil_antigo = profile("interna", "5102", true);
        let r1 = resolve(&overrides, Some(&perfil_antigo)).unwrap();
        assert_eq!(r1.cfop.unwrap().value, "5102");
        let perfil_editado = profile("interna", "5101", true);
        let r2 = resolve(&overrides, Some(&perfil_editado)).unwrap();
        assert_eq!(r2.cfop.unwrap().value, "5101");
    }

    #[test]
    fn override_imune_a_mudanca_do_perfil_default() {
        let overrides = ProductFiscalOverrides { cfop: Some("5949".to_string()), ..Default::default() };
        let perfil_v1 = profile("interna", "5102", true);
        let perfil_v2 = profile("interna", "5101", true);
        let r1 = resolve(&overrides, Some(&perfil_v1)).unwrap();
        let r2 = resolve(&overrides, Some(&perfil_v2)).unwrap();
        assert_eq!(r1.cfop.unwrap().value, "5949");
        assert_eq!(r2.cfop.unwrap().value, "5949");
    }

    #[test]
    fn campo_obrigatorio_ausente_bloqueia_com_mensagem_clara() {
        let overrides = ProductFiscalOverrides::default();
        let err = resolve(&overrides, None).unwrap_err();
        assert_eq!(err, FiscalResolutionError::CampoObrigatorioAusente("CFOP"));
        assert!(err.message().contains("CFOP"));
    }

    #[test]
    fn sem_cst_e_sem_csosn_em_override_e_perfil_bloqueia() {
        let overrides = ProductFiscalOverrides::default();
        let perfil = FiscalProfile {
            id: "p1".to_string(),
            nome: "sem cst".to_string(),
            cfop: Some("5102".to_string()),
            cst: None,
            csosn: None,
            cclass_trib: Some("000001".to_string()),
            is_default: true,
        };
        let err = resolve(&overrides, Some(&perfil)).unwrap_err();
        assert_eq!(err, FiscalResolutionError::CampoObrigatorioAusente("CST/CSOSN"));
    }

    #[test]
    fn csosn_no_perfil_supre_cst_ausente() {
        let overrides = ProductFiscalOverrides::default();
        let perfil = FiscalProfile {
            id: "p1".to_string(),
            nome: "simples".to_string(),
            cfop: Some("5102".to_string()),
            cst: None,
            csosn: Some("102".to_string()),
            cclass_trib: Some("000001".to_string()),
            is_default: true,
        };
        assert!(resolve(&overrides, Some(&perfil)).is_ok());
    }
}
