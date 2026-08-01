$ErrorActionPreference = 'Stop'
# Broken pattern (do NOT use): `vercel deploy deploy_out` with only dist files.
# Vercel Root Directory=frontend still runs buildCommand which needs
# scripts/embed-loja-demo.sh + ecommerce/ — a static-only upload fails with exit 127.
#
# Prefer: git push to main (auto-deploy), OR deploy from frontend with full monorepo present.

Set-Location $PSScriptRoot
Write-Host 'Preferred: git push origin main (Vercel builds with embed-loja-demo.sh).'
Write-Host 'Fallback: vercel --prod from frontend/ with repo root sibling ecommerce/ present...'
& vercel --prod --yes
if ($LASTEXITCODE -ne 0) { throw "vercel deploy failed: $LASTEXITCODE" }
Write-Host 'DONE'
