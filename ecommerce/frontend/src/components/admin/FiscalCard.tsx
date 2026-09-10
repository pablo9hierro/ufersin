import { useEffect, useState } from 'react'
import { Check, FileText, Loader2, Plus, Save, Star, Trash2 } from 'lucide-react'
import Card from '../ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { CfopOption, FiscalSettings, TenantCfop } from '../../lib/api'

/** Beta: NF-e/NFC-e via módulo Jubilados, atrás de Feature::EmissaoFiscal.
 * Cadastro fiscal da empresa (CNPJ/certificado) fica em Meu Plano →
 * Financeiro → Fiscal, na plataforma -- aqui só o que é operacional do
 * lado da loja (ambiente, CFOP padrão, emissão automática). */
export default function FiscalCard({ className = 'p-4 mb-6' }: { className?: string }) {
  const [settings, setSettings] = useState<FiscalSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [ambiente, setAmbiente] = useState<'homologacao' | 'producao'>('homologacao')
  const [autoEmitir, setAutoEmitir] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [cfops, setCfops] = useState<TenantCfop[]>([])
  const [cfopQuery, setCfopQuery] = useState('')
  const [cfopResults, setCfopResults] = useState<CfopOption[]>([])
  const [cfopSearching, setCfopSearching] = useState(false)
  const [cfopError, setCfopError] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    try {
      const [s, list] = await Promise.all([adminService.fiscal.getSettings(), adminService.fiscal.cfops.list()])
      setSettings(s)
      setAmbiente(s.ambiente)
      setAutoEmitir(s.auto_emitir)
      setCfops(list)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar a configuração fiscal.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // Busca só quando o usuário digita ao menos 2 caracteres -- nunca lista
  // os ~600 CFOPs oficiais de uma vez.
  useEffect(() => {
    if (cfopQuery.trim().length < 2) {
      setCfopResults([])
      return
    }
    let cancelled = false
    setCfopSearching(true)
    const t = setTimeout(() => {
      adminService.fiscal.cfops
        .search(cfopQuery.trim())
        .then((r) => !cancelled && setCfopResults(r))
        .catch(() => {})
        .finally(() => !cancelled && setCfopSearching(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [cfopQuery])

  const addCfop = async (codigo: string) => {
    setCfopError(null)
    try {
      const list = await adminService.fiscal.cfops.add(codigo)
      setCfops(list)
      setCfopQuery('')
      setCfopResults([])
    } catch (e) {
      setCfopError(e instanceof ApiError ? e.message : 'Não foi possível adicionar esse CFOP.')
    }
  }

  const removeCfop = async (codigo: string) => {
    try {
      setCfops(await adminService.fiscal.cfops.remove(codigo))
    } catch (e) {
      setCfopError(e instanceof ApiError ? e.message : 'Não foi possível remover esse CFOP.')
    }
  }

  const setDefaultCfop = async (codigo: string) => {
    try {
      setCfops(await adminService.fiscal.cfops.setDefault(codigo))
    } catch (e) {
      setCfopError(e instanceof ApiError ? e.message : 'Não foi possível definir o padrão.')
    }
  }

  const configured = !!settings?.jubilados_empresa_id && settings?.enabled

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const updated = await adminService.fiscal.updateSettings({
        ambiente,
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

          <div className="border-t border-son-silver-dim/10 pt-4">
            <p className="label mb-1">CFOPs de saída</p>
            <p
              className="text-xs text-son-silver-dim mb-3"
              title="Novos produtos e produtos sem CFOP específico usam o CFOP marcado PADRÃO automaticamente. Você pode sobrescrever o CFOP em cada produto (aba Produtos)."
            >
              O primeiro CFOP cadastrado vira padrão sozinho — você pode trocar depois.
            </p>

            {cfops.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {cfops.map((c) => (
                  <li
                    key={c.codigo}
                    className="flex items-center gap-2 text-sm bg-black/20 border border-son-silver-dim/10 rounded-lg px-3 py-2"
                  >
                    <span className="font-mono text-xs text-son-silver-dim">{c.codigo}</span>
                    <span className="flex-1 truncate">{c.descricao}</span>
                    {c.is_default ? (
                      <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1 shrink-0">
                        <Star className="w-3 h-3 fill-emerald-400" /> PADRÃO
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDefaultCfop(c.codigo)}
                        className="text-[10px] text-son-silver-dim hover:text-emerald-400 shrink-0"
                      >
                        tornar padrão
                      </button>
                    )}
                    <button type="button" onClick={() => removeCfop(c.codigo)} className="text-son-silver-dim hover:text-red-400 shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="relative">
              <input
                className="input-field w-full py-2 text-sm"
                placeholder="Pesquisar CFOP (código ou descrição)…"
                value={cfopQuery}
                onChange={(e) => setCfopQuery(e.target.value)}
              />
              {(cfopSearching || cfopResults.length > 0) && (
                <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-son-surface border border-son-silver-dim/20 rounded-lg shadow-xl">
                  {cfopSearching && <li className="px-3 py-2 text-xs text-son-silver-dim">Buscando…</li>}
                  {cfopResults.map((r) => (
                    <li key={r.codigo}>
                      <button
                        type="button"
                        onClick={() => addCfop(r.codigo)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-2"
                      >
                        <Plus className="w-3.5 h-3.5 text-son-silver-dim shrink-0" />
                        <span className="font-mono text-xs text-son-silver-dim shrink-0">{r.codigo}</span>
                        <span className="truncate">{r.descricao}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {cfopError && <p className="error-msg mt-2">{cfopError}</p>}
          </div>
        </div>
      )}
    </Card>
  )
}
