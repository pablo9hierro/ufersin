//! Geocodificação de endereço em texto -> lat/lng, via Nominatim
//! (OpenStreetMap) — sem precisar de API key paga (diferente do Google
//! Routes, que pode não estar configurado). Usado pela tool de
//! localização da loja do Assistente IA, pra mandar um PIN de verdade no
//! WhatsApp em vez de só texto.

const NOMINATIM_URL: &str = "https://nominatim.openstreetmap.org/search";

pub async fn geocode_address(http: &reqwest::Client, address: &str) -> Option<(f64, f64)> {
    if address.trim().is_empty() {
        return None;
    }
    let res = http
        .get(NOMINATIM_URL)
        .query(&[("q", address), ("format", "json"), ("limit", "1")])
        // Nominatim exige um User-Agent identificável — sem isso rejeita a requisição.
        .header("User-Agent", "Resolutoo/1.0 (contato via resolutoo.com)")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    let body: serde_json::Value = res.json().await.ok()?;
    let first = body.as_array()?.first()?;
    let lat: f64 = first.get("lat")?.as_str()?.parse().ok()?;
    let lng: f64 = first.get("lon")?.as_str()?.parse().ok()?;
    Some((lat, lng))
}
