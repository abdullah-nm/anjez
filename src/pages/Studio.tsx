import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { eventById, events, productById, products, suggestionsFor } from '../data'
import { PrintPreview } from '../components/PrintPreview'
import { useStore } from '../store'
import { useAuth } from '../auth'

type SavedDesign = {
  id: string
  eventId: string | null
  productId: string
  headline: string
  subhead: string
  body: string
  svg: string
  backgroundKind: string
  backgroundNote: string
  status: string
}

export function Studio() {
  const { brand, draft, setDraft } = useStore()
  const { user, rag } = useAuth()
  const [params] = useSearchParams()
  const [description, setDescription] = useState('')
  const [purpose, setPurpose] = useState('تهنئة')
  const [audience, setAudience] = useState('')
  const [style, setStyle] = useState<string>(brand.tone)
  const [language, setLanguage] = useState<'ar' | 'en'>('ar')
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [saved, setSaved] = useState<SavedDesign[]>([])
  const [companyEvents, setCompanyEvents] = useState<{ id: string; title: string; date: string; audience: string }[]>([])
  const navigate = useNavigate()
  const product = productById(draft.productId) ?? products[0]
  const catalogEvent = eventById(draft.eventId) ?? events[0]
  const linked = companyEvents.find((item) => item.id === draft.eventId)

  useEffect(() => {
    const eventId = params.get('eventId')
    if (eventId) setDraft({ ...draft, eventId })
  }, [params])

  useEffect(() => {
    if (!user) return
    void fetch('/api/events', { credentials: 'include' })
      .then((r) => r.json())
      .then((payload) => {
        const next = payload.events || []
        setCompanyEvents(next)
        if (next.length && !next.some((item: { id: string }) => item.id === draft.eventId)) {
          setDraft({ ...draft, eventId: next[0].id, subhead: next[0].title })
        }
      })
    void fetch('/api/designs', { credentials: 'include' })
      .then((r) => r.json())
      .then((payload) => setSaved(payload.designs || []))
  }, [user])

  const suggestions = useMemo(
    () =>
      suggestionsFor({
        productName: product.name,
        eventTitle: linked?.title || catalogEvent.title,
        venue: catalogEvent.venue,
        date: linked?.date || catalogEvent.date,
        brand,
      }),
    [product.name, catalogEvent, linked, brand],
  )

  async function generateArtwork() {
    if (!user) return
    setGenerating(true)
    setGenerationError('')
    try {
      const response = await fetch('/api/designs/compose', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: companyEvents.some((item) => item.id === draft.eventId) ? draft.eventId : null,
          eventTitle: linked?.title || catalogEvent.title,
          productId: product.id,
          productName: product.name,
          purpose,
          audience: audience || linked?.audience || catalogEvent.audience,
          language,
          style,
          dimensions: ['invite', 'rollup', 'greeting'].includes(product.kind) ? 'portrait' : ['banner', 'poster', 'backdrop'].includes(product.kind) ? 'landscape' : 'square',
          instructions: description,
          content: `${draft.headline}\n${draft.subhead}\n${draft.body}`,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'تعذر توليد التصميم.')
      const design = payload.design as SavedDesign
      setSaved((current) => [design, ...current])
      setDraft({
        ...draft,
        headline: design.headline,
        subhead: design.subhead,
        body: design.body,
        generatedImageDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(design.svg)}`,
      })
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'تعذر توليد التصميم.')
    } finally {
      setGenerating(false)
    }
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/designs/${id}/status`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const payload = await fetch('/api/designs', { credentials: 'include' }).then((r) => r.json())
    setSaved(payload.designs || [])
  }

  function downloadSvg(design: SavedDesign) {
    const blob = new Blob([design.svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${design.headline || 'design'}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadPng(design: SavedDesign) {
    const blob = new Blob([design.svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth || 900
      canvas.height = image.naturalHeight || 900
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(image, 0, 0)
      canvas.toBlob((png) => {
        if (!png) return
        const href = URL.createObjectURL(png)
        const a = document.createElement('a')
        a.href = href
        a.download = `${design.headline || 'design'}.png`
        a.click()
        URL.revokeObjectURL(href)
      }, 'image/png')
      URL.revokeObjectURL(url)
    }
    image.src = url
  }

  return (
    <div className="studio">
      <section className="stack">
        <div className="section-head">
          <p className="eyebrow">استوديو التصميم</p>
          <h1>مفهوم مطبوع بهوية الشركة وشعارها</h1>
        </div>

        <section className="ai-generator">
          {user ? (
            <>
              <label className="field">
                <span>الغرض</span>
                <input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
              </label>
              <label className="field">
                <span>الجمهور</span>
                <input value={audience} onChange={(e) => setAudience(e.target.value)} />
              </label>
              <label className="field">
                <span>اللغة</span>
                <select value={language} onChange={(e) => setLanguage(e.target.value as 'ar' | 'en')}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="field">
                <span>الأسلوب</span>
                <input value={style} onChange={(e) => setStyle(e.target.value)} />
              </label>
              <label className="field">
                <span>تعليمات إضافية</span>
                <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              {brand.logoUrl ? (
                <p className="muted">يُستخدم شعار هوية الشركة في المعاينة وكل تصميم مولَّد.</p>
              ) : (
                <p className="notice">ارفع الشعار من <Link to="/brand">هوية الشركة</Link> ليظهر في التصاميم.</p>
              )}
              {!rag?.imageConfigured && !rag?.geminiConfigured && (
                <p className="notice">بدون مفتاح صورة/Gemini سيُنشأ قالب SVG بالهوية والشعار، ولن نعرض صورة نقطية وهمية.</p>
              )}
              {generationError && <p className="notice err">{generationError}</p>}
              <button type="button" className="btn btn-primary" disabled={generating} onClick={() => void generateArtwork()}>
                {generating ? 'جارٍ التوليد…' : 'ولّد تصميماً بهوية الشركة'}
              </button>
            </>
          ) : (
            <p>يلزم <Link to="/login">تسجيل الدخول</Link> لحفظ التصاميم للشركة.</p>
          )}
        </section>

        <label className="field">
          <span>المنتج</span>
          <select
            value={draft.productId}
            onChange={(e) => {
              const next = productById(e.target.value) ?? product
              setDraft({ ...draft, productId: next.id, size: next.sizes[0] })
            }}
          >
            {products.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>المناسبة</span>
          <select value={draft.eventId} onChange={(e) => setDraft({ ...draft, eventId: e.target.value })}>
            {companyEvents.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
            {events.map((item) => (
              <option key={item.id} value={item.id}>{item.title} (كتالوج)</option>
            ))}
          </select>
        </label>
        <label className="field"><span>العنوان</span><input value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} /></label>
        <label className="field"><span>السطر الثاني</span><input value={draft.subhead} onChange={(e) => setDraft({ ...draft, subhead: e.target.value })} /></label>
        <label className="field"><span>التفاصيل</span><textarea rows={3} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
        <div className="suggest-row">
          {suggestions.map((item) => (
            <button key={item.id} type="button" className="suggest-chip" onClick={() => setDraft({ ...draft, headline: item.headline, subhead: item.subhead, body: item.body })}>
              <strong>{item.label}</strong>
              <span>{item.headline}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/order')}>متابعة إلى طلب الطباعة</button>
      </section>

      <aside className="preview-panel card stack">
        <p className="eyebrow">معاينة {product.name}</p>
        <PrintPreview brand={brand} product={product} draft={draft} />
        <p className="muted">التصدير المتاح: SVG وPNG من القالب. PDF بعلامات قطع وCMYK غير منفّذ.</p>
        {saved.length === 0 && user && <p className="muted">لا تصاميم محفوظة بعد.</p>}
        {saved.map((design) => (
          <article key={design.id} className="compact">
            <div dangerouslySetInnerHTML={{ __html: design.svg }} className="svg-thumb" />
            <p>{design.headline}</p>
            <p className="muted">{design.backgroundNote}</p>
            <p>الحالة: {design.status}</p>
            <div className="hero-actions">
              <button type="button" className="btn btn-ghost" onClick={() => downloadSvg(design)}>تنزيل SVG</button>
              <button type="button" className="btn btn-ghost" onClick={() => downloadPng(design)}>تنزيل PNG</button>
              <button type="button" className="btn btn-secondary" onClick={() => void setStatus(design.id, 'approved')}>اعتماد</button>
              <button type="button" className="btn btn-ghost" onClick={() => void setStatus(design.id, 'revision')}>طلب تعديل</button>
            </div>
          </article>
        ))}
      </aside>
    </div>
  )
}
