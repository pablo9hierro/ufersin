import { supabase } from '../lib/supabaseClient'
import type { PlanoCode } from '../lib/api'

export const PENDING_PLANO_KEY = 'rodoletas_pending_plano'

interface GoogleButtonProps {
  plano: PlanoCode | null
  className?: string
}

/** Login/cadastro via Google — mesmo botão nas duas telas. Guarda o plano
 * pendente (se houver) antes do redirect, porque o OAuth sai da página
 * inteira e volta em /auth/callback sem nenhum estado de React vivo. */
export default function GoogleButton({ plano, className = '' }: GoogleButtonProps) {
  const handleClick = async () => {
    if (plano) localStorage.setItem(PENDING_PLANO_KEY, plano)
    else localStorage.removeItem(PENDING_PLANO_KEY)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return (
    <button type="button" onClick={handleClick} className={`btn-secondary w-full py-3 gap-2.5 ${className}`}>
      <svg className="w-4 h-4" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.58-5.17 3.58-8.82Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.11A12 12 0 0 0 12 24Z"
        />
        <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l3.99-3.11Z" />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l3.99 3.11C6.22 6.86 8.87 4.75 12 4.75Z"
        />
      </svg>
      Continuar com Google
    </button>
  )
}
