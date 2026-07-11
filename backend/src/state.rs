use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub http: reqwest::Client,
    /// None = modo mock (sem cobrança de verdade, só pra testar o fluxo
    /// sem uma conta Mercado Pago com o produto de assinaturas aprovado).
    pub mp_token: Arc<Option<String>>,
    /// Preço padrão da assinatura mensal (R$), usado quando o formulário
    /// não especifica outro plano.
    pub valor_padrao: f64,
    /// Pra onde o Mercado Pago manda o lojista de volta depois de autorizar
    /// (ou desistir d)a assinatura no checkout hospedado deles.
    pub back_url: Arc<String>,
}
