import { useEffect, useState } from 'react'
import { ChefHat, Check, Clock, Copy, Eye, Loader2, MessageCircle, Pencil, Plus, Store, Trash2, Truck, Wallet, X } from 'lucide-react'
import Card from '../../components/ui/Card'
import FreteSettingsCard from '../../components/admin/FreteSettingsCard'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import type {
  CozinhaUser,
  EmployeeConfig,
  ImpressaoModo,
  Motoboy,
  MotoboyPayrollConfig,
  PaymentFrequency,
  PaymentMethod,
  PayrollPayment,
  Vendedor,
  WorkDay,
} from '../../types'

const IMPRESSAO_OPTIONS: { value: ImpressaoModo; label: string }[] = [
  { value: 'nenhuma', label: 'Nao imprimo comanda/pedido' },
  { value: 'agente_local', label: 'Impressora termica (agente local)' },
  { value: 'navegador', label: 'Imprimir pelo navegador' },
  { value: 'ambos', label: 'Agente local e navegador' },
]

const PAYMENT_FREQUENCIES: { value: PaymentFrequency; label: string }[] = [
  { value: 'diaria', label: 'Diária' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'quinzenal', label: 'Quinzenal' },
  { value: 'mensal', label: 'Mensal' },
]

const EMPTY_MOTOBOY_FORM = {
  name: '',
  phone: '',
  password: '',
}
const EMPTY_VENDEDOR_FORM = {
  name: '',
  phone: '',
  password: '',
  commission_percent: '',
  payment_frequency: '' as PaymentFrequency | '',
  payment_fixed_value: '',
}
const EMPTY_COZINHA_FORM = { name: '', phone: '', password: '' }

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

