$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path 'dist\index.html')) { throw 'dist/index.html missing — run npm run build first' }
Remove-Item -Recurse -Force 'deploy_out' -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path 'deploy_out\frontend' | Out-Null
Copy-Item -Recurse -Force 'dist\*' 'deploy_out\frontend\'
Write-Host 'Uploading deploy_out (matches Vercel Root Directory=frontend)...'
& vercel deploy deploy_out --prod --yes
if ($LASTEXITCODE -ne 0) { throw "vercel deploy failed: $LASTEXITCODE" }
Write-Host 'DONE'
