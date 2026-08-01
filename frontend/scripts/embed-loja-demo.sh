#!/usr/bin/env bash
# Empacota o frontend do motor (ecommerce/) sob frontend/public/loja
# pra a demo da Resolutoo abrir as vitrines mockadas no mesmo domínio
# de produção (…/loja/demo-entrar), sem depender de localhost:5173.
# Também é o painel real do assinante (…/loja/admin/login?tenant=…).
set -euo pipefail
# Resolvido a partir do caminho do próprio script (não do cwd) pra
# funcionar tanto invocado como `bash scripts/embed-loja-demo.sh` de
# dentro de frontend/ (GitHub Actions) quanto de qualquer outro lugar.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$FRONTEND_DIR/.." && pwd)"
LOJA_SRC="$ROOT/ecommerce/frontend"
LOJA_OUT="$FRONTEND_DIR/public/loja"

# VITE_API_BASE_URL no projeto Vercel é a API Resolutoo (ufersin-api).
# O motor embutido precisa da API do ecommerce — NÃO herdar a errada.
ECOM_API="${VITE_ECOMMERCE_API_URL:-https://ecommerce-api-production-d447.up.railway.app}"
RODO_API="${VITE_API_BASE_URL:-https://ufersin-api-production.up.railway.app}"
SB_URL="${VITE_SUPABASE_URL:-https://migkkrwzykpztrakbfij.supabase.co}"
SB_ANON="${VITE_SUPABASE_ANON_KEY:-}"

echo "→ Building ecommerce frontend with base=/loja/ (API=$ECOM_API)"
cd "$LOJA_SRC"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
VITE_BASE_PATH=/loja/ \
  VITE_API_BASE_URL="$ECOM_API" \
  VITE_RODOLETAS_API_URL="$RODO_API" \
  VITE_SUPABASE_URL="$SB_URL" \
  VITE_SUPABASE_ANON_KEY="$SB_ANON" \
  VITE_USE_LOCAL_DB=false \
  npm run build

echo "→ Copying dist → frontend/public/loja"
rm -rf "$LOJA_OUT"
mkdir -p "$(dirname "$LOJA_OUT")"
cp -R "$LOJA_SRC/dist" "$LOJA_OUT"
echo "✓ Loja demo pronta em $LOJA_OUT"
