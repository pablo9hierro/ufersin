import { ExternalLink, MapPin } from 'lucide-react'
import { tenantFullAddress, tenantMapsHref, type TenantConfig } from '../../lib/tenantConfig'

/** Checkout block when the store only accepts pickup (no delivery). */
export default function PickupOnlyNotice({
  config,
  className = '',
  dimClass = 'opacity-70',
  surfaceClass = '',
}: {
  config: TenantConfig | null | undefined
  className?: string
  dimClass?: string
  surfaceClass?: string
}) {
  const address = tenantFullAddress(config)
  const mapsHref = tenantMapsHref(config)

  return (
    <div className={className}>
      <p className={`text-sm ${dimClass}`}>
        Esta loja aceita compras <span className="font-semibold">apenas com retirada no local</span>.
        Entrega não está disponível.
      </p>
      {address && mapsHref ? (
        <a
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-2 inline-flex items-center gap-2 text-sm font-semibold underline-offset-2 hover:underline ${surfaceClass}`}
        >
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{address}</span>
          <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-70" />
        </a>
      ) : address ? (
        <p className={`mt-2 text-sm font-semibold inline-flex items-center gap-2 ${surfaceClass}`}>
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          {address}
        </p>
      ) : null}
    </div>
  )
}
