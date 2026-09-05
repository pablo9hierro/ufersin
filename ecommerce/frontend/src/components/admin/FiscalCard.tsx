import { useEffect, useState } from 'react'
import { Check, FileText, Loader2, Save } from 'lucide-react'
import Card from '../ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { FiscalSettings } from '../../lib/api'

/** Beta: NF-e/NFC-e via módulo Jubilados, atrás de Feature::EmissaoFiscal.
 * Cadastro fiscal da empresa (CNPJ/certificado) fica em Meu Plano →
 * Financeiro → Fiscal, na plataforma -- aqui só o que é operacional do
 * lado da loja (ambiente, CFOP padrão, emissão automática). */
export default function FiscalCard({ className = 'p-4 mb-6' }: { className?: string }) {
  const [settings, setSettings] = useState<FiscalSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [ambiente, setAmbiente] = useState<'homologacao' | 'producao'>('homologacao')
  const [cfopPadrao, setCfopPadrao] = useState('')
  const [autoEmitir, setAutoEmitir] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = async () => {
    setError(null)
    try {
      const s = await adminService.fiscal.getSettings()
      setSettings(s)
      setAmbiente(s.ambiente)
      setCfopPadrao(s.cfop_padrao_saida ?? '')
      setAutoEmitir(s.auto_emitir)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar a configuração fiscal.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const configured = !!settings?.jubilados_empresa_id && settings?.enabled

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const updated = await adminService.fiscal.updateSettings({
        ambiente,
        cfop_padrao_saida: cfopPadrao.trim() || null,
        auto_emitir: autoEmitir,
        enabled: settings?.enabled ?? false,
      })
      setSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className={className}>
      <p className="label mb-3 flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> Emissão fiscal — NF-e/NFC-e (beta)
      </p>
      <p className="text-xs text-son-silver-dim mb-4">
        Cadastro da empresa (CNPJ, certificado) fica em Meu Plano → Financeiro → Fiscal. Aqui você ajusta o ambiente,
        o CFOP padrão e se a emissão acontece sozinha ao confirmar o pagamento.
      </p>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
      ) : (
        <div className="space-y-4">
          <p className="text-xs font-semibold text-son-silver-dim">
            Empresa fiscal —{' '}
            {configured ? <span className="text-emerald-400">configurada</span> : 'não configurada'}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Ambiente</label>
              <select
                className="input-field w-40 py-2 text-sm"
                value={ambiente}
                onChange={(e) => setAmbiente(e.target.value as 'homologacao' | 'producao')}
              >
                <option value="homologacao">Homologação</option>
                <option value="producao">Produção</option>
              </select>
            </div>
            <div>
              <label className="label">CFOP padrão de saída</label>
              <input
                className="input-field w-32 py-2 text-sm"
                placeholder="Ex: 5102"
                value={cfopPadrao}
                onChange={(e) => setCfopPadrao(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-son-silver-dim py-2">
              <input type="checkbox" checked={autoEmitir} onChange={(e) => setAutoEmitir(e.target.checked)} />
              Emitir automaticamente ao confirmar pagamento
            </label>
            <button onClick={save} disabled={saving} className="btn-secondary text-sm py-2 px-4">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4" />}
              Salvar
            </button>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>
      )}
    </Card>
  )
}
