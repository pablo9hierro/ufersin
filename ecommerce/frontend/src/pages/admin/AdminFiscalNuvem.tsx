import { useEffect, useState } from 'react'
import { Cloud, Download, Loader2, MoreVertical } from 'lucide-react'
import Card from '../../components/ui/Card'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { NuvemFiscalItem } from '../../lib/api'

const MANIFESTACAO_OPTIONS = [
  { value: 'CienciaOperacao', label: 'Ciência da operação' },
  { value: 'ConfirmacaoOperacao', label: 'Confirmação da operação' },
  { value: 'Desconhecimento', label: 'Desconhecimento da operação' },
]

/** Consulta unificada de notas de entrada e saída conhecidas do Jubilados
 * pra esse CNPJ ("nuvem fiscal") -- entrada com ações de manifestação,
 * saída com ações de anular/inutilizar/CCe, tudo via menu de 3 pontos por
 * linha em vez de páginas separadas pra quem já sabe qual nota quer agir. */
export default function AdminFiscalNuvem() {
  const [tipo, setTipo] = useState<'Entrada' | 'Saída'>('Entrada')
  const [notas, setNotas] = useState<NuvemFiscalItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { askConfirm, confirmDialogElement } = useConfirmDialog()

  const load = () => {
    setError(null)
    adminService.fiscal
      .listarNotas({ tipo })
      .then((r) => setNotas(r.notas))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Não foi possível carregar as notas.'))
  }

  useEffect(load, [tipo])

  const buscarNovasEntradas = async () => {
    setBuscando(true)
    setActionError(null)
    try {
      await adminService.fiscal.consultarEntrada()
      load()
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Não foi possível consultar novas notas na SEFAZ.')
    } finally {
      setBuscando(false)
    }
  }

  const manifestar = (notaId: string, tipoManifestacao: string, label: string) => {
    askConfirm(`Enviar manifestação "${label}" pra SEFAZ? Essa ação é irreversível.`, async () => {
      setBusyId(notaId)
      setActionError(null)
      try {
        await adminService.fiscal.manifestar({ nota_fiscal_id: notaId, tipo_manifestacao: tipoManifestacao })
        load()
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : 'Não foi possível manifestar.')
      } finally {
        setBusyId(null)
      }
    })
  }

  const anular = (nota: NuvemFiscalItem) => {
    askConfirm(`Anular a nota #${nota.numero} série ${nota.serie} na SEFAZ? Essa ação é irreversível.`, async () => {
      setBusyId(nota.id)
      setActionError(null)
      try {
        await adminService.fiscal.cancelarNota(nota.id)
        load()
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : 'Não foi possível anular a nota.')
      } finally {
        setBusyId(null)
      }
    })
  }

  const baixar = async (kind: 'danfe' | 'xml', notaId: string) => {
    setActionError(null)
    try {
      const url = kind === 'danfe' ? await adminService.fiscal.danfeUrl(notaId) : await adminService.fiscal.xmlUrl(notaId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : `Não foi possível baixar o ${kind.toUpperCase()}.`)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black mb-2 flex items-center gap-2">
          <Cloud className="w-5 h-5" /> Consultar nuvem fiscal
        </h1>
        <p className="text-sm text-son-silver-dim">
          Todas as notas de entrada e saída conhecidas do Jubilados pra este CNPJ, com ação rápida por nota.
        </p>
      </div>
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-2">
            {(['Entrada', 'Saída'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                  tipo === t ? 'sunset-bg text-white' : 'bg-white/5 text-son-silver-dim hover:text-white'
                }`}
              >
                Notas fiscais de {t.toLowerCase()}
              </button>
            ))}
          </div>
          {tipo === 'Entrada' && (
            <button type="button" onClick={buscarNovasEntradas} disabled={buscando} className="btn-secondary text-xs px-3 py-1.5">
              {buscando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Buscar novas na SEFAZ'}
            </button>
          )}
        </div>

        {error && <p className="error-msg">{error}</p>}
        {actionError && <p className="error-msg">{actionError}</p>}
        {!notas && !error && <Loader2 className="w-5 h-5 animate-spin text-son-pink" />}
        {notas?.length === 0 && <p className="text-sm text-son-silver-dim">Nenhuma nota encontrada.</p>}

        {notas && notas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-son-silver-dim border-b border-white/5">
                  <th className="py-2 pr-3">Número</th>
                  <th className="py-2 pr-3">Natureza</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Valor</th>
                  <th className="py-2 pr-3">Data</th>
                  {tipo === 'Entrada' && <th className="py-2 pr-3">Manifestada</th>}
                  <th className="py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => (
                  <tr key={n.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">
                      {n.numero}/{n.serie}
                    </td>
                    <td className="py-2 pr-3">{n.naturezaOperacao}</td>
                    <td className="py-2 pr-3">{n.status}</td>
                    <td className="py-2 pr-3">R$ {n.valorTotal.toFixed(2)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(n.emitidaEm).toLocaleDateString('pt-BR')}</td>
                    {tipo === 'Entrada' && (
                      <td className="py-2 pr-3">{n.manifestada ? 'Sim' : 'Não'}</td>
                    )}
                    <td className="py-2 text-right">
                      {busyId === n.id ? (
                        <Loader2 className="w-4 h-4 animate-spin inline-block text-son-silver-dim" />
                      ) : (
                        <details className="relative inline-block text-left group">
                          <summary className="list-none cursor-pointer p-1.5 rounded-lg hover:bg-white/5 [&::-webkit-details-marker]:hidden inline-flex">
                            <MoreVertical className="w-4 h-4 text-son-silver-dim" />
                          </summary>
                          <div className="absolute right-0 mt-1 w-56 uf-glass rounded-xl shadow-xl z-10 py-1 bg-son-surface border border-white/10">
                            {tipo === 'Entrada' && !n.manifestada
                              ? MANIFESTACAO_OPTIONS.map((o) => (
                                  <button
                                    key={o.value}
                                    type="button"
                                    onClick={() => manifestar(n.id, o.value, o.label)}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                                  >
                                    {o.label}
                                  </button>
                                ))
                              : null}
                            {tipo === 'Saída' && (
                              <button
                                type="button"
                                onClick={() => anular(n)}
                                className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-white/5"
                              >
                                Anular nota
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => baixar('danfe', n.id)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-1.5"
                            >
                              <Download className="w-3.5 h-3.5" /> DANFE
                            </button>
                            <button
                              type="button"
                              onClick={() => baixar('xml', n.id)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-1.5"
                            >
                              <Download className="w-3.5 h-3.5" /> XML
                            </button>
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {confirmDialogElement}
    </div>
  )
}
