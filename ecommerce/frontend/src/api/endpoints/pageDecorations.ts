import { api } from '../../lib/api'
import { validateList } from '../validate'
import { PageDecorationSchema } from '../../types'

// Módulo Configurações (layout por página) — único ponto do app
// autorizado a chamar `api.pageDecorations.list`.
export const pageDecorationsEndpoint = {
  list: async () => validateList(PageDecorationSchema, await api.pageDecorations.list(), 'pageDecorations.list'),
}
