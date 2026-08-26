import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  Battery,
  Camera,
  Check,
  CheckCircle,
  ChevronLeft,
  HelpCircle,
  Loader2,
  Laptop,
  MapPin,
  MessageCircle,
  Monitor,
  Smartphone,
  Tablet,
  Truck,
  User,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { resolveTenantSlug, withTenantSearch } from '../../lib/tenantConfig'
import {
  createServiceRequestPublic,
  fetchCatalog,
  uploadPublicMedia,
  type CatalogCategory,
  type CatalogItem,
} from '../../lib/eletronicosApi'
import LocationPicker, { type LocationPickerResult } from '../../components/checkout/LocationPicker'

// Port 1:1 de src/components/ServiceRequestForm.tsx do vrtech -- mesmo
// wizard de 3 passos, mesmas cores (vr-red/vr-black/vr-graphite/vr-silver,
// ver globals.css do projeto original), mesmo texto, mesmas props. Única
// troca real é a fonte de dados: Supabase direto -> endpoints do motor Rust
// (/api/public/eletronicos/{slug}/...).

type DeviceType = 'celular' | 'tablet' | 'notebook' | 'computador'

const DEVICE_TYPES: { key: DeviceType; label: string; icon: React.ReactNode }[] = [
  { key: 'celular', label: 'Celular', icon: <Smartphone className="w-6 h-6" /> },
  { key: 'tablet', label: 'Tablet', icon: <Tablet className="w-6 h-6" /> },
  { key: 'notebook', label: 'Notebook', icon: <Laptop className="w-6 h-6" /> },
  { key: 'computador', label: 'Computador', icon: <Monitor className="w-6 h-6" /> },
]

const INPUT =
  'w-full px-4 py-3 rounded-xl border border-white/10 bg-[#0a0a0b] text-white placeholder-white/25 focus:border-[#e0211a]/60 focus:ring-1 focus:ring-[#e0211a]/10 outline-none transition-all duration-200'
const LABEL = 'block text-sm font-semibold text-[#d4d4d8]/80 mb-1.5'
const ERR = 'text-red-400 text-xs mt-1'

const REPAIR_ICONS: Record<string, React.ReactNode> = {
  'Troca de tela': <Smartphone className="w-4 h-4" />,
  'Troca de bateria': <Battery className="w-4 h-4" />,
  'Reparo de carregador': <Zap className="w-4 h-4" />,
  'Reparo de conector de carregador': <Zap className="w-4 h-4" />,
  'Troca de câmera traseira': <Camera className="w-4 h-4" />,
}
const repairIcon = (rt: string) => REPAIR_ICONS[rt] ?? <Wrench className="w-4 h-4" />

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

