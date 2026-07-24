use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct Ponto {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, Serialize)]
pub struct RotaResult {
    pub coords: Vec<[f64; 2]>, // [lat, lng]
    pub km: f64,
    pub min: i64,
}

// Decodifica o "encoded polyline" do Google (algoritmo padrão deles, estável
// há mais de uma década — sem lib externa, é só aritmética de bit).
fn decode_polyline(encoded: &str) -> Vec<[f64; 2]> {
    let bytes = encoded.as_bytes();
    let mut index = 0usize;
    let mut lat = 0i64;
    let mut lng = 0i64;
    let mut coords = Vec::new();

    while index < bytes.len() {
        let mut shift = 0u32;
        let mut result = 0i64;
        loop {
            let b = bytes[index] as i64 - 63;
            index += 1;
            result |= (b & 0x1f) << shift;
            shift += 5;
            if b < 0x20 {
                break;
            }
        }
        lat += if result & 1 != 0 { !(result >> 1) } else { result >> 1 };

        shift = 0;
        result = 0;
        loop {
            let b = bytes[index] as i64 - 63;
            index += 1;
            result |= (b & 0x1f) << shift;
            shift += 5;
            if b < 0x20 {
                break;
            }
        }
        lng += if result & 1 != 0 { !(result >> 1) } else { result >> 1 };

        coords.push([lat as f64 / 1e5, lng as f64 / 1e5]);
    }
    coords
}

#[derive(Debug, Deserialize)]
struct ComputeRoutesResponse {
    routes: Option<Vec<RouteEntry>>,
}
#[derive(Debug, Deserialize)]
struct RouteEntry {
    #[serde(rename = "distanceMeters")]
    distance_meters: Option<f64>,
    duration: Option<String>, // ex.: "165s"
    polyline: Option<PolylineEntry>,
}
#[derive(Debug, Deserialize)]
struct PolylineEntry {
    #[serde(rename = "encodedPolyline")]
    encoded_polyline: String,
}

fn parse_duration_seconds(s: &str) -> i64 {
    s.trim_end_matches('s').parse::<f64>().unwrap_or(0.0).round() as i64
}

async fn calcular_rota_google(state: &AppState, key: &str, de: Ponto, ate: Ponto) -> Result<RotaResult, AppError> {
    let body = json!({
        "origin": { "location": { "latLng": { "latitude": de.lat, "longitude": de.lng } } },
        "destination": { "location": { "latLng": { "latitude": ate.lat, "longitude": ate.lng } } },
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
        "units": "METRIC"
    });

    let resp = state
        .http
        .post("https://routes.googleapis.com/directions/v2:computeRoutes")
        .header("X-Goog-Api-Key", key)
        .header("X-Goog-FieldMask", "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("google routes request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("google routes computeRoutes failed: {status} {text}");
        return Err(AppError::Internal("failed to compute route".to_string()));
    }

    let parsed: ComputeRoutesResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("google routes parse error: {e}")))?;
    let rota = parsed
        .routes
        .and_then(|r| r.into_iter().next())
        .ok_or_else(|| AppError::Internal("google routes returned no route".to_string()))?;

    let polyline = rota.polyline.ok_or_else(|| AppError::Internal("google routes missing polyline".to_string()))?;
    let coords = decode_polyline(&polyline.encoded_polyline);
    let km = rota.distance_meters.unwrap_or(0.0) / 1000.0;
    let min = rota.duration.map(|d| parse_duration_seconds(&d) / 60).unwrap_or(1).max(1);

    Ok(RotaResult { coords, km, min })
}

#[derive(Debug, Deserialize)]
struct OsrmResponse {
    routes: Option<Vec<OsrmRoute>>,
}
#[derive(Debug, Deserialize)]
struct OsrmRoute {
    geometry: OsrmGeometry,
    distance: f64,
    duration: f64,
}
#[derive(Debug, Deserialize)]
struct OsrmGeometry {
    coordinates: Vec<[f64; 2]>, // [lng, lat]
}

async fn calcular_rota_osrm(state: &AppState, de: Ponto, ate: Ponto) -> Result<RotaResult, AppError> {
    let url = format!(
        "https://router.project-osrm.org/route/v1/driving/{},{};{},{}?overview=full&geometries=geojson",
        de.lng, de.lat, ate.lng, ate.lat
    );
    let resp = state
        .http
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("osrm request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Internal("osrm route failed".to_string()));
    }
    let parsed: OsrmResponse = resp.json().await.map_err(|e| AppError::Internal(format!("osrm parse error: {e}")))?;
    let rota = parsed.routes.and_then(|r| r.into_iter().next()).ok_or_else(|| AppError::Internal("osrm returned no route".to_string()))?;
    Ok(RotaResult {
        coords: rota.geometry.coordinates.iter().map(|[lng, lat]| [*lat, *lng]).collect(),
        km: rota.distance / 1000.0,
        min: (rota.duration / 60.0).round().max(1.0) as i64,
    })
}

