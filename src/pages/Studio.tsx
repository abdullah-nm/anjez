import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  eventById,
  events,
  productById,
  products,
  suggestionsFor,
} from '../data'
import { PrintPreview } from '../components/PrintPreview'
import { useStore } from '../store'
import { useAuth } from '../auth'

export function Studio() {
  const { brand, draft, setDraft } = useStore()
  const { user, rag } = useAuth()
  const [description, setDescription] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const navigate = useNavigate()
  const product = productById(draft.productId) ?? products[0]
  const event = eventById(draft.eventId) ?? events[0]

  const suggestions = useMemo(
    () =>
      suggestionsFor({
        productName: product.name,
        eventTitle: event.title,
        venue: event.venue,
        date: event.date,
        brand,
      }),
    [product.name, event.title, event.venue, event.date, brand],
  )

  async function generateArtwork() {
    if (!user) return
    if (description.trim().length < 8) {
      setGenerationError('اكتب وصفاً من 8 أحرف على الأقل.')
      return
    }
    setGenerating(true)
    setGenerationError('')
    try {
      const layout = ['invite', 'rollup'].includes(product.kind)
        ? 'portrait'
        : ['banner', 'backdrop'].includes(product.kind)
          ? 'landscape'
          : 'square'
      const response = await fetch('/api/design/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          productName: product.name,
          eventTitle: event.title,
          layout,
          palette: [brand.primaryColor, brand.accentColor],
        }),
      })
      const payload = (await response.json()) as { imageDataUrl?: string; error?: string }
      if (!response.ok || !payload.imageDataUrl) {
        throw new Error(payload.error || 'تعذر توليد التصميم. حاول مرة أخرى.')
      }
      setDraft({ ...draft, generatedImageDataUrl: payload.imageDataUrl })
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'تعذر توليد التصميم.')
    } finally {
      setGenerating(false)
    }
  }

  function goToOrder() {
    setDraft(draft)
    navigate('/order')
  }

  return (
    <div className="studio">
      <section className="stack">
        <div className="section-head">
          <p className="eyebrow">استوديو التصميم</p>
          <h1>عدّل النص، اختر المقاس، وشاهد المعاينة</h1>
        </div>

        <section className="ai-generator" aria-labelledby="ai-generator-title">
          <div>
            <p className="eyebrow">✦ مساعد التصميم</p>
            <h2 id="ai-generator-title">صف الشكل، وأنجز يولّده لك</h2>
            <p className="muted">سيولّد صورة خلفية تناسب المنتج وهوية الشركة، ويبقى النص قابلاً للتعديل.</p>
          </div>
          {user ? (
            <>
              <label className="field">
                <span>وصف التصميم</span>
                <textarea
                  rows={4}
                  maxLength={1200}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="مثال: دعوة أنيقة لمنتدى أعمال، لمسات ذهبية هادئة، نقوش نجدية هندسية ومساحة واضحة لعنوان المناسبة…"
                />
              </label>
              {!rag?.imageConfigured && (
                <p className="notice">يتطلب التوليد IMAGE_API_KEY أو OPENAI_API_KEY في إعدادات الخادم.</p>
              )}
              {generationError && <p className="notice err" role="alert">{generationError}</p>}
              <div className="ai-generator-actions">
                <button type="button" className="btn btn-primary" onClick={() => void generateArtwork()} disabled={generating}>
                  {generating ? 'جارٍ ابتكار التصميم…' : draft.generatedImageDataUrl ? 'توليد نسخة جديدة' : '✦ ولّد التصميم'}
                </button>
                {draft.generatedImageDataUrl && (
                  <button type="button" className="btn btn-ghost" onClick={() => setDraft({ ...draft, generatedImageDataUrl: undefined })}>إزالة الصورة</button>
                )}
              </div>
              <small className="muted">استخدام التوليد قد يُحسب على مفتاح مزود الصور.</small>
            </>
          ) : (
            <p>يلزم تسجيل الدخول إلى مساحة الشركة لاستخدام التوليد. <Link to="/login">تسجيل الدخول</Link></p>
          )}
        </section>

        <label className="field">
          <span>المنتج</span>
          <select
            value={draft.productId}
            onChange={(e) => {
              const next = productById(e.target.value) ?? product
              setDraft({
                ...draft,
                productId: next.id,
                size: next.sizes[0],
              })
            }}
          >
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>المناسبة</span>
          <select
            value={draft.eventId}
            onChange={(e) =>
              setDraft({
                ...draft,
                eventId: e.target.value,
                subhead:
                  events.find((item) => item.id === e.target.value)?.title ??
                  draft.subhead,
              })
            }
          >
            {events.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>المقاس</span>
          <select
            value={draft.size}
            onChange={(e) => setDraft({ ...draft, size: e.target.value })}
          >
            {product.sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>العنوان</span>
          <input
            value={draft.headline}
            onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
          />
        </label>
        <label className="field">
          <span>السطر الثاني</span>
          <input
            value={draft.subhead}
            onChange={(e) => setDraft({ ...draft, subhead: e.target.value })}
          />
        </label>
        <label className="field">
          <span>التفاصيل</span>
          <textarea
            rows={3}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </label>

        <div>
          <p className="eyebrow">اقتراحات نصية حسب هوية {brand.companyName}</p>
          <div className="suggest-row">
            {suggestions.map((item) => (
              <button
                key={item.id}
                type="button"
                className="suggest-chip"
                onClick={() =>
                  setDraft({
                    ...draft,
                    headline: item.headline,
                    subhead: item.subhead,
                    body: item.body,
                  })
                }
              >
                <strong>{item.label}</strong>
                <span>{item.headline}</span>
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={goToOrder}>
          متابعة إلى طلب الطباعة
        </button>
      </section>

      <aside className="preview-panel card">
        <p className="eyebrow">معاينة {product.name}</p>
        <PrintPreview brand={brand} product={product} draft={draft} />
        <p className="muted">
          الألوان مأخوذة من هوية الشركة. غيّرها من صفحة الهوية إن لزم.
        </p>
      </aside>
    </div>
  )
}
