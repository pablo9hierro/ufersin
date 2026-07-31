use std::collections::HashMap;
use std::time::{Duration, Instant};

use jsonwebtoken::{Algorithm, DecodingKey};
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::error::AppError;

/// Cada chave fica boa por esse tempo antes de recarregar o JWKS — cobre
/// rotação de chave no Supabase sem precisar reiniciar este serviço.
const REFRESH_INTERVAL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Deserialize)]
struct JwkSet {
    keys: Vec<Jwk>,
}

#[derive(Debug, Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    #[serde(default)]
    alg: Option<String>,
    #[serde(default)]
    n: Option<String>,
    #[serde(default)]
    e: Option<String>,
    #[serde(default)]
    x: Option<String>,
    #[serde(default)]
    y: Option<String>,
}

#[derive(Clone)]
struct CachedKey {
    decoding_key: DecodingKey,
    algorithm: Algorithm,
}

struct Cache {
    keys: HashMap<String, CachedKey>,
    fetched_at: Instant,
}

/// Verifica localmente os JWT que o Supabase Auth emite pro lojista, contra
/// o JWKS público do projeto (Settings -> API -> JWT Keys). Desde que o
/// projeto migrou pro sistema novo de "JWT Signing Keys", os tokens vêm
/// assinados com uma chave assimétrica (ES256, hoje) em vez do antigo
/// segredo HS256 compartilhado — por isso não dá mais pra verificar com um
/// `SUPABASE_JWT_SECRET` fixo, e sim buscando a chave pública certa (por
/// `kid`) nesse endpoint, que não exige nenhum segredo pra ser lido.
pub struct JwksVerifier {
    url: String,
    http: reqwest::Client,
    cache: RwLock<Option<Cache>>,
}

impl JwksVerifier {
    pub fn new(supabase_url: &str, http: reqwest::Client) -> Self {
        let base = supabase_url.trim_end_matches('/');
        Self {
            url: format!("{base}/auth/v1/.well-known/jwks.json"),
            http,
            cache: RwLock::new(None),
        }
    }

    /// Retorna a chave de verificação + algoritmo pro `kid` do header do
    /// token. Só refaz o fetch do JWKS se o cache estiver velho ou se o
    /// `kid` pedido não estiver nele (chave nova/rotacionada).
    pub async fn decoding_key_for(&self, kid: &str) -> Result<(DecodingKey, Algorithm), AppError> {
        if let Some((key, alg)) = self.lookup_fresh(kid).await {
            return Ok((key, alg));
        }
        self.refresh().await?;
        self.lookup_fresh(kid)
            .await
            .ok_or_else(|| AppError::Unauthorized("unknown token signing key".to_string()))
    }

    async fn lookup_fresh(&self, kid: &str) -> Option<(DecodingKey, Algorithm)> {
        let guard = self.cache.read().await;
        let cache = guard.as_ref()?;
        if cache.fetched_at.elapsed() >= REFRESH_INTERVAL {
            return None;
        }
        cache.keys.get(kid).map(|k| (k.decoding_key.clone(), k.algorithm))
    }

    async fn refresh(&self) -> Result<(), AppError> {
        let resp = self
            .http
            .get(&self.url)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("failed to fetch Supabase JWKS: {e}")))?
            .error_for_status()
            .map_err(|e| AppError::Internal(format!("Supabase JWKS request failed: {e}")))?;
        let set: JwkSet = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("invalid Supabase JWKS response: {e}")))?;

        let mut keys = HashMap::new();
        for jwk in set.keys {
            let algorithm = match jwk.alg.as_deref() {
                Some("ES256") => Algorithm::ES256,
                Some("RS256") => Algorithm::RS256,
                _ => match jwk.kty.as_str() {
                    "EC" => Algorithm::ES256,
                    "RSA" => Algorithm::RS256,
                    _ => continue,
                },
            };
            let decoding_key = match jwk.kty.as_str() {
                "EC" => jwk
                    .x
                    .as_deref()
                    .zip(jwk.y.as_deref())
                    .and_then(|(x, y)| DecodingKey::from_ec_components(x, y).ok()),
                "RSA" => jwk
                    .n
                    .as_deref()
                    .zip(jwk.e.as_deref())
                    .and_then(|(n, e)| DecodingKey::from_rsa_components(n, e).ok()),
                _ => None,
            };
            if let Some(decoding_key) = decoding_key {
                keys.insert(jwk.kid, CachedKey { decoding_key, algorithm });
            }
        }

        if keys.is_empty() {
            return Err(AppError::Internal("Supabase JWKS returned no usable keys".to_string()));
        }

        *self.cache.write().await = Some(Cache { keys, fetched_at: Instant::now() });
        Ok(())
    }
}
