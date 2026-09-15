// Marca da demo pública mock (isDemoModeActive) -- pedido do dono: uma logo
// mais trabalhada que o UfersinMark genérico (casinha simples). Usa a arte
// real de marca (assets/brand/logo-ecommerce.svg, commit 3a91589) em vez
// do "R" desenhado à mão na rodada anterior.
export default function DemoBrandMark({ className }: { className?: string }) {
  return <img src="/brand/logo-ecommerce.svg" alt="Resolutoo" className={className} />
}
