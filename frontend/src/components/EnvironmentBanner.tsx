/** Faixa fixa "AMBIENTE DE TESTES (local)" — só aparece em `npm run dev`
 * (import.meta.env.DEV), nunca no build de produção. Pedido explícito do
 * usuário depois de confusão entre localhost e resolutoo.com em produção:
 * agora não tem como confundir os dois ambientes visualmente. */
export default function EnvironmentBanner() {
  if (!import.meta.env.DEV) return null
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-black text-xs font-bold text-center py-1 tracking-wide">
      ⚠ AMBIENTE DE TESTES (localhost) — não é produção
    </div>
  )
}
