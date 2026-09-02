import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Em produção a demo da Rodoletas embute este app sob /loja no mesmo
// domínio Vercel (ver frontend/vercel.json + deploy-vercel.yml). Local
// continua em http://localhost:5173/ com base "/".
const base = process.env.VITE_BASE_PATH || '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // React/react-dom/router raramente mudam entre deploys — chunk
        // próprio pra ficar em cache do navegador entre versões do app,
        // em vez de invalidar junto com o chunk principal a cada deploy.
        manualChunks(id) {
          if (id.includes('node_modules') && /[\\/](react|react-dom|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react'
          }
        },
      },
    },
  },
})
