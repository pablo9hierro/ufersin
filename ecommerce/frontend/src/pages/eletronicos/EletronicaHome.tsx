import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MapPin, Smartphone, Wrench } from 'lucide-react'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { resolveTenantSlug, withTenantSearch } from '../../lib/tenantConfig'
import { createServiceRequestPublic } from '../../lib/eletronicosApi'
import LocationPicker, { type LocationPickerResult } from '../../components/checkout/LocationPicker'

const DEVICE_TYPES = ['Celular', 'Tablet', 'Notebook', 'Computador', 'Outro']

export default function EletronicaHome() {
  const tenantConfig = useTenantConfig()
  const slug = resolveTenantSlug()

  const [deviceType, setDeviceType] = useState(DEVICE_TYPES[0])
  const [phoneModel, setPhoneModel] = useState('')
  const [problem, setProblem] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [selfPickup, setSelfPickup] = useState(true)
  const [location, setLocation] = useState<LocationPickerResult | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const canSubmit =
    name.trim().length > 0 &&
    phone.replace(/\D/g, '').length >= 10 &&
    problem.trim().length > 0 &&
    (selfPickup || location !== null)

  async function handleSubmit() {
    if (!slug || !canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await createServiceRequestPublic(slug, {
        customer_name: name.trim(),
        customer_phone: phone.replace(/\D/g, ''),
        phone_model: `${deviceType}${phoneModel.trim() ? ` — ${phoneModel.trim()}` : ''}`,
        problem_description: problem.trim(),
        self_pickup: selfPickup,
        address_street: location?.label,
        address_neighborhood: location?.bairro,
        address_lat: location?.lat,
        address_lng: location?.lng,
      })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'não foi possível enviar sua solicitação, tente de novo')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-5">
        <div className="max-w-md w-full rounded-2xl border border-emerald-500/30 bg-slate-900 p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center mx-auto mb-4">
            <Wrench className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold mb-2">Solicitação enviada!</h1>
          <p className="text-slate-400 text-sm mb-6">
            {tenantConfig?.loja_nome || 'A loja'} vai analisar e te chamar em breve. Você pode acompanhar o status a
            qualquer momento.
          </p>
          <Link
            to={withTenantSearch('/consultar')}
            className="inline-block w-full rounded-xl bg-emerald-500 text-slate-950 font-semibold py-3 hover:bg-emerald-400 transition-colors"
          >
            Acompanhar status
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-5 py-10">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center mx-auto mb-3">
            <Smartphone className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold">{tenantConfig?.loja_nome || 'Assistência técnica'}</h1>
          <p className="text-slate-400 text-sm mt-1">Conte o que aconteceu com seu aparelho e a gente cuida do resto.</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Tipo de aparelho</label>
            <div className="grid grid-cols-3 gap-2">
              {DEVICE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDeviceType(t)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                    deviceType === t
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Marca e modelo</label>
            <input
              value={phoneModel}
              onChange={(e) => setPhoneModel(e.target.value)}
              placeholder="ex: iPhone 12, Galaxy S23..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">O que aconteceu?</label>
            <textarea
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              rows={3}
              placeholder="tela quebrada, não liga, bateria viciada..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-2">Seu nome</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-2">WhatsApp</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(83) 9....-...."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Como prefere levar o aparelho?</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelfPickup(true)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  selfPickup ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-800 text-slate-400'
                }`}
              >
                Eu levo na loja
              </button>
              <button
                type="button"
                onClick={() => setSelfPickup(false)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  !selfPickup ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-800 text-slate-400'
                }`}
              >
                Buscar no meu endereço
              </button>
            </div>
            {!selfPickup && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="mt-3 w-full flex items-center gap-2 rounded-xl border border-dashed border-slate-700 px-3 py-2.5 text-sm text-slate-300 hover:border-emerald-500"
              >
                <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                {location ? location.label : 'Selecionar endereço de coleta'}
              </button>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
            className="w-full rounded-xl bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold py-3 flex items-center justify-center gap-2 hover:bg-emerald-400 transition-colors"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Enviar solicitação
          </button>
        </div>

        <p className="text-center text-xs text-slate-500 mt-4">
          Já enviou uma solicitação?{' '}
          <Link to={withTenantSearch('/consultar')} className="text-emerald-400 hover:underline">
            Acompanhar status
          </Link>
        </p>
      </div>

      {pickerOpen && (
        <LocationPicker
          onClose={() => setPickerOpen(false)}
          onConfirm={(result) => {
            setLocation(result)
            setPickerOpen(false)
          }}
        />
      )}
    </main>
  )
}