export default function AdminMotoboys() {
  const { askConfirm, confirmDialogElement } = useConfirmDialog()
  const tenantConfig = useTenantConfig()
  const restaurante = tenantConfig?.estilo_operacao === 'restaurante'
  const vendedorLabel = restaurante ? 'Garçom' : 'Vendedor'
  // Preferências de funcionário — moram na PLATAFORMA (subscribers), lidas e
  // gravadas pelo proxy autenticado do backend da loja. Enquanto não chegam,
  // cai no tenant-config público (cache de 5min) pra tela não piscar sem aba.
  const [cfg, setCfg] = useState<EmployeeConfig | null>(null)
  const [cfgSaving, setCfgSaving] = useState(false)
  const [cfgError, setCfgError] = useState<string | null>(null)
  useEffect(() => {
    adminService.employeeConfig
      .get()
      .then(setCfg)
      .catch(() => setCfgError('Não foi possível carregar as preferências de funcionários.'))
  }, [])
  const saveCfg = async (patch: Partial<EmployeeConfig>) => {
    if (!cfg) return
    const previous = cfg
    const next = { ...cfg, ...patch }
    setCfg(next)
    setCfgSaving(true)
    setCfgError(null)
    try {
      setCfg(await adminService.employeeConfig.update(next))
    } catch (e) {
      setCfg(previous)
      setCfgError(e instanceof ApiError ? e.message : 'Não foi possível salvar as preferências.')
    } finally {
      setCfgSaving(false)
    }
  }

  // Só mostra a aba de cadastro de cada papel se a loja marcou precisar dele
  // aqui mesmo (tem_motoboy_proprio / precisa_vendedor / precisa_tela_cozinha)
  // — cadastrar um funcionário que a loja não pediu só confunde.
  const showMotoboys = cfg ? cfg.tem_motoboy_proprio : !!tenantConfig?.tem_motoboy_proprio
  const showVendedores = cfg ? cfg.precisa_vendedor : !!tenantConfig?.precisa_vendedor
  const showCozinha = cfg ? cfg.precisa_tela_cozinha : !!tenantConfig?.precisa_tela_cozinha
  const [tab, setTab] = useState<'motoboys' | 'vendedores' | 'cozinha'>('motoboys')
  useEffect(() => {
    if (tab === 'motoboys' && !showMotoboys) setTab(showVendedores ? 'vendedores' : 'cozinha')
    else if (tab === 'vendedores' && !showVendedores) setTab(showMotoboys ? 'motoboys' : 'cozinha')
    else if (tab === 'cozinha' && !showCozinha) setTab(showMotoboys ? 'motoboys' : 'vendedores')
  }, [tab, showMotoboys, showVendedores, showCozinha])

  // Parte 1 -- config GLOBAL de pagamento de motoboy (comissão XOR fixo),
  // substitui os campos por-motoboy antigos removidos do form acima.
  const [payrollCfg, setPayrollCfg] = useState<MotoboyPayrollConfig | null>(null)
  const [payrollCfgSaving, setPayrollCfgSaving] = useState(false)
  const [payrollCfgError, setPayrollCfgError] = useState<string | null>(null)
  const [payrollCfgDraft, setPayrollCfgDraft] = useState({ frequency: '' as PaymentFrequency | '', value: '' })
  useEffect(() => {
    adminService.motoboyPayrollConfig
      .get()
      .then((cfg) => {
        setPayrollCfg(cfg)
        setPayrollCfgDraft({ frequency: cfg.payment_frequency ?? '', value: cfg.payment_fixed_value != null ? String(cfg.payment_fixed_value) : '' })
      })
      .catch(() => setPayrollCfgError('Não foi possível carregar a config de pagamento de motoboy.'))
  }, [])
  const savePayrollCfg = async (patch: Partial<MotoboyPayrollConfig>) => {
    if (!payrollCfg) return
    const next = { ...payrollCfg, ...patch }
    setPayrollCfgSaving(true)
    setPayrollCfgError(null)
    try {
      const saved = await adminService.motoboyPayrollConfig.update(next)
      setPayrollCfg(saved)
      setPayrollCfgDraft({ frequency: saved.payment_frequency ?? '', value: saved.payment_fixed_value != null ? String(saved.payment_fixed_value) : '' })
    } catch (e) {
      setPayrollCfgError(e instanceof ApiError ? e.message : 'Não foi possível salvar a config de pagamento.')
    } finally {
      setPayrollCfgSaving(false)
    }
  }

  const [workDaysPopup, setWorkDaysPopup] = useState<{ name: string; days: WorkDay[]; loading: boolean } | null>(null)
  const viewWorkDays = async (id: string, name: string) => {
    setWorkDaysPopup({ name, days: [], loading: true })
    try {
      const days = await adminService.motoboys.workDays(id)
      setWorkDaysPopup({ name, days, loading: false })
    } catch {
      setWorkDaysPopup({ name, days: [], loading: false })
    }
  }

  const [motoboys, setMotoboys] = useState<Motoboy[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_MOTOBOY_FORM)
  const [editingMotoboy, setEditingMotoboy] = useState<Motoboy | null>(null)
  const [saving, setSaving] = useState(false)

  // Ver a senha atual (não é um reset) — só o admin acessa essa tela, e
  // funcionário nenhum tem tela própria de "trocar senha": quem define/
  // reseta/mostra a senha de um motoboy ou vendedor é exclusivamente o
  // admin, aqui.
  const [passwordPopup, setPasswordPopup] = useState<{ name: string; password: string | null; loading: boolean } | null>(null)
  const [historyPopup, setHistoryPopup] = useState<{ name: string; entries: PayrollPayment[]; loading: boolean } | null>(null)
  const viewHistory = async (role: 'motoboy' | 'vendedor', id: string, name: string) => {
    setHistoryPopup({ name, entries: [], loading: true })
    try {
      const entries = await adminService.payroll.history(role, id)
      setHistoryPopup({ name, entries, loading: false })
    } catch {
      setHistoryPopup({ name, entries: [], loading: false })
    }
  }
  // Auto-cadastro via convite (link+código por WhatsApp) -- isolado do
  // fluxo de OTP de cliente, nunca reusa aquele mecanismo.
  const [inviteModal, setInviteModal] = useState<{ role: 'motoboy' | 'vendedor' } | null>(null)
  const [inviteName, setInviteName] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteAutoEnviar, setInviteAutoEnviar] = useState(true)
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteResult, setInviteResult] = useState<{ invite_url: string; code: string; whatsapp_message: string; enviado: boolean } | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)

  const openInvite = (role: 'motoboy' | 'vendedor') => {
    setInviteModal({ role })
    setInviteName('')
    setInvitePhone('')
    setInviteAutoEnviar(true)
    setInviteError(null)
    setInviteResult(null)
    setInviteCopied(false)
  }

  const sendInvite = async () => {
    if (!inviteModal) return
    const digits = invitePhone.replace(/\D/g, '')
    if (digits.length < 10) {
      setInviteError('Informe um WhatsApp válido.')
      return
    }
    if (!inviteName.trim()) {
      setInviteError('Informe o nome.')
      return
    }
    setInviteSending(true)
    setInviteError(null)
    try {
      const result = await adminService.employeeInvites.create({
        role: inviteModal.role,
        name: inviteName.trim(),
        target_phone: digits,
        auto_enviar: inviteAutoEnviar,
      })
      setInviteResult(result)
    } catch {
      setInviteError('Não foi possível gerar o convite.')
    } finally {
      setInviteSending(false)
    }
  }

  const copyInviteMessage = () => {
    if (!inviteResult) return
    navigator.clipboard.writeText(inviteResult.whatsapp_message).then(() => {
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
    })
  }

  const viewPassword = async (kind: 'motoboy' | 'vendedor', id: string, name: string) => {
    setPasswordPopup({ name, password: null, loading: true })
    try {
      const password = kind === 'motoboy' ? await adminService.motoboys.getPassword(id) : await adminService.vendedores.getPassword(id)
      setPasswordPopup({ name, password, loading: false })
    } catch {
      setPasswordPopup({ name, password: null, loading: false })
    }
  }

  const [cozinhaUsers, setCozinhaUsers] = useState<CozinhaUser[]>([])
  const [cozinhaLoading, setCozinhaLoading] = useState(true)
  const [showCozinhaForm, setShowCozinhaForm] = useState(false)
  const [cozinhaForm, setCozinhaForm] = useState(EMPTY_COZINHA_FORM)
  const [editingCozinha, setEditingCozinha] = useState<CozinhaUser | null>(null)
  const [savingCozinha, setSavingCozinha] = useState(false)

  const [payingMotoboy, setPayingMotoboy] = useState<Motoboy | null>(null)
  const [pendingAmount, setPendingAmount] = useState<number | null>(null)
  const [pendingLoading, setPendingLoading] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [vendedoresLoading, setVendedoresLoading] = useState(true)
  const [showVendedorForm, setShowVendedorForm] = useState(false)
  const [vendedorForm, setVendedorForm] = useState(EMPTY_VENDEDOR_FORM)
  const [editingVendedor, setEditingVendedor] = useState<Vendedor | null>(null)
  const [savingVendedor, setSavingVendedor] = useState(false)

  const load = () => {
    setLoading(true)
    adminService.motoboys.list().then(setMotoboys).finally(() => setLoading(false))
  }
  const loadVendedores = () => {
    setVendedoresLoading(true)
    adminService.vendedores.list().then(setVendedores).finally(() => setVendedoresLoading(false))
  }
  const loadCozinhaUsers = () => {
    setCozinhaLoading(true)
    adminService.cozinhaUsers.list().then(setCozinhaUsers).finally(() => setCozinhaLoading(false))
  }
  useEffect(() => {
    load()
    loadVendedores()
    loadCozinhaUsers()
  }, [])

  const openEditMotoboy = (m: Motoboy) => {
    setEditingMotoboy(m)
    setForm({
      name: m.name,
      phone: m.phone,
      password: '',
    })
    setShowForm(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        phone: form.phone,
        password: form.password,
      }
      if (editingMotoboy) {
        await adminService.motoboys.update(editingMotoboy.id, { ...payload, active: editingMotoboy.active })
      } else {
        await adminService.motoboys.create(payload)
      }
      setShowForm(false)
      setEditingMotoboy(null)
      setForm(EMPTY_MOTOBOY_FORM)
      load()
    } finally {
      setSaving(false)
    }
  }

  const remove = (id: string) =>
    askConfirm('Remover este motoboy?', async () => {
      await adminService.motoboys.delete(id)
      load()
    })

  const toggleActive = async (m: Motoboy) => {
    await adminService.motoboys.update(m.id, { active: !m.active })
    load()
  }

  const openPay = async (m: Motoboy) => {
    setPayingMotoboy(m)
    setPayError(null)
    setPaymentMethod('pix')
    setPendingAmount(null)
    setPendingLoading(true)
    try {
      const data = await adminService.motoboys.pending(m.id)
      setPendingAmount(data.pending_amount)
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : 'Não foi possível consultar o valor acumulado.')
    } finally {
      setPendingLoading(false)
    }
  }

  const confirmPay = async () => {
    if (!payingMotoboy) return
    setPaying(true)
    setPayError(null)
    try {
      await adminService.motoboys.pay(payingMotoboy.id, paymentMethod)
      setPayingMotoboy(null)
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : 'Não foi possível registrar o pagamento.')
    } finally {
      setPaying(false)
    }
  }

  const openEditVendedor = (v: Vendedor) => {
    setEditingVendedor(v)
    setVendedorForm({
      name: v.name,
      phone: v.phone ?? '',
      password: '',
      commission_percent: v.commission_percent != null ? String(v.commission_percent) : '',
      payment_frequency: v.payment_frequency ?? '',
      payment_fixed_value: v.payment_fixed_value != null ? String(v.payment_fixed_value) : '',
    })
    setShowVendedorForm(true)
  }

  const saveVendedor = async () => {
    setSavingVendedor(true)
    try {
      const payload = {
        name: vendedorForm.name,
        phone: vendedorForm.phone,
        commission_active: true,
        commission_percent: Number(vendedorForm.commission_percent),
        payment_frequency: vendedorForm.payment_frequency || null,
        payment_fixed_value:
          vendedorForm.payment_frequency && vendedorForm.payment_fixed_value ? Number(vendedorForm.payment_fixed_value) : null,
      }
      if (editingVendedor) {
        await adminService.vendedores.update(editingVendedor.id, {
          ...payload,
          active: editingVendedor.active,
          password: vendedorForm.password || undefined,
        })
      } else {
        await adminService.vendedores.create({ ...payload, password: vendedorForm.password })
      }
      setShowVendedorForm(false)
      setEditingVendedor(null)
      setVendedorForm(EMPTY_VENDEDOR_FORM)
      loadVendedores()
    } finally {
      setSavingVendedor(false)
    }
  }

  const removeVendedor = (id: string) =>
    askConfirm('Remover este vendedor?', async () => {
      await adminService.vendedores.delete(id)
      loadVendedores()
    })

  const toggleVendedorActive = async (v: Vendedor) => {
    await adminService.vendedores.update(v.id, {
      name: v.name,
      phone: v.phone ?? '',
      active: !v.active,
      commission_active: v.commission_active,
      commission_percent: v.commission_percent ?? undefined,
      payment_frequency: v.payment_frequency,
      payment_fixed_value: v.payment_fixed_value,
    })
    loadVendedores()
  }

  const openNewCozinha = () => {
    setEditingCozinha(null)
    setCozinhaForm(EMPTY_COZINHA_FORM)
    setShowCozinhaForm(true)
  }
  const openEditCozinha = (c: CozinhaUser) => {
    setEditingCozinha(c)
    setCozinhaForm({ name: c.name, phone: c.phone ?? '', password: '' })
    setShowCozinhaForm(true)
  }

  const saveCozinha = async () => {
    setSavingCozinha(true)
    try {
      if (editingCozinha) {
        await adminService.cozinhaUsers.update(editingCozinha.id, {
          name: cozinhaForm.name,
          phone: cozinhaForm.phone,
          active: editingCozinha.active,
          password: cozinhaForm.password || undefined,
        })
      } else {
        await adminService.cozinhaUsers.create(cozinhaForm)
      }
      setShowCozinhaForm(false)
      setEditingCozinha(null)
      setCozinhaForm(EMPTY_COZINHA_FORM)
      loadCozinhaUsers()
    } finally {
      setSavingCozinha(false)
    }
  }

  const removeCozinha = (id: string) =>
    askConfirm('Remover este usuário de cozinha?', async () => {
      await adminService.cozinhaUsers.delete(id)
      loadCozinhaUsers()
    })

  const toggleCozinhaActive = async (c: CozinhaUser) => {
    await adminService.cozinhaUsers.update(c.id, { name: c.name, phone: c.phone ?? '', active: !c.active })
    loadCozinhaUsers()
  }

  const NEW_LABEL = {
    motoboys: 'Novo motoboy',
    vendedores: `Novo ${vendedorLabel.toLowerCase()}`,
    cozinha: 'Novo usuário de cozinha',
  } as const

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black">Cadastrar funcionários</h1>
        {(showMotoboys || showVendedores || showCozinha) && (
          <div className="flex items-center gap-2">
            {tab === 'motoboys' || tab === 'vendedores' ? (
              <button
                onClick={() => openInvite(tab === 'motoboys' ? 'motoboy' : 'vendedor')}
                className="btn-primary text-sm py-2 px-4"
                title="Manda nome + WhatsApp; a senha quem escolhe é o funcionário"
              >
                <MessageCircle className="w-4 h-4" /> {NEW_LABEL[tab]}
              </button>
            ) : (
              <button onClick={openNewCozinha} className="btn-primary text-sm py-2 px-4">
                <Plus className="w-4 h-4" /> {NEW_LABEL[tab]}
              </button>
            )}
          </div>
        )}
      </div>

      {tenantConfig?.tem_funcionarios && (
        <Card className="p-4 mb-6">
          <h2 className="font-bold mb-1">Preferências de funcionários</h2>
          <p className="text-xs text-son-silver-dim mb-4">
            Define quais funcionários sua loja usa e como eles trabalham. Salva sozinho a cada mudança.
          </p>
          {cfg ? (
            <div className="space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.tem_motoboy_proprio}
                  disabled={cfgSaving}
                  onChange={(e) => saveCfg({ tem_motoboy_proprio: e.target.checked })}
                  className="w-4 h-4 mt-0.5"
                  data-testid="cfg-tem-motoboy-proprio"
                />
                <span className="text-xs text-son-silver-dim">
                  <span className="block text-white font-semibold mb-0.5">Tenho motoboy próprio</span>
                  Pedidos prontos caem na fila do motoboy em vez de você chamar um entregador terceiro.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.precisa_vendedor}
                  disabled={cfgSaving}
                  onChange={(e) => saveCfg({ precisa_vendedor: e.target.checked })}
                  className="w-4 h-4 mt-0.5"
                  data-testid="cfg-precisa-vendedor"
                />
                <span className="text-xs text-son-silver-dim">
                  <span className="block text-white font-semibold mb-0.5">Tenho {vendedorLabel.toLowerCase()}</span>
                  Libera o cadastro e o login separado pra bater venda no PDV.
                </span>
              </label>

              {restaurante && (
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cfg.precisa_tela_cozinha}
                    disabled={cfgSaving}
                    onChange={(e) => saveCfg({ precisa_tela_cozinha: e.target.checked })}
                    className="w-4 h-4 mt-0.5"
                    data-testid="cfg-precisa-tela-cozinha"
                  />
                  <span className="text-xs text-son-silver-dim">
                    <span className="block text-white font-semibold mb-0.5">Tenho cozinha</span>
                    Pedidos passam pela tela de Cozinha, onde a equipe avança o status.
                  </span>
                </label>
              )}

              <label className="block">
                <span className="block text-xs text-white font-semibold mb-1">Impressão de comanda/pedido</span>
                <select
                  value={cfg.impressao_modo}
                  disabled={cfgSaving}
                  onChange={(e) => saveCfg({ impressao_modo: e.target.value as ImpressaoModo })}
                  className="input-field text-sm"
                  data-testid="cfg-impressao-modo"
                >
                  {IMPRESSAO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              {restaurante && (
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cfg.usa_mesas}
                    disabled={cfgSaving}
                    onChange={(e) => saveCfg({ usa_mesas: e.target.checked })}
                    className="w-4 h-4 mt-0.5"
                    data-testid="cfg-usa-mesas"
                  />
                  <span className="text-xs text-son-silver-dim">
                    <span className="block text-white font-semibold mb-0.5">Cadastro mesas com número</span>
                    O pedido passa a ser amarrado à mesa, além do nome do cliente.
                  </span>
                </label>
              )}

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.point_terminal_fixo}
                  disabled={cfgSaving}
                  onChange={(e) => saveCfg({ point_terminal_fixo: e.target.checked })}
                  className="w-4 h-4 mt-0.5"
                  data-testid="cfg-point-terminal-fixo"
                />
                <span className="text-xs text-son-silver-dim">
                  <span className="block text-white font-semibold mb-0.5">Terminal Point fixo por funcionário</span>
                  Cada funcionário cobra sempre na mesma maquininha, em vez de escolher na hora.
                </span>
              </label>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-son-silver-dim">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando preferências...
            </div>
          )}
          {cfgError && <p className="text-xs text-red-400 mt-3">{cfgError}</p>}
        </Card>
      )}

      {(showMotoboys || showVendedores || showCozinha) ? (
        <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: `repeat(${[showMotoboys, showVendedores, showCozinha].filter(Boolean).length}, minmax(0, 1fr))` }}>
          {showMotoboys && (
            <button
              onClick={() => setTab('motoboys')}
              className={`flex flex-col items-center justify-center gap-1.5 py-5 rounded-2xl text-base font-bold transition-colors ${
                tab === 'motoboys' ? 'sunset-bg text-white' : 'bg-son-surface border border-white/5 text-son-silver-dim'
              }`}
            >
              <Truck className="w-6 h-6" /> Motoboys
            </button>
          )}
          {showVendedores && (
            <button
              onClick={() => setTab('vendedores')}
              className={`flex flex-col items-center justify-center gap-1.5 py-5 rounded-2xl text-base font-bold transition-colors ${
                tab === 'vendedores' ? 'sunset-bg text-white' : 'bg-son-surface border border-white/5 text-son-silver-dim'
              }`}
            >
              <Store className="w-6 h-6" /> {restaurante ? 'Garçons' : 'Vendedores'}
            </button>
          )}
          {showCozinha && (
            <button
              onClick={() => setTab('cozinha')}
              className={`flex flex-col items-center justify-center gap-1.5 py-5 rounded-2xl text-base font-bold transition-colors ${
                tab === 'cozinha' ? 'sunset-bg text-white' : 'bg-son-surface border border-white/5 text-son-silver-dim'
              }`}
            >
              <ChefHat className="w-6 h-6" /> Cozinha
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-son-silver-dim mb-6">
          Marque acima, em Preferências de funcionários, quem sua loja tem pra liberar o cadastro aqui.
        </p>
      )}

      {tab === 'motoboys' && showMotoboys && (
        <>
          <Card className="p-4 mb-6">
            <h2 className="font-bold mb-1">Pagamento de motoboy</h2>
            <p className="text-xs text-son-silver-dim mb-4">
              Escolha UM modelo pra toda a loja -- nunca os dois ao mesmo tempo, pra não misturar motoboy em regimes diferentes.
            </p>
            {payrollCfg ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={payrollCfgSaving}
                    onClick={() => savePayrollCfg({ payment_model: 'comissao', payment_frequency: null, payment_fixed_value: null })}
                    className={`py-3 rounded-2xl border text-sm font-medium transition-all ${
                      payrollCfg.payment_model === 'comissao'
                        ? 'sunset-bg text-white border-transparent'
                        : 'bg-son-surface border-white/10 text-son-silver hover:border-son-pink/30'
                    }`}
                  >
                    Comissão (100% do frete)
                  </button>
                  <button
                    type="button"
                    disabled={payrollCfgSaving}
                    onClick={() => {
                      if (payrollCfgDraft.frequency && payrollCfgDraft.value) {
                        savePayrollCfg({
                          payment_model: 'fixo',
                          payment_frequency: payrollCfgDraft.frequency,
                          payment_fixed_value: Number(payrollCfgDraft.value),
                        })
                      } else {
                        setPayrollCfg({ ...payrollCfg, payment_model: 'fixo' })
                      }
                    }}
                    className={`py-3 rounded-2xl border text-sm font-medium transition-all ${
                      payrollCfg.payment_model === 'fixo'
                        ? 'sunset-bg text-white border-transparent'
                        : 'bg-son-surface border-white/10 text-son-silver hover:border-son-pink/30'
                    }`}
                  >
                    Valor fixo periódico
                  </button>
                </div>

                {payrollCfg.payment_model === 'fixo' && (
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="input-field text-sm"
                      value={payrollCfgDraft.frequency}
                      onChange={(e) => setPayrollCfgDraft({ ...payrollCfgDraft, frequency: e.target.value as PaymentFrequency })}
                    >
                      <option value="">Frequência</option>
                      {PAYMENT_FREQUENCIES.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input-field text-sm"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Valor (R$)"
                      value={payrollCfgDraft.value}
                      onChange={(e) => setPayrollCfgDraft({ ...payrollCfgDraft, value: e.target.value })}
                      onBlur={() =>
                        payrollCfgDraft.frequency &&
                        payrollCfgDraft.value &&
                        savePayrollCfg({ payment_model: 'fixo', payment_frequency: payrollCfgDraft.frequency, payment_fixed_value: Number(payrollCfgDraft.value) })
                      }
                    />
                  </div>
                )}

                <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={payrollCfg.usa_maquininha}
                    disabled={payrollCfgSaving}
                    onChange={(e) => savePayrollCfg({ usa_maquininha: e.target.checked })}
                    className="w-4 h-4 mt-0.5"
                  />
                  <span className="text-xs text-son-silver-dim">
                    <span className="block text-white font-semibold mb-0.5">Motoboy usa maquininha</span>
                    Libera cobrança por cartão na entrega (terminal dinâmico/compartilhado, sem vínculo fixo por motoboy). Sem isso, motoboy só recebe em dinheiro, Pix ou entrega já paga.
                  </span>
                </label>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-son-silver-dim">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
              </div>
            )}
            {payrollCfgError && <p className="text-xs text-red-400 mt-3">{payrollCfgError}</p>}
          </Card>

          <FreteSettingsCard />
        </>
      )}

      {tab === 'vendedores' && showVendedores && (
        <Card className="p-4 mb-6">
          <h2 className="font-bold mb-1">Pagamento por cartão</h2>
          <p className="text-xs text-son-silver-dim mb-4">
            Define se {vendedorLabel.toLowerCase()} pode cobrar por cartão na maquininha. Se o terminal é fixo por
            funcionário ou dinâmico/compartilhado é definido uma vez pra loja toda em Preferências de funcionários (Terminal
            Point fixo por funcionário) -- quando dinâmico, qualquer funcionário liberado aqui usa qualquer maquininha
            disponível na hora, sem vínculo fixo.
          </p>
          {payrollCfg ? (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={payrollCfg.vendedor_usa_maquininha}
                disabled={payrollCfgSaving}
                onChange={(e) => savePayrollCfg({ vendedor_usa_maquininha: e.target.checked })}
                className="w-4 h-4 mt-0.5"
              />
              <span className="text-xs text-son-silver-dim">
                <span className="block text-white font-semibold mb-0.5">{vendedorLabel} usa maquininha</span>
                Libera cobrança por cartão pelo {vendedorLabel.toLowerCase()} no PDV.
              </span>
            </label>
          ) : (
            <div className="flex items-center gap-2 text-sm text-son-silver-dim">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
            </div>
          )}
          {payrollCfgError && <p className="text-xs text-red-400 mt-3">{payrollCfgError}</p>}
        </Card>
      )}

      {tab === 'motoboys' && showMotoboys &&
        (loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
          </div>
        ) : motoboys.length === 0 ? (
          <div className="text-center py-16 text-son-silver-dim">
            <Truck className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Nenhum motoboy cadastrado.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {motoboys.map((m) => (
              <Card key={m.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{m.name}</p>
                  <p className="text-xs text-son-silver-dim truncate">{m.phone}</p>
                  {payrollCfg?.payment_model === 'fixo' && payrollCfg.payment_frequency && (
                    <p className="text-xs text-son-silver-dim">
                      {PAYMENT_FREQUENCIES.find((f) => f.value === payrollCfg.payment_frequency)?.label}: {currency(payrollCfg.payment_fixed_value ?? 0)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => viewPassword('motoboy', m.id, m.name)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Ver senha de ${m.name}`}
                    title="Ver senha atual"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => viewWorkDays(m.id, m.name)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Dias trabalhados de ${m.name}`}
                    title="Dias trabalhados"
                  >
                    <Clock className="w-4 h-4" />
                  </button>
                  {/* Histórico/Pagar comissão só fazem sentido no modelo antigo
                     (comissão por entrega) -- no fixo, o pagamento é o ciclo
                     periódico (sino/PayrollBell), não isso aqui. */}
                  {payrollCfg?.payment_model === 'comissao' && (
                    <button
                      onClick={() => viewHistory('motoboy', m.id, m.name)}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                      aria-label={`Histórico de pagamentos de ${m.name}`}
                      title="Histórico de pagamentos"
                    >
                      <Wallet className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => openEditMotoboy(m)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Editar ${m.name}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {payrollCfg?.payment_model === 'comissao' && (
                    <button
                      onClick={() => openPay(m)}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-son-pink/15 text-son-pink hover:bg-son-pink/25 transition-colors"
                      aria-label={`Pagar ${m.name}`}
                    >
                      <Wallet className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => toggleActive(m)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                      m.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/10 text-son-silver-dim'
                    }`}
                  >
                    {m.active ? 'Ativo' : 'Inativo'}
                  </button>
                  <button onClick={() => remove(m.id)} className="text-son-silver-dim hover:text-son-pink">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {tab === 'vendedores' && showVendedores &&
        (vendedoresLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
          </div>
        ) : vendedores.length === 0 ? (
          <div className="text-center py-16 text-son-silver-dim">
            <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Nenhum vendedor cadastrado.</p>
            <p className="text-xs mt-1">Vendedor acessa só a tela de PDV e Financeiro (suas vendas), com login próprio.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {vendedores.map((v) => (
              <Card key={v.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{v.name}</p>
                  <p className="text-xs text-son-silver-dim truncate">{v.phone}</p>
                  {v.commission_active && (
                    <p className="text-xs text-son-gold">Comissão: {v.commission_percent}%</p>
                  )}
                  {v.payment_frequency && (
                    <p className="text-xs text-son-silver-dim">
                      {PAYMENT_FREQUENCIES.find((f) => f.value === v.payment_frequency)?.label}: {currency(v.payment_fixed_value ?? 0)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => viewPassword('vendedor', v.id, v.name)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Ver senha de ${v.name}`}
                    title="Ver senha atual"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => viewHistory('vendedor', v.id, v.name)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Histórico de pagamentos de ${v.name}`}
                    title="Histórico de pagamentos"
                  >
                    <Wallet className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEditVendedor(v)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Editar ${v.name}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => toggleVendedorActive(v)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                      v.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/10 text-son-silver-dim'
                    }`}
                  >
                    {v.active ? 'Ativo' : 'Inativo'}
                  </button>
                  <button onClick={() => removeVendedor(v.id)} className="text-son-silver-dim hover:text-son-pink">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {tab === 'cozinha' && showCozinha &&
        (cozinhaLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
          </div>
        ) : cozinhaUsers.length === 0 ? (
          <div className="text-center py-16 text-son-silver-dim">
            <ChefHat className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Nenhum usuário de cozinha cadastrado.</p>
            <p className="text-xs mt-1">Cozinha acessa só a tela de Pedidos/Cozinha, com login próprio.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {cozinhaUsers.map((c) => (
              <Card key={c.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{c.name}</p>
                  <p className="text-xs text-son-silver-dim truncate">{c.phone}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openEditCozinha(c)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
                    aria-label={`Editar ${c.name}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => toggleCozinhaActive(c)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                      c.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/10 text-son-silver-dim'
                    }`}
                  >
                    {c.active ? 'Ativo' : 'Inativo'}
                  </button>
                  <button onClick={() => removeCozinha(c.id)} className="text-son-silver-dim hover:text-son-pink">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{editingMotoboy ? 'Editar motoboy' : 'Novo motoboy'}</h3>
              <button onClick={() => setShowForm(false)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Nome</label>
                <input className="input-field" autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">WhatsApp (login do motoboy)</label>
                <input
                  className="input-field"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="(83) 99999-9999"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Senha{editingMotoboy && ' (deixe em branco pra manter a atual)'}</label>
                <input
                  className="input-field"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <p className="text-xs text-son-silver-dim">
                O modelo de pagamento (comissão ou valor fixo) agora é configurado uma vez pra toda a loja, no card acima -- não mais por motoboy.
              </p>
              <button onClick={save} disabled={saving} className="btn-primary w-full mt-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {showVendedorForm && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowVendedorForm(false)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{editingVendedor ? 'Editar vendedor' : 'Novo vendedor'}</h3>
              <button onClick={() => setShowVendedorForm(false)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Nome</label>
                <input
                  className="input-field"
                  autoComplete="off"
                  value={vendedorForm.name}
                  onChange={(e) => setVendedorForm({ ...vendedorForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">WhatsApp (login do vendedor)</label>
                <input
                  className="input-field"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="(83) 99999-9999"
                  value={vendedorForm.phone}
                  onChange={(e) => setVendedorForm({ ...vendedorForm, phone: formatPhone(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Senha{editingVendedor && ' (deixe em branco pra manter a atual)'}</label>
                <input
                  className="input-field"
                  type="password"
                  autoComplete="new-password"
                  value={vendedorForm.password}
                  onChange={(e) => setVendedorForm({ ...vendedorForm, password: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Comissão por venda (%) — obrigatório, mínimo 1%</label>
                <input
                  className="input-field"
                  type="number"
                  min="1"
                  max="100"
                  step="0.1"
                  value={vendedorForm.commission_percent}
                  onChange={(e) => setVendedorForm({ ...vendedorForm, commission_percent: e.target.value })}
                />
                <p className="text-xs text-son-silver-dim mt-1">Aplicado sobre o valor de cada venda feita por ele no PDV.</p>
              </div>
              <div>
                <label className="label">Recebe diária/semanal/quinzenal/mensal?</label>
                <select
                  className="input-field"
                  value={vendedorForm.payment_frequency}
                  onChange={(e) => setVendedorForm({ ...vendedorForm, payment_frequency: e.target.value as PaymentFrequency | '' })}
                >
                  <option value="">Não recebe valor fixo (só a comissão)</option>
                  {PAYMENT_FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              {vendedorForm.payment_frequency && (
                <div>
                  <label className="label">
                    Valor fixo por {PAYMENT_FREQUENCIES.find((f) => f.value === vendedorForm.payment_frequency)?.label.toLowerCase()} (R$)
                  </label>
                  <input
                    className="input-field"
                    type="number"
                    min="0"
                    step="0.01"
                    value={vendedorForm.payment_fixed_value}
                    onChange={(e) => setVendedorForm({ ...vendedorForm, payment_fixed_value: e.target.value })}
                  />
                  <p className="text-xs text-son-silver-dim mt-1">Além disso, a comissão de cada venda some no financeiro dele junto com o fixo.</p>
                </div>
              )}
              <p className="text-xs text-son-silver-dim">
                O vendedor loga em /funcionarios/login (login próprio, separado do admin) e cai no próprio painel em
                /funcionarios/vendedor, com Pedidos, PDV e Financeiro (suas vendas).
              </p>
              <button
                onClick={saveVendedor}
                disabled={savingVendedor || !vendedorForm.commission_percent || Number(vendedorForm.commission_percent) < 1}
                className="btn-primary w-full mt-2"
              >
                {savingVendedor ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {showCozinhaForm && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowCozinhaForm(false)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{editingCozinha ? 'Editar usuário de cozinha' : 'Novo usuário de cozinha'}</h3>
              <button onClick={() => setShowCozinhaForm(false)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Nome</label>
                <input
                  className="input-field"
                  autoComplete="off"
                  value={cozinhaForm.name}
                  onChange={(e) => setCozinhaForm({ ...cozinhaForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">WhatsApp (login da cozinha)</label>
                <input
                  className="input-field"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="(83) 99999-9999"
                  value={cozinhaForm.phone}
                  onChange={(e) => setCozinhaForm({ ...cozinhaForm, phone: formatPhone(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Senha{editingCozinha && ' (deixe em branco pra manter a atual)'}</label>
                <input
                  className="input-field"
                  type="password"
                  autoComplete="new-password"
                  value={cozinhaForm.password}
                  onChange={(e) => setCozinhaForm({ ...cozinhaForm, password: e.target.value })}
                />
              </div>
              <p className="text-xs text-son-silver-dim">
                Loga em /funcionarios/login (login próprio, separado do admin) e cai direto na tela de Cozinha.
              </p>
              <button onClick={saveCozinha} disabled={savingCozinha} className="btn-primary w-full mt-2">
                {savingCozinha ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {payingMotoboy && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setPayingMotoboy(null)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Pagar {payingMotoboy.name}</h3>
              <button onClick={() => setPayingMotoboy(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {pendingLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center py-3">
                  <p className="text-xs text-son-silver-dim mb-1">Valor acumulado (frete, 100% do motoboy)</p>
                  <p className="sunset-text font-black text-3xl">{currency(pendingAmount ?? 0)}</p>
                </div>

                {payError && <p className="error-msg">{payError}</p>}

                {(pendingAmount ?? 0) > 0 ? (
                  <>
                    <div>
                      <label className="label">Forma de pagamento</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['pix', 'dinheiro'] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setPaymentMethod(value)}
                            className={`py-3 rounded-2xl border text-sm font-medium transition-all capitalize ${
                              paymentMethod === value
                                ? 'sunset-bg text-white border-transparent'
                                : 'bg-son-surface border-white/10 text-son-silver hover:border-son-pink/30'
                            }`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button onClick={confirmPay} disabled={paying} className="btn-primary w-full">
                      {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Confirmar pagamento
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-son-silver-dim text-center">Nada pendente pra pagar agora.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {inviteModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setInviteModal(null)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">
                Convidar {inviteModal.role === 'motoboy' ? 'motoboy' : 'vendedor'}
              </h3>
              <button onClick={() => setInviteModal(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!inviteResult ? (
              <>
                <p className="text-xs text-son-silver-dim mb-4">
                  O funcionário recebe um link + código pra completar o próprio cadastro -- ele escolhe a própria senha.
                </p>
                <label className="label">Nome</label>
                <input
                  className="input-field mb-4"
                  autoComplete="off"
                  placeholder="Nome do funcionário"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  autoFocus
                />
                <label className="label">WhatsApp do funcionário</label>
                <input
                  className="input-field mb-4"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="(83) 99999-9999"
                  value={invitePhone}
                  onChange={(e) => setInvitePhone(e.target.value)}
                />
                <label className="flex items-center gap-2 mb-4 text-sm text-son-silver cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inviteAutoEnviar}
                    onChange={(e) => setInviteAutoEnviar(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Enviar automaticamente por WhatsApp
                </label>
                {inviteError && <p className="error-msg mb-3">{inviteError}</p>}
                <button onClick={sendInvite} disabled={inviteSending} className="btn-primary w-full">
                  {inviteSending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Gerar convite
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-son-silver-dim mb-3">
                  {inviteResult.enviado
                    ? 'Mensagem enviada pelo WhatsApp da loja. Você também pode copiar e mandar manualmente:'
                    : 'Copie a mensagem abaixo e mande pelo WhatsApp:'}
                </p>
                <div className="bg-son-surface-light rounded-xl p-3 text-sm text-white whitespace-pre-wrap mb-3">
                  {inviteResult.whatsapp_message}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs text-son-silver-dim">Código:</p>
                  <p className="font-mono text-lg tracking-wide text-son-gold">{inviteResult.code}</p>
                </div>
                <button onClick={copyInviteMessage} className="btn-secondary w-full mb-2">
                  {inviteCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {inviteCopied ? 'Copiado!' : 'Copiar mensagem'}
                </button>
                <button onClick={() => setInviteModal(null)} className="btn-primary w-full">
                  Fechar
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {passwordPopup && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPasswordPopup(null)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Senha de {passwordPopup.name}</h3>
              <button onClick={() => setPasswordPopup(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {passwordPopup.loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
              </div>
            ) : passwordPopup.password ? (
              <p className="text-center font-mono text-lg tracking-wide bg-son-surface-light rounded-xl py-3">
                {passwordPopup.password}
              </p>
            ) : (
              <p className="text-sm text-son-silver-dim text-center">
                Nenhuma senha salva pra visualizar ainda — edite e defina uma senha nova pra poder vê-la depois.
              </p>
            )}
          </div>
        </div>
      )}
      {historyPopup && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setHistoryPopup(null)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Histórico de {historyPopup.name}</h3>
              <button onClick={() => setHistoryPopup(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {historyPopup.loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
              </div>
            ) : historyPopup.entries.length === 0 ? (
              <p className="text-sm text-son-silver-dim text-center">Nenhum pagamento fixo registrado ainda.</p>
            ) : (
              <div className="space-y-2">
                {historyPopup.entries.map((e) => (
                  <div key={e.id} className="bg-son-surface-light rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-son-gold font-semibold text-sm">{currency(e.amount)}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          e.confirmed_by_employee ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
                        }`}
                      >
                        {e.confirmed_by_employee ? 'Confirmado' : 'Aguardando confirmação'}
                      </span>
                    </div>
                    <p className="text-xs text-son-silver-dim mt-1">
                      {new Date(e.created_at).toLocaleString('pt-BR')} · {e.payment_method}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {workDaysPopup && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setWorkDaysPopup(null)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Dias trabalhados — {workDaysPopup.name}</h3>
              <button onClick={() => setWorkDaysPopup(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {workDaysPopup.loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
              </div>
            ) : workDaysPopup.days.length === 0 ? (
              <p className="text-sm text-son-silver-dim text-center">Nenhum dia registrado ainda.</p>
            ) : (
              <>
                <p className="text-xs text-son-silver-dim mb-3">
                  {workDaysPopup.days.length} dia{workDaysPopup.days.length > 1 ? 's' : ''} nos últimos ~2 meses.
                </p>
                <ul className="divide-y divide-white/5">
                  {workDaysPopup.days.map((d) => (
                    <li key={d.work_date} className="py-2 text-sm text-son-silver">
                      {new Date(`${d.work_date}T00:00:00`).toLocaleDateString('pt-BR')}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
      {confirmDialogElement}
    </div>
  )
}
