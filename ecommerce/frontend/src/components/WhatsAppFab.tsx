import { useState } from 'react'
import logoSrc from '../assets/logo.png'

const WHATSAPP_URL =
  'https://api.whatsapp.com/send/?phone=5583987059373&text&type=phone_number&app_absent=0'
const INSTAGRAM_URL = 'https://www.instagram.com/tabassunset'

// Floating WhatsApp button — fixed to the viewport (follows scroll) by
// default. Uiverse.io by Mohammad-Rahme-576 — "tooltip-container": na
// referência o tooltip com os ícones de rede abria no :hover; aqui abre
// AO CLICAR (pedido explícito, celular não tem hover) e mostra só 2
// redes — WhatsApp (mesmo link de sempre) e Instagram (@tabassunset) —
// no estilo ícone-preenche+tooltip de Uiverse.io by wilsondesouza
// (example-2), recolorido por rede. A fumaça que subia daqui foi
// movida pro botão do carrinho (CartFab).
// `inline`: usado dentro do navbar da landing (BrandHeader) — sem
// posicionamento fixed próprio, menor, e o tooltip abre pra BAIXO em
// vez de pra cima (o botão não está mais grudado no rodapé da tela).
export default function WhatsAppFab({ inline = false }: { inline?: boolean }) {
  const [open, setOpen] = useState(false)
  const sizeClass = inline ? 'w-11 h-11' : 'w-16 h-16'

  return (
    <div className={inline ? 'relative flex-shrink-0' : 'fixed bottom-6 left-6 z-40'}>
      {/* z-index BAIXO de propósito — esse backdrop só existe pra fechar
          o tooltip num clique fora dele. Com z-30 (mais alto que o
          tooltip/botão) ele ficava por CIMA dos ícones de rede e
          engolia o clique antes de chegar neles (bug reportado: "clico
          e não acontece nada"). Ficando abaixo do tooltip (z-20) e do
          botão (z-20), continua cobrindo o resto da página pra fechar
          no clique fora, mas não intercepta mais nada aqui dentro. */}
      {open && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <ul className={`sunset-share-tooltip${inline ? ' sunset-share-tooltip-down' : ''}${open ? ' is-open' : ''}`}>
        <li className="sunset-share-item" data-network="whatsapp">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp"
            onClick={() => setOpen(false)}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39a9.9 9.9 0 0 0 4.75 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.06c-.24.68-1.4 1.3-1.93 1.36-.5.06-1 .27-3.35-.7-2.83-1.17-4.65-4.04-4.79-4.23-.14-.19-1.14-1.52-1.14-2.9 0-1.38.72-2.05.98-2.33.26-.28.56-.35.75-.35.19 0 .38 0 .54.01.18.01.42-.07.65.5.24.58.82 2 .89 2.15.07.15.12.32.02.51-.1.19-.15.31-.3.48-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.75 1.24 1.62 2 1.11.99 2.05 1.3 2.34 1.45.29.15.46.13.63-.08.17-.21.72-.84.91-1.13.19-.29.38-.24.63-.14.26.1 1.65.78 1.93.92.29.14.48.21.55.33.07.12.07.68-.17 1.36Z" />
            </svg>
          </a>
          <span className="sunset-share-tip">WhatsApp</span>
        </li>
        <li className="sunset-share-item" data-network="instagram">
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Instagram"
            onClick={() => setOpen(false)}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2.2c3.2 0 3.58.01 4.85.07 1.17.05 1.97.24 2.43.4a4.9 4.9 0 0 1 1.77 1.15 4.9 4.9 0 0 1 1.15 1.77c.16.46.35 1.26.4 2.43.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.24 1.97-.4 2.43a4.9 4.9 0 0 1-1.15 1.77 4.9 4.9 0 0 1-1.77 1.15c-.46.16-1.26.35-2.43.4-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.97-.24-2.43-.4a4.9 4.9 0 0 1-1.77-1.15 4.9 4.9 0 0 1-1.15-1.77c-.16-.46-.35-1.26-.4-2.43C2.21 15.58 2.2 15.2 2.2 12s.01-3.58.07-4.85c.05-1.17.24-1.97.4-2.43a4.9 4.9 0 0 1 1.15-1.77A4.9 4.9 0 0 1 5.59 1.8c.46-.16 1.26-.35 2.43-.4C9.29 2.21 9.67 2.2 12 2.2Zm0 1.8c-3.14 0-3.5.01-4.74.07-.95.04-1.47.2-1.81.34-.46.18-.78.39-1.12.73-.34.34-.55.66-.73 1.12-.14.34-.3.86-.34 1.81C3.21 8.5 3.2 8.86 3.2 12s.01 3.5.07 4.74c.04.95.2 1.47.34 1.81.18.46.39.78.73 1.12.34.34.66.55 1.12.73.34.14.86.3 1.81.34 1.24.06 1.6.07 4.74.07s3.5-.01 4.74-.07c.95-.04 1.47-.2 1.81-.34.46-.18.78-.39 1.12-.73.34-.34.55-.66.73-1.12.14-.34.3-.86.34-1.81.06-1.24.07-1.6.07-4.74s-.01-3.5-.07-4.74c-.04-.95-.2-1.47-.34-1.81a3.1 3.1 0 0 0-.73-1.12 3.1 3.1 0 0 0-1.12-.73c-.34-.14-.86-.3-1.81-.34C15.5 4.01 15.14 4 12 4Zm0 3.05a4.95 4.95 0 1 1 0 9.9 4.95 4.95 0 0 1 0-9.9Zm0 1.8a3.15 3.15 0 1 0 0 6.3 3.15 3.15 0 0 0 0-6.3Zm5.15-1.99a1.16 1.16 0 1 1-2.31 0 1.16 1.16 0 0 1 2.31 0Z" />
            </svg>
          </a>
          <span className="sunset-share-tip">Instagram</span>
        </li>
      </ul>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`group relative z-20 ${sizeClass}`}
        aria-label="Falar no WhatsApp ou ver redes sociais"
        aria-expanded={open}
      >
        <div className={`relative z-10 ${sizeClass} rounded-full overflow-hidden bg-son-black group-hover:scale-105 transition-transform`}>
          <img src={logoSrc} alt="" className="w-full h-full object-cover" />
        </div>
      </button>
    </div>
  )
}
