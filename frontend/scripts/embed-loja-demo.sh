#!/usr/bin/env bash
# Empacota o frontend do motor (ecommerce/) sob frontend/public/loja
# pra a demo da Resolutoo abrir as vitrines mockadas no mesmo domínio
# de produção (…/loja/demo-entrar), sem depender de localhost:5173.
set -euo pipefail
# Resolvido a partir do caminho do próprio script (não do cwd) pra
# funcionar tanto invocado como `bash scripts/embed-loja-demo.sh` de
# dentro de frontend/ (GitHub Actions) quanto de qualquer outro lugar.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$FRONTEND_DIR/.." && pwd)"
LOJA_SRC="$ROOT/ecommerce/frontend"
LOJA_OUT="$FRONTEND_DIR/public/loja"

echo "→ Building ecommerce frontend with base=/loja/"
cd "$LOJA_SRC"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
VITE_BASE_PATH=/loja/ npm run build

echo "→ Copying dist → frontend/public/loja"
rm -rf "$LOJA_OUT"
mkdir -p "$(dirname "$LOJA_OUT")"
cp -R "$LOJA_SRC/dist" "$LOJA_OUT"
echo "✓ Loja demo pronta em $LOJA_OUT"
