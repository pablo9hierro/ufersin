import { MessageCircle } from 'lucide-react'
import { api } from '../../lib/api'
import WhatsAppConnection from '../../components/ui/WhatsAppConnection'

export default function MotoboyConta() {
  return (
    <div>
      <h1 className="text-2xl font-black mb-1 flex items-center gap-2">
        <MessageCircle className="w-5 h-5" /> Minha conta
      </h1>
      <p className="text-son-silver-dim text-sm mb-6">
        Conecte seu WhatsApp — é a partir dele que os pedidos de localização são enviados ao cliente.
      </p>
      <WhatsAppConnection api={api.motoboy.whatsapp} />
    </div>
  )
}
