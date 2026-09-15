// Marca da demo pública mock (isDemoModeActive) -- pedido do dono: uma logo
// mais trabalhada que o UfersinMark genérico (casinha simples). Mantém a
// paleta Resolutoo (rosa/roxo já usado no projeto, ver son-pink/son-purple
// em tailwind.config), mas com um "R" estilizado dentro de um selo com
// gradiente, remetendo a "loja pronta" sem ser literalmente uma casa.
export default function DemoBrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Resolutoo">
      <defs>
        <linearGradient id="demo-brand-grad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FF3D9A" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="14" fill="url(#demo-brand-grad)" />
      <rect x="2" y="2" width="44" height="44" rx="14" stroke="white" strokeOpacity="0.18" strokeWidth="1.5" />
      {/* "R" estilizado com um traço que vira seta -- crescimento/entrega */}
      <path
        d="M15 34V14H25.5C28.5376 14 31 16.4624 31 19.5C31 22.0951 29.2151 24.2665 26.8062 24.8459L32 34H27.2L22.5 25.5H19.5V34H15Z"
        fill="white"
      />
      <path d="M19.5 18V21.8H25C26.0498 21.8 26.9 20.9498 26.9 19.9C26.9 18.8502 26.0498 18 25 18H19.5Z" fill="url(#demo-brand-grad)" />
      <circle cx="35.5" cy="14.5" r="3.5" fill="#22D3A5" />
    </svg>
  )
}
