import { useEffect, useState } from 'react'
import { Loader2, MailCheck } from 'lucide-react'
import Card from '../../components/ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import type { NuvemFiscalItem } from '../../lib/api'

const TIPOS = [
  { value: 'CienciaOperacao', label: 'Ciência da operação' },
  { value: 'ConfirmacaoOperacao', label: 'Confirmação da operação' },
  { value: 'Desconhecimento', label: 'Desconhecimento da operação' },
  { value: 'OperacaoNaoRealizada', label: 'Operação não realizada' },
]

/** Manifestação do destinatário -- obrigatória sobre notas de ENTRADA
 * (onde a loja é quem RECEBE a mercadoria/serviço), exigida pela SEFAZ pra
 * confirmar/recusar o que terceiros emitiram contra o CNPJ da loja. */
export default function AdminFiscalManifestacao() {
  const [notas, setNotas] = useState<NuvemFiscalItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [notaId, setNotaId] = useState('')
  const [tipo, setTipo] = useState(TIPOS[0].value)
  const [justificativa, setJustificativa] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const { askConfirm, confirmDialogElement } = useConfirmDialog()

  const load = () => {
    adminService.fiscal
      .listarNotas({ tipo: 'Entrada' })
      .then((r) => setNotas(r.notas.filter((n) => !n.manifestada)))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Não foi possível carregar as notas.'))
  }

  useEffect(load, [])

  const buscarNovas = async () => {
    setBuscando(true)
    setLoadError(null)
    try {
      await adminService.fiscal.consultarEntrada()
      load()
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Não foi possível consultar novas notas na SEFAZ.')
    } finally {
      setBuscando(false)
    }
  }

  const submit = () => {
    setError(null)
    setDone(false)
    if (!notaId) return setError('Escolha a nota fiscal.')
    if (tipo === 'OperacaoNaoRealizada' && justificativa.trim().length < 15) {
      return setError('Operação não realizada exige justificativa com ao menos 15 caracteres.')
    }
    const label = TIPOS.find((t) => t.value === tipo)?.label ?? tipo
    askConfirm(`Enviar manifestação "${label}" pra SEFAZ? Essa ação é irreversível.`, doSubmit)
  }

  const doSubmit = async () => {
    setSaving(true)
    try {
      await adminService.fiscal.manifestar({
        nota_fiscal_id: notaId,
        tipo_manifestacao: tipo,
        justificativa: justificativa.trim() || undefined,
      })
      setDone(true)
      setNotaId('')
      setJustificativa('')
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível manifestar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black mb-2 flex items-center gap-2">
          <MailCheck className="w-5 h-5" /> Manifestação fiscal
        </h1>
        <p className="text-sm text-son-silver-dim">
          Sobre notas de ENTRADA (fornecedores emitindo contra o CNPJ da loja) — confirme, dê ciência ou recuse o que
          chegou.
        </p>
      </div>
      <Card className="p-4 space-y-3 max-w-lg">
        <div className="flex items-center justify-between">
          <label className="label mb-0">Nota fiscal de entrada</label>
          <button type="button" onClick={buscarNovas} disabled={buscando} className="btn-secondary text-xs px-3 py-1.5">
            {buscando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Buscar novas na SEFAZ'}
          </button>
        </div>
        <select className="input-field" value={notaId} onChange={(e) => setNotaId(e.target.value)}>
          <option value="">Selecionar…</option>
          {notas?.map((n) => (
            <option key={n.id} value={n.id}>
              #{n.numero} série {n.serie} — R$ {n.valorTotal.toFixed(2)} — {n.naturezaOperacao}
            </option>
          ))}
        </select>
        {loadError && <p className="error-msg mt-1">{loadError}</p>}
        {notas?.length === 0 && (
          <p className="text-xs text-son-silver-dim">Nenhuma nota de entrada pendente de manifestação.</p>
        )}
        <div>
          <label className="label">Tipo de manifestação</label>
          <select className="input-field" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {tipo === 'OperacaoNaoRealizada' && (
          <div>
            <label className="label">Justificativa (mín. 15 caracteres)</label>
            <textarea className="input-field" rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
          </div>
        )}
        <button type="button" onClick={submit} disabled={saving} className="btn-primary w-full py-2.5 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailCheck className="w-4 h-4" />}
          Manifestar
        </button>
        {error && <p className="error-msg">{error}</p>}
        {done && <p className="text-sm text-emerald-400">Manifestação enviada.</p>}
      </Card>
      {confirmDialogElement}
    </div>
  )
}