/// Rota real pelas ruas entre dois pontos — usada tanto pro motoboy navegar
/// quanto pro cliente acompanhar em /consultar. Usa a Google Routes API
/// (respeita trânsito/mão-e-contramão de verdade) quando GOOGLE_ROUTES_API_KEY
/// está configurada; cai pro OSRM (gratuito, sem chave, mas sem garantia de
/// atualização de regras de trânsito) enquanto isso não acontece — aguardando
/// o lojista assinar a API do Google e ceder a chave.
pub async fn calcular_rota(state: &AppState, de: Ponto, ate: Ponto) -> Result<RotaResult, AppError> {
    match state.google_routes_key.as_ref() {
        Some(key) => calcular_rota_google(state, key, de, ate).await,
        None => calcular_rota_osrm(state, de, ate).await,
    }
}

#[derive(Debug, Deserialize)]
struct MatrixElement {
    #[serde(rename = "originIndex")]
    origin_index: usize,
    #[serde(rename = "destinationIndex")]
    destination_index: usize,
    #[serde(rename = "distanceMeters")]
    distance_meters: Option<f64>,
}

/// Matriz de distância REAL (por rua, não linha reta) entre todos os pares
/// de `pontos`, via Google Routes computeRouteMatrix. Só chamada quando
/// GOOGLE_ROUTES_API_KEY está configurada (quem chama já garante isso).
async fn matriz_distancias(state: &AppState, key: &str, pontos: &[Ponto]) -> Result<Vec<Vec<f64>>, AppError> {
    let waypoints: Vec<serde_json::Value> = pontos
        .iter()
        .map(|p| json!({ "waypoint": { "location": { "latLng": { "latitude": p.lat, "longitude": p.lng } } } }))
        .collect();

    let body = json!({
        "origins": waypoints,
        "destinations": waypoints,
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE"
    });

    let resp = state
        .http
        .post("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix")
        .header("X-Goog-Api-Key", key)
        .header("X-Goog-FieldMask", "originIndex,destinationIndex,distanceMeters,status")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("google route matrix request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("google computeRouteMatrix failed: {status} {text}");
        return Err(AppError::Internal("failed to compute route matrix".to_string()));
    }

    let elements: Vec<MatrixElement> =
        resp.json().await.map_err(|e| AppError::Internal(format!("google route matrix parse error: {e}")))?;

    let n = pontos.len();
    let mut matrix = vec![vec![f64::MAX; n]; n];
    for el in elements {
        if let Some(d) = el.distance_meters {
            if el.origin_index < n && el.destination_index < n {
                matrix[el.origin_index][el.destination_index] = d;
            }
        }
    }
    Ok(matrix)
}

/// Mesma heurística gulosa (vizinho mais próximo) que sunset._optimize_route
/// já faz em SQL com distância em linha reta — só que aqui usando distância
/// REAL de rua via Google, pra otimizar de verdade a ordem de entrega de um
/// lote. `pontos[0]` é sempre a loja (ponto de partida); o resultado é a
/// ordem otimizada dos ÍNDICES de pontos[1..] (relativa aos stops, não a
/// pontos[] inteiro).
pub async fn otimizar_ordem_paradas(state: &AppState, loja: Ponto, paradas: &[Ponto]) -> Result<Vec<usize>, AppError> {
    let Some(key) = state.google_routes_key.as_ref() else {
        return Err(AppError::Internal("google routes not configured".to_string()));
    };

    let mut todos = vec![loja];
    todos.extend_from_slice(paradas);
    let matrix = matriz_distancias(state, key, &todos).await?;

    let mut restantes: Vec<usize> = (1..todos.len()).collect(); // índices em `todos`, pulando a loja (0)
    let mut atual = 0usize; // começa na loja
    let mut ordem = Vec::with_capacity(paradas.len());

    while !restantes.is_empty() {
        let (pos, &melhor) = restantes
            .iter()
            .enumerate()
            .min_by(|(_, &a), (_, &b)| matrix[atual][a].partial_cmp(&matrix[atual][b]).unwrap())
            .ok_or_else(|| AppError::Internal("route optimization failed unexpectedly".to_string()))?;
        ordem.push(melhor - 1); // -1 pra virar índice relativo a `paradas`
        atual = melhor;
        restantes.remove(pos);
    }

    Ok(ordem)
}
