#!/usr/bin/env node
/**
 * Lê docs/bugs/registry.yaml e garante que todo bug crítico já corrigido
 * (severity: critical, status: fixed) tem uma forma real de detectar
 * regressão: ou um regression_test_id que aparece literalmente num
 * `run('BUG-XXX: ...')` dentro de
 * ecommerce/frontend/tests/bug-regressions/run.mjs, ou um
 * manual_verification preenchido (passo a passo pra checar na mão,
 * quando automatizar não é viável).
 *
 * Uso: node scripts/check-bug-coverage.mjs
 * Saída: lista o que está coberto, o que está descoberto (falha com
 * exit 1 se algum bug crítico ficar sem NENHUMA das duas formas).
 *
 * Não precisa de nenhuma dependência de YAML — o registry usa uma
 * estrutura simples o bastante pra um parser bem pequeno e burro dar
 * conta, sem puxar `js-yaml` só pra isso.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const registryPath = path.join(repoRoot, 'docs', 'bugs', 'registry.yaml')
const regressionTestPath = path.join(repoRoot, 'ecommerce', 'frontend', 'tests', 'bug-regressions', 'run.mjs')

/** Parser mínimo pra este YAML específico (lista de objetos flat, sem aninhamento profundo) — não é um parser YAML geral. */
function parseRegistry(text) {
  const lines = text.split(/\r?\n/)
  const entries = []
  let current = null
  let inBlockScalar = null // { key, indent }

  for (const rawLine of lines) {
    if (inBlockScalar) {
      const indent = rawLine.match(/^(\s*)/)[1].length
      if (rawLine.trim() === '' || indent > inBlockScalar.indent) {
        current[inBlockScalar.key] = (current[inBlockScalar.key] || '') + rawLine.trim() + ' '
        continue
      }
      inBlockScalar = null
    }
    if (/^\s*#/.test(rawLine) || rawLine.trim() === '') continue

    const itemMatch = rawLine.match(/^- id:\s*(\S+)/)
    if (itemMatch) {
      if (current) entries.push(current)
      current = { id: itemMatch[1] }
      continue
    }
    if (!current) continue

    const kv = rawLine.match(/^\s+([a-z_]+):\s*(.*)$/)
    if (!kv) continue
    const [, key, rawVal] = kv
    if (rawVal === '>' || rawVal === '|') {
      inBlockScalar = { key, indent: rawLine.match(/^(\s*)/)[1].length }
      current[key] = ''
      continue
    }
    let val = rawVal.trim()
    if (val === 'null' || val === '') {
      current[key] = null
    } else if (val.startsWith('"') && val.endsWith('"')) {
      current[key] = val.slice(1, -1)
    } else {
      current[key] = val
    }
  }
  if (current) entries.push(current)
  return entries
}

function main() {
  if (!fs.existsSync(registryPath)) {
    console.error(`Registry não encontrado: ${registryPath}`)
    process.exit(1)
  }
  const registryText = fs.readFileSync(registryPath, 'utf8')
  const entries = parseRegistry(registryText)

  const regressionTestText = fs.existsSync(regressionTestPath) ? fs.readFileSync(regressionTestPath, 'utf8') : ''

  const critical = entries.filter((e) => e.severity === 'critical' && e.status === 'fixed')
  const uncovered = []
  const coveredByTest = []
  const coveredByManual = []

  for (const bug of critical) {
    const hasTest = bug.regression_test_id && regressionTestText.includes(`'${bug.regression_test_id}:`)
    const hasManual = bug.manual_verification && bug.manual_verification.trim().length > 0
    if (hasTest) coveredByTest.push(bug.id)
    else if (hasManual) coveredByManual.push(bug.id)
    else uncovered.push(bug)
  }

  console.log(`Registro de bugs: ${entries.length} entradas (${critical.length} crítico(s) já corrigido(s)).`)
  console.log(`  Coberto por teste automatizado: ${coveredByTest.length > 0 ? coveredByTest.join(', ') : '—'}`)
  console.log(`  Coberto por verificação manual documentada: ${coveredByManual.length > 0 ? coveredByManual.join(', ') : '—'}`)

  if (uncovered.length > 0) {
    console.error('')
    console.error('FALHA: bug crítico corrigido sem regression_test_id nem manual_verification:')
    for (const bug of uncovered) {
      console.error(`  - ${bug.id}: ${bug.title}`)
    }
    console.error('')
    console.error('Adicione um teste em ecommerce/frontend/tests/bug-regressions/run.mjs (nomeado')
    console.error(`  run('${uncovered[0]?.id}: ...', ...)) ou preencha manual_verification em docs/bugs/registry.yaml.`)
    process.exit(1)
  }

  console.log('')
  console.log('OK — todo bug crítico corrigido tem cobertura (teste automatizado ou procedimento manual documentado).')
}

main()