export default function EletronicaServiceRequestForm({
  apenasRetirada: apenasRetiradaProp = false,
  diagnosisOnly = false,
  initialSelection = null,
}: {
  apenasRetirada?: boolean
  coletaGratis?: boolean
  diagnosisOnly?: boolean
  /** Vem da vitrine de catálogo (EletronicaCatalogoServico) quando o
   * cliente clica "Adicionar" num serviço já visível ali -- pula o wizard
   * de tipo/marca/modelo/serviço direto pra etapa de descrição já com o
   * serviço escolhido. */
  initialSelection?: {
    deviceType: DeviceType
    brandId: string
    modelName: string
    serviceId: string
  } | null
}) {
  const tenantConfig = useTenantConfig()
  const slug = resolveTenantSlug()
  const apenasRetirada = tenantConfig?.apenas_retirada ?? apenasRetiradaProp

  const [step, setStep] = useState(1)
  const [submitted, setSubmitted] = useState(false)
  const [submittedPhone, setSubmittedPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [problemDescription, setProblemDescription] = useState('')

  const [selfPickup, setSelfPickup] = useState(apenasRetirada)
  const [showMap, setShowMap] = useState(false)
  const [location, setLocation] = useState<LocationPickerResult | null>(null)
  const [gettingLocation, setGettingLocation] = useState(false)

  const [brands, setBrands] = useState<CatalogCategory[]>([])
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [selectedDeviceType, setSelectedDeviceType] = useState<DeviceType | null>(null)
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null)
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [phoneModel, setPhoneModel] = useState<string | undefined>()
  const [diagnosisMode, setDiagnosisMode] = useState(diagnosisOnly)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (apenasRetirada) setSelfPickup(true)
  }, [apenasRetirada])

  useEffect(() => {
    if (diagnosisOnly) setDiagnosisMode(true)
  }, [diagnosisOnly])

  useEffect(() => {
    if (!slug || brands.length > 0) return
    if (step !== 2 && !initialSelection) return
    setLoadingCatalog(true)
    fetchCatalog(slug)
      .then((res) => {
        setBrands(res.categories)
        setCatalogItems(res.items)
      })
      .catch(() => {})
      .finally(() => setLoadingCatalog(false))
  }, [step, slug, brands.length, initialSelection])

  useEffect(() => {
    if (!initialSelection || catalogItems.length === 0) return
    setSelectedDeviceType(initialSelection.deviceType)
    setSelectedBrandId(initialSelection.brandId)
    setSelectedModelName(initialSelection.modelName)
    setSelectedServiceIds([initialSelection.serviceId])
    setPhoneModel(initialSelection.modelName)
    setDiagnosisMode(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogItems.length])

  const brandsForType = useMemo(
    () => brands.filter((b) => b.device_type === selectedDeviceType),
    [brands, selectedDeviceType],
  )

  const modelList = useMemo(() => {
    if (!selectedBrandId) return []
    const seen = new Set<string>()
    return catalogItems
      .filter((i) => i.category_id === selectedBrandId && i.model_name)
      .reduce<string[]>((acc, i) => {
        if (!seen.has(i.model_name!)) {
          seen.add(i.model_name!)
          acc.push(i.model_name!)
        }
        return acc
      }, [])
      .sort()
  }, [catalogItems, selectedBrandId])

  const servicesForModel = useMemo(() => {
    if (!selectedBrandId || !selectedModelName) return []
    return catalogItems.filter(
      (i) => i.category_id === selectedBrandId && (i.model_name === selectedModelName || i.model_name === null),
    )
  }, [catalogItems, selectedBrandId, selectedModelName])

  const estimatedTotal = useMemo(
    () =>
      selectedServiceIds.reduce((sum, id) => {
        const item = catalogItems.find((i) => i.id === id)
        return sum + Number(item?.price ?? 0)
      }, 0),
    [selectedServiceIds, catalogItems],
  )

  const toggleService = (item: CatalogItem) => {
    const isSelected = selectedServiceIds.includes(item.id)
    const newIds = isSelected ? selectedServiceIds.filter((x) => x !== item.id) : [...selectedServiceIds, item.id]
    setSelectedServiceIds(newIds)
    if (newIds.length > 0) {
      const lastId = newIds[newIds.length - 1]
      const lastItem = catalogItems.find((i) => i.id === lastId)
      setPhoneModel(lastItem?.model_name ?? selectedModelName ?? undefined)
    } else {
      setPhoneModel(undefined)
    }
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Imagem deve ter no máximo 5MB')
      return
    }
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    setError(null)
  }

  const handleLocationConfirm = useCallback((result: LocationPickerResult) => {
    setLocation(result)
    setShowMap(false)
  }, [])

  const handleOpenMap = useCallback(() => {
    setGettingLocation(true)
    if (!navigator.geolocation) {
      setGettingLocation(false)
      setShowMap(true)
      return
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        setGettingLocation(false)
        setShowMap(true)
      },
      () => {
        setGettingLocation(false)
        setShowMap(true)
      },
      { timeout: 8000, maximumAge: 0 },
    )
  }, [])

  function validateStep1(): boolean {
    const errs: Record<string, string> = {}
    if (!customerName.trim()) errs.customer_name = 'Informe seu nome'
    const digits = customerPhone.replace(/\D/g, '')
    if (digits.length < 10) errs.customer_phone = 'Telefone inválido'
    if (customerEmail.trim() && !/^\S+@\S+\.\S+$/.test(customerEmail)) errs.customer_email = 'E-mail inválido'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  function validateStep2(): boolean {
    const errs: Record<string, string> = {}
    if (!diagnosisMode && !phoneModel) errs.phone_model = 'Selecione o modelo e um serviço'
    if (!problemDescription.trim()) errs.problem_description = 'Descreva o problema'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  function nextStep() {
    const valid = step === 1 ? validateStep1() : step === 2 ? validateStep2() : true
    if (valid) setStep((s) => s + 1)
  }

  async function onSubmit() {
    if (!slug) return
    if (!apenasRetirada && !selfPickup && !location) {
      setFieldErrors({ address_lat: 'Selecione o endereço no mapa' })
      return
    }
    setLoading(true)
    setError(null)
    try {
      let image_url: string | undefined
      if (imageFile) {
        image_url = await uploadPublicMedia(slug, imageFile)
      }

      const created = await createServiceRequestPublic(slug, {
        customer_name: customerName.trim(),
        customer_phone: customerPhone.replace(/\D/g, ''),
        customer_email: customerEmail.trim() || undefined,
        phone_model: phoneModel ?? undefined,
        problem_description: problemDescription.trim(),
        diagnosis_requested: diagnosisMode,
        estimated_quote_value: selectedServiceIds.length > 0 ? estimatedTotal : undefined,
        self_pickup: apenasRetirada || selfPickup,
        address_street: apenasRetirada || selfPickup ? undefined : location?.label,
        address_neighborhood: apenasRetirada || selfPickup ? undefined : location?.bairro,
        address_lat: apenasRetirada || selfPickup ? undefined : location?.lat,
        address_lng: apenasRetirada || selfPickup ? undefined : location?.lng,
        image_url,
      })

      setSubmittedPhone(created.customer_phone)
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'não foi possível enviar sua solicitação, tente de novo')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    const phoneDigits = submittedPhone.replace(/\D/g, '')
    return (
      <div className="flex flex-col items-center justify-center text-center px-4 py-10 gap-4">
        <div className="w-20 h-20 rounded-full bg-[#e0211a]/15 flex items-center justify-center">
          <CheckCircle className="w-10 h-10 text-[#e0211a]" />
        </div>
        <h2 className="text-2xl font-bold text-white">Solicitação enviada!</h2>
        <p className="text-[#d4d4d8]/60 max-w-sm text-sm">
          Recebemos seu pedido. Em breve entraremos em contato pelo WhatsApp com o orçamento.
        </p>
        <Link
          to={`/consultar${withTenantSearch()}${phoneDigits ? `&phone=${phoneDigits}` : ''}`}
          className="w-full flex items-center justify-center gap-2 bg-[#e0211a]/15 border border-[#e0211a]/30 text-[#e0211a] font-semibold py-3 px-6 rounded-xl hover:bg-[#e0211a]/25 transition-all text-sm"
        >
          Acompanhar minha solicitação
        </Link>
        <button
          type="button"
          onClick={() => {
            setSubmitted(false)
            setStep(1)
            setImageFile(null)
            setImagePreview(null)
            setLocation(null)
            setSubmittedPhone('')
            setSelectedServiceIds([])
            setSelectedDeviceType(null)
            setSelectedBrandId(null)
            setSelectedModelName(null)
            setDiagnosisMode(diagnosisOnly)
            setCustomerName('')
            setCustomerPhone('')
            setCustomerEmail('')
            setProblemDescription('')
          }}
          className="text-sm text-[#d4d4d8]/40 hover:text-[#d4d4d8]/70 transition-colors"
        >
          Fazer nova solicitação
        </button>
      </div>
    )
  }

  return (
    <>
      {showMap && <LocationPicker onClose={() => setShowMap(false)} onConfirm={handleLocationConfirm} />}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (step < 3) nextStep()
          else onSubmit()
        }}
        className="flex flex-col gap-6"
      >
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  step >= s ? 'bg-[#e0211a] text-white' : 'bg-white/10 text-white/40'
                }`}
              >
                {step > s ? '✓' : s}
              </div>
              {s < 3 && <div className={`flex-1 h-0.5 rounded-full transition-all ${step > s ? 'bg-[#e0211a]' : 'bg-white/10'}`} />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-5 h-5 text-[#e0211a]" />
              <h3 className="font-semibold text-white">Seus dados</h3>
            </div>
            <div>
              <label className={LABEL}>Nome completo</label>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="João da Silva" className={INPUT} />
              {fieldErrors.customer_name && <p className={ERR}>{fieldErrors.customer_name}</p>}
            </div>
            <div>
              <label className={LABEL}>WhatsApp / Telefone</label>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(formatPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                inputMode="tel"
                className={INPUT}
              />
              {fieldErrors.customer_phone && <p className={ERR}>{fieldErrors.customer_phone}</p>}
            </div>
            <div>
              <label className={LABEL}>E-mail</label>
              <input
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="joao@email.com"
                inputMode="email"
                className={INPUT}
              />
              {fieldErrors.customer_email && <p className={ERR}>{fieldErrors.customer_email}</p>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone className="w-5 h-5 text-[#e0211a]" />
              <h3 className="font-semibold text-white">Sobre o aparelho</h3>
            </div>

            {!diagnosisOnly && (
              <label className="flex items-start gap-3 bg-[#0a0a0b] border border-white/10 rounded-xl p-3.5 cursor-pointer hover:border-[#e0211a]/30 transition-colors">
                <input
                  type="checkbox"
                  checked={diagnosisMode}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setDiagnosisMode(checked)
                    if (checked) {
                      setSelectedDeviceType(null)
                      setSelectedBrandId(null)
                      setSelectedModelName(null)
                      setSelectedServiceIds([])
                      setPhoneModel(undefined)
                    }
                  }}
                  className="w-4 h-4 mt-0.5 accent-[#e0211a] flex-none"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-[#e0211a] flex-none" />
                    <span className="text-sm font-semibold text-white">Não sei o modelo do meu aparelho</span>
                  </div>
                  <p className="text-xs text-[#d4d4d8]/50 mt-0.5">Orçamento após diagnóstico físico do aparelho</p>
                </div>
              </label>
            )}

            {!diagnosisMode && (
              <>
                {loadingCatalog ? (
                  <div className="flex items-center gap-2 text-[#d4d4d8]/50 text-sm py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#e0211a]" />
                    Carregando catálogo...
                  </div>
                ) : brands.length > 0 ? (
                  <>
                    {!selectedDeviceType && (
                      <div>
                        <p className="text-xs font-semibold text-[#d4d4d8]/60 mb-2">Que tipo de aparelho é?</p>
                        <div className="grid grid-cols-4 gap-2">
                          {DEVICE_TYPES.map((d) => (
                            <button
                              key={d.key}
                              type="button"
                              onClick={() => setSelectedDeviceType(d.key)}
                              className="flex flex-col items-center gap-1.5 py-4 rounded-xl bg-[#161618] border border-white/5 text-[#d4d4d8] hover:border-[#e0211a]/40 hover:text-white transition-all"
                            >
                              {d.icon}
                              <span className="text-[11px] font-semibold">{d.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedDeviceType && !selectedBrandId && (
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDeviceType(null)
                            setSelectedBrandId(null)
                            setSelectedModelName(null)
                            setSelectedServiceIds([])
                            setPhoneModel(undefined)
                          }}
                          className="flex items-center gap-1 text-xs text-[#d4d4d8]/50 hover:text-white mb-2"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" /> Trocar tipo de aparelho
                        </button>
                        {brandsForType.length === 0 ? (
                          <p className="text-center text-[#d4d4d8]/40 text-sm py-4">
                            Ainda não temos marcas cadastradas pra esse tipo de aparelho.
                          </p>
                        ) : (
                          <>
                            <p className="text-xs font-semibold text-[#d4d4d8]/60 mb-2">Qual a marca?</p>
                            <div className="grid grid-cols-3 gap-2">
                              {brandsForType.map((b) => (
                                <button
                                  key={b.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedBrandId(b.id)
                                    setSelectedModelName(null)
                                    setSelectedServiceIds([])
                                    setPhoneModel(undefined)
                                  }}
                                  className="flex flex-col items-center gap-1.5 py-4 rounded-xl bg-[#161618] border border-white/5 text-[#d4d4d8] hover:border-[#e0211a]/40 hover:text-white transition-all"
                                >
                                  <Smartphone className="w-5 h-5" />
                                  <span className="text-[11px] font-semibold">{b.name}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {selectedBrandId && !selectedModelName && (
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBrandId(null)
                            setSelectedModelName(null)
                            setSelectedServiceIds([])
                            setPhoneModel(undefined)
                          }}
                          className="flex items-center gap-1 text-xs text-[#d4d4d8]/50 hover:text-white mb-2"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" /> Trocar marca
                        </button>
                        {modelList.length === 0 ? (
                          <p className="text-center text-[#d4d4d8]/40 text-sm py-4">Nenhum modelo cadastrado pra essa marca ainda.</p>
                        ) : (
                          <>
                            <p className="text-xs font-semibold text-[#d4d4d8]/60 mb-2">Qual o modelo?</p>
                            <div className="flex flex-wrap gap-2">
                              {modelList.map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => {
                                    setSelectedModelName(m)
                                    setPhoneModel(m)
                                  }}
                                  className="px-3.5 py-2 rounded-xl text-sm font-semibold bg-[#161618] border border-white/5 text-[#d4d4d8] hover:border-[#e0211a]/40 hover:text-white transition-all"
                                >
                                  {m}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {selectedBrandId && selectedModelName && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedModelName(null)
                            setSelectedServiceIds([])
                            setPhoneModel(undefined)
                          }}
                          className="flex items-center gap-1 text-xs text-[#d4d4d8]/50 hover:text-white"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" /> Trocar modelo
                        </button>

                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded-xl bg-[#161618] border border-white/10 shrink-0 flex items-center justify-center">
                            <Smartphone className="w-5 h-5 text-[#d4d4d8]/30" />
                          </div>
                          <div>
                            <h4 className="text-white font-bold text-sm">{selectedModelName}</h4>
                            <p className="text-[#d4d4d8]/40 text-xs">
                              {servicesForModel.length} serviço{servicesForModel.length !== 1 ? 's' : ''} sugerido
                              {servicesForModel.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>

                        {servicesForModel.length === 0 ? (
                          <p className="text-center text-[#d4d4d8]/40 text-sm py-4">Nenhum serviço cadastrado pra esse modelo ainda.</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-2.5">
                            {servicesForModel.map((item) => {
                              const sel = selectedServiceIds.includes(item.id)
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => toggleService(item)}
                                  className={`bg-[#161618] border rounded-2xl p-3.5 text-left transition-all ${
                                    sel ? 'border-[#e0211a]' : 'border-white/5 hover:border-[#e0211a]/30'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="text-[#e0211a] shrink-0">{repairIcon(item.repair_type)}</span>
                                      <span className="text-xs font-bold text-white leading-tight line-clamp-2">{item.repair_type}</span>
                                    </div>
                                  </div>
                                  {item.description && (
                                    <p className="text-[10px] text-[#d4d4d8]/55 leading-snug mb-2 line-clamp-2">{item.description}</p>
                                  )}
                                  <div className="flex items-center justify-between mt-auto">
                                    <span className="text-[#e0211a] font-black text-sm whitespace-nowrap">
                                      R$ {Number(item.price).toFixed(2).replace('.', ',')}
                                    </span>
                                  </div>
                                  <div
                                    className={`w-full flex items-center justify-center gap-1 py-2 rounded-xl text-[11px] font-semibold mt-2 transition-all ${
                                      sel
                                        ? 'bg-[#e0211a] text-white'
                                        : 'bg-[#0a0a0b] border border-white/10 text-[#d4d4d8] hover:border-[#e0211a]/40 hover:text-white'
                                    }`}
                                  >
                                    {sel ? (
                                      <>
                                        <Check className="w-3.5 h-3.5" /> Selecionado
                                      </>
                                    ) : (
                                      'Selecionar'
                                    )}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}

                        {selectedServiceIds.length > 0 && (
                          <div className="p-3 bg-[#e0211a]/10 rounded-xl border border-[#e0211a]/20 flex justify-between items-center">
                            <div>
                              <div className="text-xs text-[#d4d4d8]/60">
                                {selectedServiceIds.length} serviço{selectedServiceIds.length !== 1 ? 's' : ''} — total estimado
                              </div>
                              <div className="text-[#e0211a] font-bold">R$ {estimatedTotal.toFixed(2).replace('.', ',')}</div>
                            </div>
                            <p className="text-[10px] text-[#d4d4d8]/40 text-right max-w-[140px] leading-tight">
                              *pode variar após diagnóstico
                            </p>
                          </div>
                        )}

                        {fieldErrors.phone_model && <p className={ERR}>{fieldErrors.phone_model}</p>}
                      </>
                    )}
                  </>
                ) : null}
              </>
            )}

            <div>
              <label className={LABEL}>
                <span className="flex items-center gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5 text-[#e0211a]" />
                  Descreva o problema
                </span>
              </label>
              <textarea
                value={problemDescription}
                onChange={(e) => setProblemDescription(e.target.value)}
                placeholder="Ex: Tela rachada, não liga, bateria viciada, conector de carga com defeito..."
                rows={4}
                className={`${INPUT} resize-none`}
              />
              {fieldErrors.problem_description && <p className={ERR}>{fieldErrors.problem_description}</p>}
            </div>

            <div>
              <label className={LABEL}>
                Foto do celular <span className="font-normal text-white/30">(opcional)</span>
              </label>
              {imagePreview ? (
                <div className="relative w-fit mx-auto">
                  <img src={imagePreview} alt="Preview" className="w-36 h-36 object-cover rounded-2xl border border-white/10" />
                  <button
                    type="button"
                    onClick={() => {
                      setImageFile(null)
                      setImagePreview(null)
                    }}
                    className="absolute -top-2 -right-2 bg-[#e0211a] text-white rounded-full w-6 h-6 flex items-center justify-center shadow"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 border-2 border-dashed border-white/10 rounded-xl p-4 hover:border-[#e0211a]/40 hover:bg-[#e0211a]/5 transition-all bg-[#0a0a0b]"
                  >
                    <span className="text-2xl">📷</span>
                    <span className="text-xs font-medium text-white/70">Tirar foto</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 border-2 border-dashed border-white/10 rounded-xl p-4 hover:border-[#e0211a]/40 hover:bg-[#e0211a]/5 transition-all bg-[#0a0a0b]"
                  >
                    <span className="text-2xl">🖼️</span>
                    <span className="text-xs font-medium text-white/70">Galeria</span>
                  </button>
                </div>
              )}
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageChange} />
              <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="w-5 h-5 text-[#e0211a]" />
              <h3 className="font-semibold text-white">Coleta e entrega</h3>
            </div>

            {apenasRetirada ? (
              <div className="flex items-start gap-3 bg-[#0a0a0b] border border-white/10 rounded-xl p-4">
                <MapPin className="w-4 h-4 text-[#e0211a] flex-none mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">Loja não faz entrega — é necessário retirar o aparelho no local</p>
                  <p className="text-xs text-[#d4d4d8]/60 mt-1">Em caso de serviço: leve o aparelho na loja e retire depois de pronto.</p>
                  {tenantConfig?.endereco && <p className="text-xs text-[#d4d4d8]/60 mt-1">{tenantConfig.endereco}</p>}
                </div>
              </div>
            ) : (
              <label className="flex items-start gap-2.5 bg-[#0a0a0b] border border-white/10 rounded-xl p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selfPickup}
                  onChange={(e) => setSelfPickup(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-[#e0211a]"
                />
                <span className="text-sm text-[#d4d4d8]/80">Vou levar/buscar o aparelho eu mesmo (não preciso de coleta/entrega)</span>
              </label>
            )}

            {!apenasRetirada && !selfPickup && (
              <div className="flex flex-col gap-3">
                {location ? (
                  <div className="flex items-start gap-3 bg-[#161618] border border-white/10 rounded-xl p-3.5">
                    <MapPin className="w-4 h-4 text-[#e0211a] flex-none mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium">{location.label}</p>
                      {location.bairro && <p className="text-xs text-[#d4d4d8]/60">{location.bairro}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenMap}
                      disabled={gettingLocation}
                      className="text-xs text-[#e0211a]/70 hover:text-[#e0211a] transition-colors flex-none flex items-center gap-1 disabled:opacity-50"
                    >
                      {gettingLocation && <Loader2 className="w-3 h-3 animate-spin" />}
                      Alterar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleOpenMap}
                    disabled={gettingLocation}
                    className="flex items-center gap-3 border-2 border-dashed border-white/15 rounded-xl p-4 hover:border-[#e0211a]/40 hover:bg-[#e0211a]/5 transition-all text-left disabled:opacity-60"
                  >
                    <div className="w-10 h-10 rounded-full bg-[#e0211a]/10 flex items-center justify-center flex-none">
                      {gettingLocation ? (
                        <Loader2 className="w-5 h-5 text-[#e0211a] animate-spin" />
                      ) : (
                        <MapPin className="w-5 h-5 text-[#e0211a]" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">
                        {gettingLocation ? 'Obtendo sua localização...' : 'Selecionar endereço no mapa'}
                      </div>
                      <div className="text-xs text-[#d4d4d8]/50">{gettingLocation ? 'Aguarde um momento' : 'Toque para abrir o mapa interativo'}</div>
                    </div>
                  </button>
                )}
                {fieldErrors.address_lat && <p className={ERR}>{fieldErrors.address_lat}</p>}

                {location && (
                  <p className="text-xs text-[#d4d4d8]/50 flex items-center gap-1">
                    <Truck className="w-3 h-3 text-[#e0211a]" />
                    O valor do frete será calculado automaticamente pelo administrador com base na distância.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 bg-red-950/40 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-2">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="flex-1 py-3 px-6 rounded-xl border border-white/15 font-semibold text-white/70 hover:bg-[#0a0a0b] transition-all"
            >
              Voltar
            </button>
          )}
          {step < 3 ? (
            <button
              type="submit"
              className="flex-1 bg-[#e0211a] hover:bg-[#a3140f] text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
            >
              Próximo
            </button>
          ) : (
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Wrench className="w-4 h-4" />
                  Solicitar orçamento
                </>
              )}
            </button>
          )}
        </div>
      </form>
    </>
  )
}
