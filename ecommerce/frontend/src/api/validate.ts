import type { z } from 'zod'

// Ponto único de validação de contrato: toda resposta que sai de
// src/api/endpoints/* passa por aqui antes de chegar em services/hooks.
//
// Decisão deliberada: usa safeParse, NUNCA lança. Se o shape não bater
// (backend mudou um campo, por exemplo), loga um erro BEM visível no
// console — não silencioso — mas devolve o dado original mesmo assim, do
// jeito que ele chegou. Trocar por throw mudaria comportamento (uma tela
// que hoje "funciona torto" passaria a quebrar de vez), o que não é o
// objetivo aqui: o objetivo é só parar de deixar uma mudança de contrato
// passar batido, sem barulho nenhum.
export function validate<S extends z.ZodType>(schema: S, data: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    console.error(`[contrato] resposta de "${label}" não bate com o schema esperado — o backend pode ter mudado. Usando os dados como vieram, mas confira o contrato.`, result.error.issues, data)
    return data as z.infer<S>
  }
  return result.data
}

// Mesma ideia, pra quando a resposta é uma lista.
export function validateList<S extends z.ZodType>(schema: S, data: unknown[], label: string): z.infer<S>[] {
  return data.map((item, i) => validate(schema, item, `${label}[${i}]`))
}
