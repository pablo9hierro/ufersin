# `lib/geo` — mapa, endereço, distância e GPS

Portado de `C:\Users\pablo\Documents\gliafico` (protótipo de estudo clonando
a UX do 99/Uber). São módulos TS puros — só `fetch` e
`navigator.geolocation`, sem dependência de React nem do Leaflet em si.

**Nenhuma função aqui precisa de chave de API. Nenhuma cobra por requisição.**

| Arquivo | O que tem |
|---|---|
| `geocodificacao.ts` | endereço → coordenada (busca/autocomplete) e coordenada → nome da rua |
| `rotas.ts` | distância em linha reta (grátis, offline) + rota real pelas ruas com km/min (OSRM) |
| `localizacao.ts` | GPS do aparelho: posição única e rastreamento contínuo (motoboy) |
| `mapa.ts` | URL dos tiles do mapa (visual) e ponto de fallback (a loja) |

## Onde cada coisa é usada no Sunset

- **Checkout** (`pages/Checkout.tsx`): `buscarEnderecos` (campo de busca) +
  `obterLocalizacao` (botão "usar minha localização") + `enderecoDe`
  (atualiza o nome da rua enquanto o mapa desliza sob o pino fixo, igual
  99/Uber) — fluxo completo documentado dentro do componente.
- **Cálculo do frete**: `distanciaKm` só serve pra mostrar uma **estimativa**
  ao vivo enquanto o cliente ajusta o pino (chamando a RPC
  `sunset.estimate_shipping`). O valor que efetivamente vira `shipping_price`
  do pedido é recalculado **de novo no banco** (`sunset.create_order`, mesma
  fórmula de Haversine em SQL) — nunca confia no número calculado no
  navegador.
- **Fila do motoboy**: `seguirLocalizacao` transmite a posição do motoboy
  pro Supabase enquanto uma entrega está `em_rota_de_entrega`.
- **`/consultar`**: escuta essa posição via Supabase Realtime e anima um
  marcador de moto no mapa (fase seguinte deste projeto).

## Regras de uso (Nominatim/OSRM são serviços públicos gratuitos)

- **Nominatim** (busca e geocodificação reversa): máx. **1 requisição por
  segundo** — por isso o campo de busca usa debounce de ~500ms.
- **OSRM demo**: sem garantia de uptime, é servidor de demonstração. Se um
  dia isso tiver muito tráfego, ver alternativas pagas/self-hosted no
  README original em `C:\Users\pablo\Documents\gliafico\README.md`.
- **GPS**: 100% grátis e ilimitado, exige HTTPS (ou localhost) e permissão
  do usuário.
