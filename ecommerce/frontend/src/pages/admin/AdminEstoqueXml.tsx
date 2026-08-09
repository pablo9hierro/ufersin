import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Loader2, Upload } from 'lucide-react'
import Card from '../../components/ui/Card'
import { adminService } from '../../services/adminService'
import { parseNfeFiles, type NfeParsedLine } from '../../lib/nfeXml'
import { ApiError } from '../../lib/apiError'
import type { Ingredient } from '../../types'

type Draft = {
  line: NfeParsedLine
  fileName: string
  name: string
  quantity: string
  cost_price: string
  unit: Ingredient['unit']
  selected: boolean
  status: 'pendente' | 'salvando' | 'salvo' | 'erro'
  error?: string
}

const NFE_UNIT_TO_INGREDIENT_UNIT: Record<string, Ingredient['unit']> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  un: 'un',
}

/**
 * /admin/estoque/xml — importa itens de nota fiscal de entrada (XML de
 * fornecedor/distribuidor) direto como itens de ESTOQUE (tabela
 * `ingredients`), não como produto. Reaproveita o mesmo parser de XML da
 * importação de produtos (`lib/nfeXml`) — só muda pra onde os dados vão.
 */
export default function AdminEstoqueXml() {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setParsing(true)
    setError(null)
    try {
      const { results, errors } = await parseNfeFiles(Array.from(files))
      if (errors.length > 0) {
        setError(errors.map((e) => `${e.fileName}: ${e.message}`).join(' — '))
      }
      const newDrafts: Draft[] = results.flatMap(({ fileName, parsed }) =>
        parsed.lines.map((line) => ({
          line,
          fileName,
          name: line.xProd,
          quantity: String(line.qCom ?? 0),
          cost_price: String(line.vUnCom ?? 0),
          unit: NFE_UNIT_TO_INGREDIENT_UNIT[line.unit] ?? 'un',
          selected: true,
          status: 'pendente' as const,
        })),
      )
      setDrafts((prev) => [...prev, ...newDrafts])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao ler o XML.')
    } finally {
      setParsing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const updateDraft = (idx: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d, i) => (i === idx ? { ...d, ...patch } : d)))

  const importSelected = async () => {
    for (let i = 0; i < drafts.length; i++) {
      if (!drafts[i].selected || drafts[i].status === 'salvo') continue
      updateDraft(i, { status: 'salvando' })
      try {
        await adminService.ingredients.create({
          name: drafts[i].name.trim(),
          unit: drafts[i].unit,
          quantity: Number(drafts[i].quantity) || 0,
          cost_price: Number(drafts[i].cost_price) || 0,
        })
        updateDraft(i, { status: 'salvo' })
      } catch (e) {
        updateDraft(i, { status: 'erro', error: e instanceof ApiError ? e.message : 'Falha ao salvar.' })
      }
    }
  }

  const pendingCount = drafts.filter((d) => d.selected && d.status !== 'salvo').length

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Link to="/admin/estoque" className="btn-secondary text-sm py-2 px-3">
          <ArrowLeft className="w-4 h-4" /> Estoque
        </Link>
        <h1 className="text-2xl font-black">Importar XML pro estoque</h1>
      </div>

      <Card className="p-4 mb-6">
        <p className="text-sm text-son-silver-dim">
          Envie o XML da nota fiscal de entrada do fornecedor/distribuidor. Cada item vira um{' '}
          <span className="text-emerald-400 font-semibold">item de estoque</span> (não um produto à venda) — confira
          nome, unidade, quantidade e custo antes de importar.
        </p>
      </Card>

      <input ref={fileInputRef} type="file" accept=".xml,text/xml,application/xml" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={parsing} className="btn-primary text-sm py-2 px-4 mb-4">
        {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        Selecionar XML
      </button>

      {error && <p className="error-msg mb-4">{error}</p>}

      {drafts.length > 0 && (
        <>
          <div className="space-y-2 mb-4">
            {drafts.map((d, idx) => (
              <Card key={idx} className="p-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={d.selected}
                    disabled={d.status === 'salvo'}
                    onChange={(e) => updateDraft(idx, { selected: e.target.checked })}
                    className="w-4 h-4 mt-2"
                  />
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      className="input-field sm:col-span-2"
                      value={d.name}
                      disabled={d.status === 'salvo'}
                      onChange={(e) => updateDraft(idx, { name: e.target.value })}
                      placeholder="Nome do item"
                    />
                    <input
                      className="input-field"
                      type="number"
                      step="any"
                      value={d.quantity}
                      disabled={d.status === 'salvo'}
                      onChange={(e) => updateDraft(idx, { quantity: e.target.value })}
                      placeholder="Quantidade"
                    />
                    <select
                      className="input-field"
                      value={d.unit}
                      disabled={d.status === 'salvo'}
                      onChange={(e) => updateDraft(idx, { unit: e.target.value as Ingredient['unit'] })}
                    >
                      {(['g', 'kg', 'ml', 'l', 'un'] as const).map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input-field sm:col-span-2"
                      type="number"
                      step="0.01"
                      value={d.cost_price}
                      disabled={d.status === 'salvo'}
                      onChange={(e) => updateDraft(idx, { cost_price: e.target.value })}
                      placeholder="Custo unitário"
                    />
                    <p className="text-xs text-son-silver-dim sm:col-span-2 self-center">
                      {d.status === 'salvo' && <span className="text-emerald-400 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Importado</span>}
                      {d.status === 'salvando' && <span className="flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando…</span>}
                      {d.status === 'erro' && <span className="text-red-400">{d.error}</span>}
                      {d.status === 'pendente' && `de: ${d.fileName}`}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <button type="button" onClick={importSelected} disabled={pendingCount === 0} className="btn-primary py-3 px-6">
            Importar {pendingCount} {pendingCount === 1 ? 'item selecionado' : 'itens selecionados'}
          </button>
        </>
      )}
    </div>
  )
}
