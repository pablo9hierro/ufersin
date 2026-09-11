import { useEffect, useState } from 'react'
import { Layers, Loader2, Plus, Save, Star, Trash2 } from 'lucide-react'
import Card from '../../components/ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { FiscalProfile } from '../../lib/api'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { CST_OPTIONS, CSOSN_OPTIONS } from '../../components/admin/FiscalFields'
import CodigoFiscalInput from '../../components/ui/CodigoFiscalInput'
import { isValidCfopFormat } from '../../lib/fiscalValidation'

const TEMPLATES = [
  { label: 'Venda interna (mesmo estado)', nome: 'Venda interna' },
  { label: 'Venda interestadual', nome: 'Venda interestadual' },
  { label: 'Prestação de serviço', nome: 'Serviço' },
] as const

type FormState = { nome: string; cfop: string; cst: string; csosn: string; cclass_trib: string }
const emptyForm: FormState = { nome: '', cfop: '', cst: '', csosn: '', cclass_trib: '' }

/** Perfis fiscais (seção 2/6 do pedido de resolução fiscal): o produto
 * herda de um perfil em vez de ter CFOP/CST/CSOSN fixos -- a venda escolhe
 * qual perfil vale (automático por UF de destino, ou manual no PDV). Nome
 * é livre; os templates acima só preenchem o campo "nome" pra ajudar,
 * nunca travam a edição do resto. */
export default function AdminFiscalPerfis() {
  const [profiles, setProfiles] = useState<FiscalProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const { askConfirm, confirmDialogElement } = useConfirmDialog()

  const load = async () => {
    setError(null)
    try {
      setProfiles(await adminService.fiscal.profiles.list())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar os perfis fiscais.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const startNew = (template?: string) => {
    setForm({ ...emptyForm, nome: template ?? '' })
    setEditingId('new')
  }

  const startEdit = (p: FiscalProfile) => {
    setForm({ nome: p.nome, cfop: p.cfop ?? '', cst: p.cst ?? '', csosn: p.csosn ?? '', cclass_trib: p.cclass_trib ?? '' })
    setEditingId(p.id)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(emptyForm)
  }

  const save = async () => {
    if (!form.nome.trim()) {
      setError('Dê um nome pro perfil (ex: "Venda interna PB").')
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      nome: form.nome.trim(),
      cfop: form.cfop.trim() || null,
      cst: form.cst.trim() || null,
      csosn: form.csosn.trim() || null,
      cclass_trib: form.cclass_trib.trim() || null,
    }
    try {
      const list =
        editingId === 'new'
          ? await adminService.fiscal.profiles.create(payload)
          : await adminService.fiscal.profiles.update(editingId as string, payload)
      setProfiles(list)
      cancelEdit()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar o perfil fiscal.')
    } finally {
      setSaving(false)
    }
  }

  const remove = (p: FiscalProfile) => {
    askConfirm(
      `Excluir o perfil "${p.nome}"? Produtos vinculados a ele deixam de ter CFOP/CST/CSOSN efetivo até você linkar outro perfil.`,
      async () => {
        try {
          setProfiles(await adminService.fiscal.profiles.remove(p.id))
        } catch (e) {
          setError(e instanceof ApiError ? e.message : 'Não foi possível excluir o perfil.')
        }
      },
    )
  }

  const setDefault = async (p: FiscalProfile) => {
    try {
      setProfiles(await adminService.fiscal.profiles.setDefault(p.id))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível definir o perfil padrão.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-son-silver-dim">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando perfis fiscais…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black mb-2 flex items-center gap-2">
          <Layers className="w-5 h-5" /> Perfis fiscais
        </h1>
        <p className="text-sm text-son-silver-dim max-w-2xl">
          Um perfil agrupa CFOP/CST/CSOSN/Classificação Tributária pra um tipo de venda. O produto herda de um perfil
          — mudar de perfil na hora da venda (ex: cliente de outro estado) nunca exige editar o produto. Campos do
          produto podem sobrescrever o perfil individualmente quando necessário.
        </p>
      </div>

      {error && <p className="error-msg">{error}</p>}

      {editingId ? (
        <Card className="p-4 space-y-3 max-w-lg">
          <div>
            <label className="label">Nome do perfil</label>
            <input
              className="input-field"
              placeholder='ex: "Venda interna PB"'
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CodigoFiscalInput
              label="CFOP"
              value={form.cfop}
              onChange={(v) => setForm((f) => ({ ...f, cfop: v }))}
              validate={isValidCfopFormat}
              formatHint="4 dígitos"
              placeholder="ex: 5102"
            />
            <div>
              <label className="label">Classificação Tributária (IBS/CBS)</label>
              <input
                className="input-field"
                value={form.cclass_trib}
                onChange={(e) => setForm((f) => ({ ...f, cclass_trib: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">CST (regime normal)</label>
              <select className="input-field" value={form.cst} onChange={(e) => setForm((f) => ({ ...f, cst: e.target.value }))}>
                <option value="">Não define (usar CSOSN)</option>
                {CST_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">CSOSN (Simples Nacional)</label>
              <select className="input-field" value={form.csosn} onChange={(e) => setForm((f) => ({ ...f, csosn: e.target.value }))}>
                <option value="">Não define (usar CST)</option>
                {CSOSN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-son-silver-dim">
            Preencha CST OU CSOSN (conforme o regime tributário da loja) — nunca os dois. Códigos vêm do seu
            contador; digite o código exato, sem inventar.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="btn-primary flex-1 py-2.5 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar perfil
            </button>
            <button type="button" onClick={cancelEdit} className="btn-secondary px-4">
              Cancelar
            </button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => startNew()} className="btn-primary py-2 px-4 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Novo perfil
          </button>
          {TEMPLATES.map((t) => (
            <button
              key={t.nome}
              type="button"
              onClick={() => startNew(t.nome)}
              className="btn-secondary py-2 px-4 text-sm"
            >
              + {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {profiles.map((p) => (
          <Card key={p.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-1.5">
                {p.nome}
                {p.is_default && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />}
              </h3>
              <div className="flex gap-1">
                {!p.is_default && (
                  <button
                    type="button"
                    onClick={() => setDefault(p)}
                    title="Definir como padrão"
                    className="p-1.5 rounded hover:bg-white/10 text-son-silver-dim"
                  >
                    <Star className="w-4 h-4" />
                  </button>
                )}
                <button type="button" onClick={() => remove(p)} title="Excluir" className="p-1.5 rounded hover:bg-white/10 text-red-400">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="text-xs text-son-silver-dim space-y-0.5">
              <div>CFOP: {p.cfop ?? '—'}</div>
              <div>CST/CSOSN: {p.cst ?? p.csosn ?? '—'}</div>
              <div>IBS/CBS: {p.cclass_trib ?? '—'}</div>
            </div>
            <button type="button" onClick={() => startEdit(p)} className="text-xs underline text-son-silver-dim">
              Editar
            </button>
          </Card>
        ))}
        {profiles.length === 0 && !editingId && (
          <p className="text-sm text-son-silver-dim">Nenhum perfil fiscal cadastrado ainda.</p>
        )}
      </div>
      {confirmDialogElement}
    </div>
  )
}
