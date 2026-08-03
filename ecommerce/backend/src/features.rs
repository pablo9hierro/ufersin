use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashSet;

use crate::error::AppError;

/// Every feature the product has, regardless of plan. Plans only decide
/// which of these are turned on for a given tenant (see `plan_features` /
/// `feature_flags` in migrations/0005_tenancy.sql) — the handlers behind
/// every one of these always exist in this one codebase, never a separate
/// build. Matches the plan spec's `if(plan.hasCRM)` style: call
/// `require_feature` at the top of a gated handler instead of branching the
/// route table itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Feature {
    Catalogo,
    Checkout,
    Pix,
    Whatsapp,
    Pedidos,
    Funcionarios,
    Motoboy,
    BannerPromocional,
    Comissoes,
    Crm,
    Segmentacoes,
    Automacoes,
    Cupons,
    Campanhas,
    Relatorios,
}

impl Feature {
    pub fn code(self) -> &'static str {
        match self {
            Feature::Catalogo => "catalogo",
            Feature::Checkout => "checkout",
            Feature::Pix => "pix",
            Feature::Whatsapp => "whatsapp",
            Feature::Pedidos => "pedidos",
            Feature::Funcionarios => "funcionarios",
            Feature::Motoboy => "motoboy",
            Feature::BannerPromocional => "banner_promocional",
            Feature::Comissoes => "comissoes",
            Feature::Crm => "crm",
            Feature::Segmentacoes => "segmentacoes",
            Feature::Automacoes => "automacoes",
            Feature::Cupons => "cupons",
            Feature::Campanhas => "campanhas",
            Feature::Relatorios => "relatorios",
        }
    }
}

/// Effective feature set for a tenant: the plan's defaults from its active
/// subscription, with any per-tenant `feature_flags` row overriding
/// (enabled=true adds a feature the plan wouldn't otherwise grant,
/// enabled=false revokes one it would). A tenant with no active
/// subscription gets an empty set — every gated endpoint locks down rather
/// than failing open.
pub async fn effective_features(pool: &PgPool, tenant_id: &str) -> Result<HashSet<String>, AppError> {
    let plan_defaults: Vec<(String,)> = sqlx::query_as(
        "SELECT pf.feature_code \
         FROM subscriptions s \
         JOIN plan_features pf ON pf.plan_id = s.plan_id \
         WHERE s.tenant_id = $1 AND s.status IN ('trialing', 'active')",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;

    let mut set: HashSet<String> = plan_defaults.into_iter().map(|(c,)| c).collect();

    let overrides: Vec<(String, bool)> = sqlx::query_as(
        "SELECT feature_code, enabled FROM feature_flags WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;

    for (code, enabled) in overrides {
        if enabled {
            set.insert(code);
        } else {
            set.remove(&code);
        }
    }

    Ok(set)
}

/// Guard for a plan-gated endpoint: 403s with a clear message when the
/// tenant's current plan (+ overrides) doesn't include `feature`.
pub async fn require_feature(pool: &PgPool, tenant_id: &str, feature: Feature) -> Result<(), AppError> {
    let set = effective_features(pool, tenant_id).await?;
    if set.contains(feature.code()) {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!(
            "recurso \"{}\" não está disponível no plano atual",
            feature.code()
        )))
    }
}

/// Whether the tenant currently has `feature` (plan defaults + overrides).
pub async fn has_feature(pool: &PgPool, tenant_id: &str, feature: Feature) -> Result<bool, AppError> {
    let set = effective_features(pool, tenant_id).await?;
    Ok(set.contains(feature.code()))
}
