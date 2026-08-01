/** Validadores reais de CPF/CNPJ (dígitos verificadores). */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

export function isValidCpf(raw: string): boolean {
  const cpf = onlyDigits(raw)
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false

  const calc = (base: string, factor: number) => {
    let sum = 0
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]) * (factor - i)
    }
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }

  const d1 = calc(cpf.slice(0, 9), 10)
  const d2 = calc(cpf.slice(0, 10), 11)
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10])
}

export function isValidCnpj(raw: string): boolean {
  const cnpj = onlyDigits(raw)
  if (cnpj.length !== 14) return false
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  const calc = (base: string, weights: number[]) => {
    let sum = 0
    for (let i = 0; i < weights.length; i++) {
      sum += Number(base[i]) * weights[i]
    }
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const d1 = calc(cnpj.slice(0, 12), w1)
  const d2 = calc(cnpj.slice(0, 13), w2)
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13])
}

export function isValidDocumento(tipo: 'cpf' | 'cnpj', raw: string): boolean {
  return tipo === 'cpf' ? isValidCpf(raw) : isValidCnpj(raw)
}
