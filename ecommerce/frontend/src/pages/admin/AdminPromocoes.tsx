import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Megaphone, Plus, Trash2, X } from 'lucide-react'
import Card from '../../components/ui/Card'
import ExpiryInput from '../../components/admin/ExpiryInput'
import ProductDiscountList from '../../components/admin/ProductDiscountList'
import ToggleSwitch from '../../components/admin/ToggleSwitch'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { api, ApiError } from '../../lib/api'
import type { CarouselStyle, Category, Product, ProductDiscount, Promotion } from '../../lib/types'

const MAX_BANNER_MB = 10

// Promoção "kit" (pacote fechado, desconto único sobre o total) saiu do
// fluxo de criação — toda promoção nova é "selfie service" (desconto por
// produto). Quem quiser um kit hoje cadastra o kit como PRODUTO próprio
// (categoria "Kit") e escolhe esse produto aqui, com o desconto dele.
type PromotionForm = {
  title: string
  subtitle: string
  image_url: string
  productDiscounts: ProductDiscount[]
  active: boolean
  starts_at: string
  expires_at: string
}
const EMPTY_PROMOTION_FORM: PromotionForm = {
  title: '',
  subtitle: '',
  image_url: '',
  productDiscounts: [],
  active: true,
  starts_at: '',
  expires_at: '',
}

function discountLabel(discountType: 'percent' | 'fixed' | null | undefined, value: number | null | undefined) {
  if (!discountType || value == null) return null
  return discountType === 'percent' ? `${value}% off` : `R$ ${value.toFixed(2).replace('.', ',')} off`
}

// Imagem inicial do carrossel da landing: sempre obrigatória, sempre a
// primeira a aparecer (mesmo com promoções cadastradas) — o admin pode
// trocá-la aqui a qualquer momento.
function HeroImageCard() {
  const [heroUrl, setHeroUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.siteSettings.get().then((s) => setHeroUrl(s.hero_image_url))
  }, [])

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    if (file.size > MAX_BANNER_MB * 1024 * 1024) {
      setError(`O arquivo tem ${(file.size / (1024 * 1024)).toFixed(1)}MB — o máximo é ${MAX_BANNER_MB}MB.`)
      return
    }
    setUploading(true)
    try {
      const { url } = await api.admin.products.uploadImage(file)
      const result = await api.admin.siteSettings.updateHeroImage(url)
      setHeroUrl(result.hero_image_url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao enviar a imagem.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card className="p-5 mb-6">
      <p className="font-bold text-white mb-1">Imagem inicial do carrossel</p>
      <p className="text-xs text-son-silver-dim mb-3">
        Sempre obrigatória — é a primeira coisa que aparece na landing, mesmo quando há promoções cadastradas. Depois de 2s o
        carrossel desliza pras promoções ativas, se houver.
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
        className="hidden"
        onChange={handleChange}
      />
      <div className="flex items-center gap-3">
        <div className="w-28 h-14 rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden flex-shrink-0">
          {uploading ? (
            <Loader2 className="w-5 h-5 animate-spin text-son-silver-dim" />
          ) : heroUrl ? (
            <img src={heroUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <Megaphone className="w-6 h-6 text-son-silver-dim/40" />
          )}
        </div>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="btn-secondary text-sm py-2 px-3">
          <ImagePlus className="w-3.5 h-3.5" />
          {heroUrl ? 'Trocar imagem' : 'Enviar imagem'}
        </button>
      </div>
      {!heroUrl && <p className="text-xs text-amber-400 mt-2">Nenhuma imagem enviada ainda — a landing está usando o banner padrão.</p>}
      <p className="text-xs text-son-silver-dim mt-2">
        Dimensão recomendada: 1200×600px (proporção 2:1), formatos aceitos: JPG, PNG, WEBP, GIF, MP4 ou WEBM. Tamanho máximo por
        arquivo: {MAX_BANNER_MB}MB.
      </p>
      {error && <p className="error-msg mt-1">{error}</p>}
    </Card>
  )
}

// Estilo do carrossel de banners da landing — 'atual' (um card só, troca
// de conteúdo sozinho) ou 'cards' (cada card fica 3s na tela e desliza pra
// esquerda pro próximo). Nos dois o cliente também pode arrastar
// manualmente pra esquerda/direita, em loop.
function CarouselStyleCard() {
  const [style, setStyle] = useState<CarouselStyle>('atual')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.siteSettings.get().then((s) => setStyle(s.carousel_style))
  }, [])

  const choose = async (next: CarouselStyle) => {
    if (next === style || saving) return
    setError(null)
    setSaving(true)
    const previous = style
    setStyle(next)
    try {
      await api.admin.siteSettings.updateCarouselStyle(next)
    } catch (err) {
      setStyle(previous)
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o estilo do carrossel.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5 mb-6">
      <p className="font-bold text-white mb-1">Estilo do carrossel da landing</p>
      <p className="text-xs text-son-silver-dim mb-3">
        Escolha como o carrossel de banners/promoções se comporta na página inicial. Nos dois formatos o cliente também pode
        arrastar pra esquerda ou direita pra navegar manualmente, em loop.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => choose('atual')}
          disabled={saving}
          className={`text-left rounded-xl border p-3 transition-colors ${
            style === 'atual' ? 'border-son-gold bg-son-gold/10' : 'border-white/10 bg-son-surface-light hover:border-white/20'
          }`}
        >
          <p className="text-sm font-semibold text-white mb-1">Atual</p>
          <p className="text-xs text-son-silver-dim">Um card só, troca de conteúdo sozinho a cada 4,5s.</p>
        </button>
        <button
          type="button"
          onClick={() => choose('cards')}
          disabled={saving}
          className={`text-left rounded-xl border p-3 transition-colors ${
            style === 'cards' ? 'border-son-gold bg-son-gold/10' : 'border-white/10 bg-son-surface-light hover:border-white/20'
          }`}
        >
          <p className="text-sm font-semibold text-white mb-1">Cards deslizantes</p>
          <p className="text-xs text-son-silver-dim">Cada card fica 3s na tela e desliza pra esquerda pro próximo.</p>
        </button>
      </div>
      {error && <p className="error-msg mt-2">{error}</p>}
    </Card>
  )
}

