import { useEffect, useState } from 'react'
import { FileEdit, Loader2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import type { NuvemFiscalItem } from '../../lib/api'

/** Carta de Correção Eletrônica -- corrige dado secundário de uma nota já
 * autorizada (nunca valor, quantidade, dados de identificação das partes
 * ou tributos, isso exige nota de substituição/cancelamento). */
export default function AdminFiscalCce() {
  const [notas, setNotas] = useState<NuvemFiscalItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notaId, setNotaId] = useState('')
  const [correcao, setCorrecao] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [protocolo, setProtocolo] = useState<string | null>(null)
  const { askConfirm, confirmDialogElement } = useConfirmDialog()

  useEffect(() => {
    adminService.fiscal
      .listarNotas({ tipo: 'Saída' })
      .then((r) => setNotas(r.notas))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Não foi possível carregar as notas.'))
  }, [])

  const submit = () => {
    setError(null)
    setProtocolo(null)
    if (!notaId) return setError('Escolha a nota fiscal.')
    if (correcao.trim().length < 15) return setError('Texto de correção deve ter ao menos 15 caracteres.')
    askConfirm('Enviar essa Carta de Correção pra SEFAZ? Essa ação é irreversível.', doSubmit)
  }

  const doSubmit = async () => {
    setSaving(true)
    try {
      const result = await adminService.fiscal.enviarCce({ nota_fiscal_id: notaId, correcao_texto: correcao.trim() })
      setProtocolo(result.protocolo ?? 'enviada')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar a CCe.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black mb-2 flex items-center gap-2">
          <FileEdit className="w-5 h-5" /> Correção fiscal (CCe)
        </h1>
        <p className="text-sm text-son-silver-dim">
          Carta de Correção Eletrônica — corrige um dado secundário de uma nota de saída já autorizada (endereço de
          entrega, informação complementar etc). Nunca corrige valor, quantidade ou tributos.
        </p>
      </div>
      <Card className="p-4 space-y-3 max-w-lg">
        <div>
          <label className="label">Nota fiscal</label>
          <select className="input-field" value={notaId} onChange={(e) => setNotaId(e.target.value)}>
            <option value="">Selecionar…</option>
            {notas?.map((n) => (
              <option key={n.id} value={n.id}>
                #{n.numero} série {n.serie} — {n.status} — R$ {n.valorTotal.toFixed(2)}
              </option>
            ))}
          </select>
          {loadError && <p className="error-msg mt-1">{loadError}</p>}
          {notas?.length === 0 && <p className="text-xs text-son-silver-dim mt-1">Nenhuma nota de saída encontrada.</p>}
        </div>
        <div>
          <label className="label">Texto de correção (15 a 1000 caracteres)</label>
          <textarea className="input-field" rows={4} value={correcao} onChange={(e) => setCorrecao(e.target.value)} />
        </div>
        <button type="button" onClick={submit} disabled={saving} className="btn-primary w-full py-2.5 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileEdit className="w-4 h-4" />}
          Enviar CCe
        </button>
        {error && <p className="error-msg">{error}</p>}
        {protocolo && <p className="text-sm text-emerald-400">CCe enviada — protocolo: {protocolo}</p>}
      </Card>
      {confirmDialogElement}
    </div>
  )
}
