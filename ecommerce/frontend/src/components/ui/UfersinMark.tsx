// Símbolo visual da Ufersin — sem nome/texto, só marca. Ícone de vitrine
// (telhado + porta) dentro de um badge arredondado: "sua loja pronta em
// dias". Usa currentColor de propósito — herda a cor de destaque ativa
// (data-brand='demo' em index.css), então acompanha sozinho qualquer
// paleta que o white-label escolher.
export default function UfersinMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ufersin">
      <rect x="2" y="2" width="44" height="44" rx="13" fill="currentColor" fillOpacity="0.14" />
      <path
        d="M14 21L24 12L34 21V33C34 34.1046 33.1046 35 32 35H16C14.8954 35 14 34.1046 14 33V21Z"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M20 35V26.5C20 25.6716 20.6716 25 21.5 25H26.5C27.3284 25 28 25.6716 28 26.5V35"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
