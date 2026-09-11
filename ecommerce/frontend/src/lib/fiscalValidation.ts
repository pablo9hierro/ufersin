// Validação de FORMATO (dígito verificador) de CPF/CNPJ -- mesmo
// algoritmo usado no backend (ecommerce/backend/src/fiscal/validation.rs).
// Duplicado aqui de propósito: o front valida cedo pra UX, o backend
// sempre revalida antes de qualquer emissão real.

function onlyDigits(v: string): string {
  return v.replace(/\D/g, '')
}

export function isValidCpf(v: string): boolean {
  const d = onlyDigits(v)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const digits = d.split('').map(Number)
  const calc = (slice: number[], start: number) => {
    const sum = slice.reduce((acc, val, i) => acc + val * (start - i), 0)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(digits.slice(0, 9), 10) === digits[9] && calc(digits.slice(0, 10), 11) === digits[10]
}

export function isValidCnpj(v: string): boolean {
  const d = onlyDigits(v)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const digits = d.split('').map(Number)
  const calc = (slice: number[]) => {
    const weights = slice.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = slice.reduce((acc, val, i) => acc + val * weights[i], 0)
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(digits.slice(0, 12)) === digits[12] && calc(digits.slice(0, 13)) === digits[13]
}

export function isValidDocumento(tipo: 'cpf' | 'cnpj', valor: string): boolean {
  return tipo === 'cpf' ? isValidCpf(valor) : isValidCnpj(valor)
}

// Validação de FORMATO (nunca de existência em catálogo fechado) dos
// códigos fiscais de texto livre -- mesmas regras de
// ecommerce/backend/src/fiscal/validation.rs. CST/CSOSN continuam dropdown
// fechado (decisão já tomada), não precisam de validação de formato aqui.
export function isValidCfopFormat(v: string): boolean {
  const d = onlyDigits(v)
  return d.length === 4 && d !== '0000'
}

export function isValidNcmFormat(v: string): boolean {
  return onlyDigits(v).length === 8
}

export function isValidCestFormat(v: string): boolean {
  return onlyDigits(v).length === 7
}

// Regra de negócio explícita (não é exigência da SEFAZ): a partir deste
// valor, identificar o comprador deixa de ser opt-in e vira obrigatório --
// mesmo limiar usado no backend (fiscal/validation.rs e no RPC de checkout).
export const IDENTIFICACAO_OBRIGATORIA_A_PARTIR_DE = 500

export const UF_OPTIONS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const
