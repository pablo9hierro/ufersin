use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Achado no audit de segurança do Paulo Ferro (checklist item 5, artigo
/// "5 vacilações de segurança que a IA deixa no teu código"): `/api/auth/
/// admin/login` e o login de cliente não tinham NENHUM rate limit -- um
/// script podia tentar senha infinitas vezes contra a mesma conta. Sem
/// crate nova (governor/redis) de propósito -- é um limitador simples,
/// em memória, por chave (email tentado), suficiente pro volume desse
/// serviço e sem adicionar dependência nova numa mudança de última hora.
///
/// Keyed pelo identificador tentado (não por IP): bloqueia credential
/// stuffing contra UMA conta sem arriscar trancar uma rede inteira atrás
/// de NAT/proxy corporativo que compartilha IP.
pub struct LoginAttemptLimiter {
    window: Duration,
    max_attempts: u32,
    attempts: Mutex<HashMap<String, Vec<Instant>>>,
}

impl LoginAttemptLimiter {
    pub fn new(max_attempts: u32, window: Duration) -> Self {
        Self { window, max_attempts, attempts: Mutex::new(HashMap::new()) }
    }

    /// `Err` com quantos segundos falta se o limite já estourou pra essa
    /// chave. Chame ANTES de verificar a senha.
    pub fn check(&self, key: &str) -> Result<(), u64> {
        let now = Instant::now();
        let mut map = self.attempts.lock().unwrap();
        let entry = map.entry(key.to_lowercase()).or_default();
        entry.retain(|t| now.duration_since(*t) < self.window);
        if entry.len() as u32 >= self.max_attempts {
            let oldest = entry[0];
            let remaining = self.window.saturating_sub(now.duration_since(oldest));
            return Err(remaining.as_secs().max(1));
        }
        Ok(())
    }

    /// Registra uma tentativa (chame só quando a senha estiver errada --
    /// login certo não deve contar contra o limite do próximo).
    pub fn record_failure(&self, key: &str) {
        let mut map = self.attempts.lock().unwrap();
        map.entry(key.to_lowercase()).or_default().push(Instant::now());
    }

    /// Limpa o contador dessa chave (chame em login bem-sucedido).
    pub fn reset(&self, key: &str) {
        self.attempts.lock().unwrap().remove(&key.to_lowercase());
    }
}

impl Default for LoginAttemptLimiter {
    fn default() -> Self {
        // 8 tentativas erradas / 10 minutos -- generoso o bastante pra um
        // lojista que errou a senha algumas vezes, apertado o bastante pra
        // travar um script de força bruta.
        Self::new(8, Duration::from_secs(10 * 60))
    }
}