export default function AdminPromocoes() {
  const { askConfirm, confirmDialogElement } = useConfirmDialog()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [promotionsLoading, setPromotionsLoading] = useState(true)
  const [showPromotionForm, setShowPromotionForm] = useState(false)
  const [promotionForm, setPromotionForm] = useState<PromotionForm>(EMPTY_PROMOTION_FORM)
  const [editingPromotionId, setEditingPromotionId] = useState<string | null>(null)
  const [savingPromotion, setSavingPromotion] = useState(false)
  const [promotionError, setPromotionError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadPromotions = () => {
    setPromotionsLoading(true)
    api.admin.promotions.list().then(setPromotions).finally(() => setPromotionsLoading(false))
  }
  useEffect(() => {
    api.admin.products.list().then(setProducts)
    api.admin.categories.list().then(setCategories)
    loadPromotions()
  }, [])

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPromotionError(null)
    if (file.size > MAX_BANNER_MB * 1024 * 1024) {
      setPromotionError(`O arquivo tem ${(file.size / (1024 * 1024)).toFixed(1)}MB — o máximo é ${MAX_BANNER_MB}MB.`)
      return
    }
    setUploading(true)
    try {
      const { url } = await api.admin.products.uploadImage(file)
      setPromotionForm((f) => ({ ...f, image_url: url }))
    } catch (err) {
      setPromotionError(err instanceof ApiError ? err.message : 'Erro ao enviar a imagem.')
    } finally {
      setUploading(false)
    }
  }

  const openNewPromotion = () => {
    setEditingPromotionId(null)
    setPromotionForm(EMPTY_PROMOTION_FORM)
    setPromotionError(null)
    setShowPromotionForm(true)
  }

  const openEditPromotion = (p: Promotion) => {
    setEditingPromotionId(p.id)
    // category_id não é persistido em product_discounts (o backend só
    // conhece linha por produto) — re-tageia aqui pra tela de edição
    // reconstruir o agrupamento "Categoria: X", cruzando com a categoria
    // ATUAL de cada produto contra as regras de categoria da promoção.
    const categoryRuleByCategory = new Map((p.category_discounts ?? []).map((cd) => [cd.category_id, cd]))
    const productDiscounts = (p.product_discounts ?? []).map((d) => {
      const product = products.find((prod) => prod.id === d.product_id)
      const rule = product?.category_id ? categoryRuleByCategory.get(product.category_id) : undefined
      return rule ? { ...d, category_id: rule.category_id } : d
    })
    setPromotionForm({
      title: p.title,
      subtitle: p.subtitle ?? '',
      image_url: p.image_url,
      productDiscounts,
      active: p.active ?? true,
      starts_at: p.starts_at ?? '',
      expires_at: p.expires_at ?? '',
    })
    setPromotionError(null)
    setShowPromotionForm(true)
  }

  const savePromotion = async () => {
    setPromotionError(null)
    if (promotionForm.productDiscounts.length === 0) {
      setPromotionError('Busque e adicione ao menos um produto com desconto.')
      return
    }
    if (promotionForm.productDiscounts.some((d) => !d.discount_value || d.discount_value <= 0)) {
      setPromotionError('Todo produto selecionado precisa de um desconto (em R$ ou %), nem que seja mínimo.')
      return
    }
    setSavingPromotion(true)
    try {
      // Produto entrou na lista via "categoria inteira" (tag category_id só
      // existe no client) — manda também a regra por categoria, pra um
      // produto novo (ou recategorizado) DEPOIS de salvar a promoção entrar
      // em promoção sozinho via trigger no backend, sem precisar reabrir
      // essa promoção pra reeditar.
      const categoryDiscountsMap = new Map<string, { category_id: string; discount_type: 'percent' | 'fixed'; discount_value: number }>()
      for (const d of promotionForm.productDiscounts) {
        if (d.category_id && !categoryDiscountsMap.has(d.category_id)) {
          categoryDiscountsMap.set(d.category_id, { category_id: d.category_id, discount_type: d.discount_type, discount_value: d.discount_value })
        }
      }
      const payload = {
        title: promotionForm.title,
        subtitle: promotionForm.subtitle || undefined,
        image_url: promotionForm.image_url,
        product_ids: promotionForm.productDiscounts.map((d) => d.product_id),
        promotion_type: 'selfie_service' as const,
        product_discounts: promotionForm.productDiscounts,
        category_discounts: categoryDiscountsMap.size > 0 ? Array.from(categoryDiscountsMap.values()) : undefined,
        starts_at: promotionForm.starts_at || undefined,
        expires_at: promotionForm.expires_at || undefined,
      }
      if (editingPromotionId) {
        await api.admin.promotions.update(editingPromotionId, { ...payload, active: promotionForm.active })
      } else {
        await api.admin.promotions.create(payload)
      }
      setShowPromotionForm(false)
      setEditingPromotionId(null)
      setPromotionForm(EMPTY_PROMOTION_FORM)
      loadPromotions()
    } catch (err) {
      setPromotionError(err instanceof ApiError ? err.message : 'Não foi possível salvar a promoção.')
    } finally {
      setSavingPromotion(false)
    }
  }

  const togglePromotionActive = async (p: Promotion) => {
    await api.admin.promotions.update(p.id, {
      title: p.title,
      subtitle: p.subtitle ?? undefined,
      image_url: p.image_url,
      product_ids: p.product_ids,
      promotion_type: p.promotion_type,
      discount_type: p.discount_type ?? undefined,
      discount_value: p.discount_value ?? undefined,
      product_discounts: p.product_discounts,
      shipping_discount_type: p.shipping_discount_type ?? undefined,
      shipping_discount_value: p.shipping_discount_value ?? undefined,
      active: !p.active,
      starts_at: p.starts_at ?? undefined,
      expires_at: p.expires_at ?? undefined,
    })
    loadPromotions()
  }

  const removePromotion = (id: string) =>
    askConfirm('Remover esta promoção?', async () => {
      await api.admin.promotions.delete(id)
      loadPromotions()
    })

  return (
    <div>
      <HeroImageCard />
      <CarouselStyleCard />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black">Promoções</h1>
        <button onClick={openNewPromotion} className="btn-primary text-sm py-2 px-4">
          <Plus className="w-4 h-4" /> Nova promoção
        </button>
      </div>
      {promotionsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
        </div>
      ) : promotions.length === 0 ? (
        <div className="text-center py-16 text-son-silver-dim">
          <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Nenhuma promoção cadastrada.</p>
          <p className="text-xs mt-1">Toda promoção precisa de imagem + ao menos um produto com desconto.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {promotions.map((p) => (
            <Card key={p.id} className="p-4">
              <button type="button" onClick={() => openEditPromotion(p)} className="flex gap-3 w-full text-left">
                <img src={p.image_url} alt={p.title} className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white truncate">{p.title}</p>
                  <p className="text-xs text-son-silver-dim">{p.product_ids.length} produto(s)</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-son-silver-dim text-xs">
                      {p.promotion_type === 'kit' ? 'Kit' : 'Selfie service'}
                    </span>
                    {p.promotion_type === 'selfie_service' ? (
                      <span className="px-2 py-0.5 rounded-full bg-son-pink/15 text-son-pink text-xs font-semibold">
                        {p.product_discounts?.length ?? 0} produto(s) c/ desconto
                      </span>
                    ) : (
                      discountLabel(p.discount_type, p.discount_value) && (
                        <span className="px-2 py-0.5 rounded-full bg-son-pink/15 text-son-pink text-xs font-semibold">
                          {discountLabel(p.discount_type, p.discount_value)}
                        </span>
                      )
                    )}
                    {discountLabel(p.shipping_discount_type, p.shipping_discount_value) && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-semibold">
                        Frete: {discountLabel(p.shipping_discount_type, p.shipping_discount_value)}
                      </span>
                    )}
                  </div>
                  {p.expires_at && (
                    <p className="text-xs text-son-silver-dim mt-1">Até {new Date(p.expires_at).toLocaleString('pt-BR')}</p>
                  )}
                </div>
              </button>
              <div className="flex items-center justify-between mt-3">
                <ToggleSwitch checked={p.active ?? true} onClick={() => togglePromotionActive(p)} />
                <div className="flex items-center gap-3">
                  <button onClick={() => openEditPromotion(p)} className="text-xs font-semibold text-son-silver-dim hover:text-white">
                    Editar
                  </button>
                  <button onClick={() => removePromotion(p.id)} className="text-son-silver-dim hover:text-son-pink">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showPromotionForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{editingPromotionId ? 'Editar promoção' : 'Nova promoção'}</h3>
              <button
                onClick={() => {
                  setShowPromotionForm(false)
                  setEditingPromotionId(null)
                }}
                className="text-son-silver-dim hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Título</label>
                <input
                  className="input-field"
                  value={promotionForm.title}
                  onChange={(e) => setPromotionForm({ ...promotionForm, title: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Subtítulo do banner (opcional)</label>
                <input
                  className="input-field"
                  placeholder="Promoções"
                  value={promotionForm.subtitle}
                  onChange={(e) => setPromotionForm({ ...promotionForm, subtitle: e.target.value })}
                />
                <p className="text-xs text-son-silver-dim mt-1">Segunda linha do card na landing. Em branco, mostra "Promoções".</p>
              </div>
              <div>
                <label className="label">Banner (imagem, gif ou vídeo — obrigatório)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
                  className="hidden"
                  onChange={handleImageChange}
                />
                <div className="flex items-center gap-3">
                  <div className="w-20 h-20 rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden flex-shrink-0">
                    {uploading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-son-silver-dim" />
                    ) : promotionForm.image_url ? (
                      <img src={promotionForm.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Megaphone className="w-6 h-6 text-son-silver-dim/40" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="btn-secondary text-sm py-2 px-3"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    {promotionForm.image_url ? 'Trocar imagem' : 'Enviar imagem'}
                  </button>
                </div>
                <p className="text-xs text-son-silver-dim mt-1.5">
                  Dimensão recomendada: 1200×600px (proporção 2:1), formatos aceitos: JPG, PNG, WEBP, GIF, MP4 ou WEBM. Tamanho
                  máximo por arquivo: {MAX_BANNER_MB}MB.
                </p>
                {promotionError && <p className="error-msg mt-1">{promotionError}</p>}
              </div>
              <div>
                <label className="label">Produtos da promoção (cada um com seu desconto)</label>
                <p className="text-xs text-son-silver-dim mb-1.5">
                  O cliente escolhe entre esses produtos em /banner — cada um com seu próprio desconto, todo produto precisa de
                  algum desconto (nem que seja mínimo). Quer um "kit" fechado? Cadastre-o como um produto próprio (categoria
                  "Kit") em Produtos, e selecione esse produto aqui.
                </p>
                <ProductDiscountList
                  products={products}
                  categories={categories}
                  discounts={promotionForm.productDiscounts}
                  onChange={(productDiscounts) => setPromotionForm({ ...promotionForm, productDiscounts })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Início (opcional)</label>
                  <ExpiryInput
                    value={promotionForm.starts_at}
                    onChange={(starts_at) => setPromotionForm({ ...promotionForm, starts_at })}
                    allowDuration={false}
                  />
                </div>
                <div>
                  <label className="label">Termina em (opcional)</label>
                  <ExpiryInput
                    value={promotionForm.expires_at}
                    onChange={(expires_at) => setPromotionForm({ ...promotionForm, expires_at })}
                  />
                </div>
              </div>
              <button onClick={savePromotion} disabled={savingPromotion} className="btn-primary w-full mt-2">
                {savingPromotion ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {editingPromotionId ? 'Salvar alterações' : 'Salvar promoção'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialogElement}
    </div>
  )
}
