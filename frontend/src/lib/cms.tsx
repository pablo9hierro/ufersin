import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ElementType,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { api, type PlatformContentItem } from './api'

/** Defaults used when DB has no value yet (public + editor). */
export const CONTENT_DEFAULTS: Record<string, string> = {
  'landing.hero.headline': 'A plataforma que transforma seu negócio numa loja online completa',
  'landing.hero.sub':
    'Catálogo, checkout, Pix, WhatsApp e gestão de pedidos prontos pra usar. Você assina, a gente configura — sem contratar equipe de tecnologia, sem meses de desenvolvimento.',
  'landing.pricing.title': 'Um plano pra cada momento do seu negócio',
  'landing.pricing.sub':
    'Comece simples e evolua quando precisar. Trocar de plano é instantâneo, sem taxa, direto pelo seu painel.',
  'demo.title': 'Escolha um plano pra ver por dentro',
  'demo.sub':
    'Você vai acessar as páginas reais que vem com cada plano — vitrine, painel admin e área do motoboy — com dados de demonstração, exatamente como o assinante recebe.',
  'assinar.title': 'Escolha o ciclo e como pagar.',
  'assinar.sub': 'Preço cobrado vem do banco — cupons aplicam no servidor.',
}

export type CmsTabId = 'landing' | 'demo' | 'assinar'

interface CmsContextValue {
  editable: boolean
  get: (key: string) => string
  setLocal: (key: string, value: string) => void
  save: (key: string, value: string) => Promise<void>
  editingKey: string | null
  draft: string
  setDraft: (v: string) => void
  startEdit: (key: string, current: string) => void
  cancelEdit: () => void
  busy: boolean
}

const CmsContext = createContext<CmsContextValue | null>(null)

export function useCms(): CmsContextValue | null {
  return useContext(CmsContext)
}

export function contentMapFromItems(items: PlatformContentItem[]): Record<string, string> {
  const map: Record<string, string> = { ...CONTENT_DEFAULTS }
  for (const item of items) {
    if (item.key && item.value != null) map[item.key] = item.value
  }
  return map
}

interface CmsEditProviderProps {
  editable?: boolean
  content: Record<string, string>
  onContentChange?: (key: string, value: string) => void
  onSave?: (key: string, value: string) => Promise<void>
  children: ReactNode
}

export function CmsEditProvider({
  editable = false,
  content,
  onContentChange,
  onSave,
  children,
}: CmsEditProviderProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const get = useCallback(
    (key: string) => content[key] ?? CONTENT_DEFAULTS[key] ?? '',
    [content],
  )

  const setLocal = useCallback(
    (key: string, value: string) => {
      onContentChange?.(key, value)
    },
    [onContentChange],
  )

  const save = useCallback(
    async (key: string, value: string) => {
      setBusy(true)
      try {
        if (onSave) {
          await onSave(key, value)
        } else {
          await api.superadminUpsertContent(key, value)
        }
        onContentChange?.(key, value)
        setEditingKey(null)
      } finally {
        setBusy(false)
      }
    },
    [onSave, onContentChange],
  )

  const startEdit = useCallback((key: string, current: string) => {
    if (!editable) return
    setEditingKey(key)
    setDraft(current)
  }, [editable])

  const cancelEdit = useCallback(() => {
    setEditingKey(null)
  }, [])

  const value = useMemo<CmsContextValue>(
    () => ({
      editable,
      get,
      setLocal,
      save,
      editingKey,
      draft,
      setDraft,
      startEdit,
      cancelEdit,
      busy,
    }),
    [editable, get, setLocal, save, editingKey, draft, startEdit, cancelEdit, busy],
  )

  return <CmsContext.Provider value={value}>{children}</CmsContext.Provider>
}

type CmsTextProps = {
  contentKey: string
  as?: ElementType
  fallback?: string
  className?: string
  /** Optional children used only as visual fallback when no CMS value. */
  children?: ReactNode
}

/** Renders CMS text; in editable mode, click to inline-edit and persist. */
export function CmsText({ contentKey, as: Tag = 'span', fallback, className = '', children }: CmsTextProps) {
  const cms = useCms()
  const defaultValue =
    fallback ?? CONTENT_DEFAULTS[contentKey] ?? (typeof children === 'string' ? children : '')
  const value = cms ? cms.get(contentKey) || defaultValue : defaultValue
  const editing = cms?.editable && cms.editingKey === contentKey

  if (editing && cms) {
    return (
      <Tag className={`${className} relative z-20`} data-cms-edit={contentKey}>
        <textarea
          className="w-full min-h-[2.5rem] bg-black/60 border border-uf-blue/50 rounded-lg px-2 py-1.5 text-inherit font-inherit resize-y outline-none"
          value={cms.draft}
          onChange={(e) => cms.setDraft(e.target.value)}
          autoFocus
          rows={Math.min(6, Math.max(2, Math.ceil(cms.draft.length / 60)))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cms.cancelEdit()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void cms.save(contentKey, cms.draft)
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="flex gap-2 mt-1.5">
          <button
            type="button"
            disabled={cms.busy}
            className="text-[11px] px-2 py-1 rounded-md bg-white text-uf-black font-semibold"
            onClick={(e) => {
              e.stopPropagation()
              void cms.save(contentKey, cms.draft)
            }}
          >
            Salvar
          </button>
          <button
            type="button"
            className="text-[11px] px-2 py-1 rounded-md bg-white/10"
            onClick={(e) => {
              e.stopPropagation()
              cms.cancelEdit()
            }}
          >
            Cancelar
          </button>
        </span>
      </Tag>
    )
  }

  if (cms?.editable) {
    return (
      <Tag
        className={`${className} cursor-text rounded-sm outline-dashed outline-1 outline-transparent hover:outline-white/30 hover:bg-white/[0.03] transition-[outline,background]`}
        data-cms-edit={contentKey}
        title="Clique para editar"
        onClick={(e: MouseEvent) => {
          e.preventDefault()
          e.stopPropagation()
          cms.startEdit(contentKey, value)
        }}
      >
        {value || <span className="italic opacity-50">(vazio — clique para editar)</span>}
      </Tag>
    )
  }

  return <Tag className={className}>{value}</Tag>
}

/** Loads public platform_content once for marketing pages. */
export function usePlatformContent() {
  const [map, setMap] = useState<Record<string, string>>(CONTENT_DEFAULTS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .listPublicContent()
      .then((items) => {
        if (!cancelled) setMap(contentMapFromItems(items))
      })
      .catch(() => {
        /* keep defaults */
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { content: map, ready }
}
