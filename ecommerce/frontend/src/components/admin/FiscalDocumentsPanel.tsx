import { useEffect, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import Card from '../ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { FiscalDocumentListItem } from '../../lib/api'

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  processando: { label: 'Processando', className: 'bg-amber-500/15 text-amber-300' },
  autorizada: { label: 'Autorizada', className: 'bg-emerald-500/15 text-emerald-300' },
  rejeitada: { label: 'Rejeitada', className: 'bg-red-500/15 text-red-300' },
  cancelada: { label: 'Cancelada', className: 'bg-white/10 text-son-silver-dim' },
  erro: { label: 'Erro', className: 'bg-red-500/15 text-red-300' },
}

/** Painel Fiscal → Documentos -- lista as notas emitidas (XML/DANFE são
 * links do próprio Jubilados, aqui só exibe/baixa, nunca gera nada). */
export default function FiscalDocumentsPanel({ className = 'p-4' }: { className?: string }) {
  const [docs, setDocs] = useState<FiscalDocumentListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminService.fiscal
      .listDocuments()
      .then(setDocs)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Não foi possível carregar os documentos fiscais.'))
  }, [])

  return (
    <Card className={className}>
      <p className="label mb-3 flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> Documentos fiscais
      </p>
      {error && <p className="error-msg">{error}</p>}
      {!docs && !error && <Loader2 className="w-5 h-5 animate-spin text-son-pink" />}
      {docs && docs.length === 0 && <p className="text-sm text-son-silver-dim">Nenhuma nota emitida ainda.</p>}
      {docs && docs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-son-silver-dim border-b border-white/5">
                <th className="py-2 pr-3">Data</th>
                <th className="py-2 pr-3">Cliente</th>
                <th className="py-2 pr-3">Modelo</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Chave de acesso</th>
                <th className="py-2 pr-3">Valor</th>
                <th className="py-2">Documentos</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const s = STATUS_LABEL[d.status] ?? { label: d.status, className: 'bg-white/10 text-son-silver-dim' }
                return (
                  <tr key={d.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(d.created_at).toLocaleDateString('pt-BR')}</td>
                    <td className="py-2 pr-3">{d.customer_name ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{d.modelo === '65' ? 'NFC-e' : 'NF-e'}</td>
                    <td className="py-2 pr-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.className}`}>{s.label}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-[10px] text-son-silver-dim">
                      {d.chave_acesso ? `${d.chave_acesso.slice(0, 8)}…${d.chave_acesso.slice(-6)}` : '—'}
                    </td>
                    <td className="py-2 pr-3">{d.total != null ? `R$ ${d.total.toFixed(2)}` : '—'}</td>
                    <td className="py-2 flex items-center gap-2">
                      {d.danfe_url && (
                        <a href={d.danfe_url} target="_blank" rel="noreferrer" className="text-son-pink hover:underline text-xs">
                          DANFE
                        </a>
                      )}
                      {d.xml_url && (
                        <a href={d.xml_url} target="_blank" rel="noreferrer" className="text-son-pink hover:underline text-xs">
                          XML
                        </a>
                      )}
                      {!d.danfe_url && !d.xml_url && <span className="text-xs text-son-silver-dim">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
