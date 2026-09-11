import { useState } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'

/** Inutiliza uma faixa de numeração NUNCA emitida na SEFAZ (pulo de número
 * por falha de sistema, por exemplo) -- não é o mesmo que anular uma nota
 * já autorizada (isso é "Anular" no painel de Emitir). */
export default function AdminFiscalInutilizar() {
  const [serie, setSerie] = useState('1')
  const [numeroInicial, setNumeroInicial] = useState('')
  const [numeroFinal, setNumeroFinal] = useState('')
  const [justificativa, setJustificativa] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [protocolo, setProtocolo] = useState<string | null>(null)
  const { askConfirm, confirmDialogElement } = useConfirmDialog()

  const submit = () => {
    setError(null)
    setProtocolo(null)
    const ini = Number(numeroInicial)
    const fim = Number(numeroFinal)
    if (!Number.isFinite(ini) || ini <= 0) return setError('Informe o número inicial.')
    if (!Number.isFinite(fim) || fim < ini) return setError('Número final deve ser maior ou igual ao inicial.')
    if (justificativa.trim().length < 15) return setError('Justificativa deve ter ao menos 15 caracteres.')
    askConfirm(
      `Inutilizar a numeração ${serie}/${ini}${fim !== ini ? `–${fim}` : ''} na SEFAZ? Essa ação é irreversível.`,
      doSubmit
    )
  }

  const doSubmit = async () => {
    setSaving(true)
    try {
      const result = await adminService.fiscal.inutilizar({
        serie,
        numero_inicial: Number(numeroInicial),
        numero_final: Number(numeroFinal),
        justificativa: justificativa.trim(),
      })
      setProtocolo(result.protocolo ?? 'inutilizado')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível inutilizar a numeração.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black mb-2 flex items-center gap-2">
          <Ban className="w-5 h-5" /> Inutilizar numeração
        </h1>
        <p className="text-sm text-son-silver-dim">
          Comunica à SEFAZ que uma faixa de números de NF-e/NFC-e nunca será usada (pulo de numeração). Use isso
          quando um número foi pulado por erro, nunca pra cancelar uma nota já emitida — isso é feito em "Emitir".
        </p>
      </div>
      <Card className="p-4 space-y-3 max-w-lg">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Série</label>
            <input className="input-field" value={serie} onChange={(e) => setSerie(e.target.value)} />
          </div>
          <div>
            <label className="label">Número inicial</label>
            <input
              className="input-field"
              type="number"
              value={numeroInicial}
              onChange={(e) => setNumeroInicial(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Número final</label>
            <input
              className="input-field"
              type="number"
              value={numeroFinal}
              onChange={(e) => setNumeroFinal(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">Justificativa (mín. 15 caracteres)</label>
          <textarea
            className="input-field"
            rows={3}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
          />
        </div>
        <button type="button" onClick={submit} disabled={saving} className="btn-primary w-full py-2.5 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
          Inutilizar numeração
        </button>
        {error && <p className="error-msg">{error}</p>}
        {protocolo && <p className="text-sm text-emerald-400">Inutilização enviada — protocolo: {protocolo}</p>}
      </Card>
      {confirmDialogElement}
    </div>
  )
}
