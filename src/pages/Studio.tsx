import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { featuredProductIds, productById, products } from '../data'
import { PrintPreview } from '../components/PrintPreview'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { draftHasWork, prefillFromOccasion, type OccasionPrefill } from '../occasionPrefill'
import { riyadhToday, upcomingDesignOccasions, type StudioOccasion } from '../studioOccasions'

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

const statusLabel: Record<string, string> = {
  draft: 'مسودة',
  approved: 'معتمد',
  revision: 'يعاد تحريره',
}

const tones = ['فاخر', 'رسمي', 'ودّي', 'حيوي'] as const

function dimensionsFor(kind: string) {
  if (['invite', 'rollup', 'greeting'].includes(kind)) return 'portrait'
  if (['banner', 'poster', 'backdrop'].includes(kind)) return 'landscape'
  return 'square'
}

function shapeFor(productId: string) {
  if (['prd-banner', 'prd-backdrop', 'prd-poster'].includes(productId)) return 'landscape'
  if (productId === 'prd-rollup') return 'tall'
  if (productId === 'prd-card') return 'card'
  if (productId === 'prd-mug') return 'mug'
  if (productId === 'prd-bag') return 'bag'
  return 'portrait'
}

function plainFailure(message: string) {
  if (message.includes('429') || message.includes('quota')) {
    return 'توقفت خلفية Gemini لأن حصة الاستخدام اكتملت. المعاينة الحالية قالب بالشعار والألوان.'
  }
  if (message.includes('401') || message.includes('403') || message.includes('API key')) {
    return 'تعذر توليد الخلفية لأن مفتاح Gemini غير مقبول. بقي قالب الهوية.'
  }
  const sentence = message.split('{')[0].replace(/\s+/g, ' ').trim()
  return sentence || 'تعذر توليد المعاينة. أعد المحاولة.'
}

function previewSourceNote(kind: string, note: string) {
  if (kind === 'ai_bitmap_background' && note.includes('مزود بديل')) {
    return 'الخلفية من مزود بديل بعد تعذر Gemini. الشعار من ملف الهوية. أعد التوليد بعد 45 ثانية إن احتجت صورة أخرى.'
  }
  if (kind === 'ai_bitmap_background' && !note.includes('تعذر')) {
    return 'الخلفية من Gemini. الشعار من ملف الهوية، وليس رسماً من النموذج.'
  }
  if (note.includes('429') || note.includes('quota')) {
    return 'حصة توليد الصور في Gemini اكتملت. المعاينة قالب بالشعار والألوان حتى تتجدد الحصة.'
  }
  if (note.includes('تعذر')) {
    return 'تعذر توليد الخلفية. المعاينة قالب بالشعار والألوان، ويمكن إعادة المحاولة.'
  }
  return 'قالب بهوية الشركة. هذه معاينة مراجعة، ليست ملفاً جاهزاً للطباعة.'
}

export function Studio() {
  const { brand, draft, setDraft } = useStore()
  const { user, loading } = useAuth()
  const [params] = useSearchParams()
  const location = useLocation()
  const [note, setNote] = useState('')
  const [audience, setAudience] = useState('')
  const [tone, setTone] = useState(brand.tone)
  const [language, setLanguage] = useState<'ar' | 'en'>('ar')
  const [showHelpful, setShowHelpful] = useState(false)
  const [showAllProducts, setShowAllProducts] = useState(false)
  const [phase, setPhase] = useState<'compose' | 'review'>('compose')
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [liveSvg, setLiveSvg] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [saved, setSaved] = useState<SavedDesign[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [occasions, setOccasions] = useState<StudioOccasion[]>([])
  const [eventsStatus, setEventsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [eventsError, setEventsError] = useState('')
  const [eventsLoad, setEventsLoad] = useState(0)
  const previewRef = useRef<HTMLElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const appliedOccasion = useRef('')
  const navigate = useNavigate()
  const product = productById(draft.productId) ?? products[0]
  const selected = occasions.find((item) => item.id === draft.eventId) ?? null
  const active = phase === 'review'
    ? (saved.find((item) => item.id === activeId) ?? saved[0] ?? null)
    : null
  const catalog = showAllProducts || !featuredProductIds.includes(product.id)
    ? products
    : products.filter((item) => featuredProductIds.includes(item.id))
  const headline = draft.headline.trim()
  const textDir = language === 'en' ? 'ltr' : 'rtl'

  useEffect(() => {
    const ready = Boolean(note.trim() || selected)
    const step = phase === 'review' ? '3' : ready ? '2' : '1'
    sessionStorage.setItem('anjz-step', step)
    window.dispatchEvent(new Event('anjz-step'))
  }, [phase, note, selected])

  useEffect(() => {
    const eventId = params.get('eventId')
    if (!eventId || eventsStatus !== 'ready' || appliedOccasion.current === eventId) return
    const carried = (location.state as { prefill?: OccasionPrefill } | null)?.prefill
    const event = occasions.find((item) => item.id === eventId)
    const next = carried?.eventId === eventId
      ? carried
      : event
        ? prefillFromOccasion({
            id: event.id,
            title: event.title,
            date: event.date,
            dateOfficial: event.dateOfficial,
            audience: event.audience,
            category: event.category,
            companyName: brand.companyName,
            slogan: brand.slogan,
          })
        : null
    if (!next) return
    if (draft.eventId === eventId && draft.headline.trim()) {
      appliedOccasion.current = eventId
      if (carried?.eventId === eventId) {
        setAudience(carried.audience)
        setNote(carried.textBrief)
        setShowHelpful(true)
      }
      return
    }
    const product = productById(next.productId) ?? products[0]
    setDraft({
      productId: product.id,
      eventId: next.eventId,
      eventTitle: next.eventTitle,
      size: product.sizes[0],
      headline: '',
      subhead: '',
      body: next.body,
    })
    setAudience(next.audience)
    setNote(next.textBrief)
    setShowHelpful(false)
    appliedOccasion.current = eventId
  }, [params, occasions, eventsStatus, location.state, brand.companyName, brand.slogan])

  useEffect(() => {
    if (!user || phase === 'review') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetch('/api/designs/preview', {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: product.name,
          headline,
          subhead: draft.subhead.trim(),
          body: audience.trim(),
          dimensions: dimensionsFor(product.kind),
          size: draft.size,
        }),
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => null)
          if (!response.ok || typeof payload?.svg !== 'string') {
            throw new Error(payload?.error || 'تعذر تحديث المعاينة.')
          }
          setLiveSvg(payload.svg)
          setPreviewError('')
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setPreviewError(error instanceof Error ? error.message : 'تعذر تحديث المعاينة.')
        })
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [user, phase, product.id, product.name, product.kind, headline, draft.subhead, audience, note, previewAttempt])

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    setEventsStatus('loading')
    setEventsError('')
    void fetch('/api/events', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || 'تعذر تحميل مناسبات التقويم.')
        if (controller.signal.aborted) return
        setOccasions(upcomingDesignOccasions(payload, riyadhToday()))
        setEventsStatus('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setEventsStatus('error')
        setEventsError(error instanceof Error ? error.message : 'تعذر تحميل مناسبات التقويم.')
      })
    return () => controller.abort()
  }, [user?.id, location.key, eventsLoad])

  useEffect(() => {
    if (!user) return
    void fetch('/api/designs', { credentials: 'include' })
      .then((r) => r.json())
      .then((payload) => setSaved(payload.designs || []))
  }, [user])

  function chooseProduct(productId: string) {
    const next = productById(productId) ?? product
    setDraft({ ...draft, productId: next.id, size: next.sizes[0] })
  }

  function chooseEvent(eventId: string) {
    if ((draft.eventId || '') === eventId) return
    if (draftHasWork(draft) && !window.confirm('يوجد نص أو معاينة غير محفوظة. هل تستبدلها ببيانات المناسبة الجديدة؟')) return
    const event = occasions.find((item) => item.id === eventId)
    if (!event) {
      setDraft({ ...draft, eventId: '', eventTitle: '', headline: '', subhead: '', body: '', generatedImageDataUrl: undefined, savedDesignId: undefined })
      setAudience('')
      setNote('')
      appliedOccasion.current = ''
      return
    }
    const next = prefillFromOccasion({
      id: event.id,
      title: event.title,
      date: event.date,
      dateOfficial: event.dateOfficial,
      audience: event.audience,
      category: event.category,
      companyName: brand.companyName,
      slogan: brand.slogan,
    })
    const product = productById(next.productId) ?? products[0]
    setDraft({
      productId: product.id,
      eventId: next.eventId,
      eventTitle: next.eventTitle,
      size: product.sizes[0],
      headline: '',
      subhead: '',
      body: next.body,
    })
    setAudience(next.audience)
    setNote(next.textBrief)
    setShowHelpful(false)
    appliedOccasion.current = event.id
  }

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
          eventId: selected?.id ?? null,
          eventTitle: selected?.title || '',
          productId: product.id,
          productName: product.name,
          purpose: '',
          audience: audience.trim(),
          language,
          style: tone,
          dimensions: dimensionsFor(product.kind),
          size: draft.size,
          instructions: note.trim() || (selected ? `تهنئة قصيرة تليق بـ${selected.title}` : ''),
          content: '',
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'تعذر توليد التصميم.')
      const design = payload.design as SavedDesign
      setSaved((current) => [design, ...current.filter((item) => item.id !== design.id)])
      setActiveId(design.id)
      setPhase('review')
      setDraft({
        ...draft,
        eventTitle: selected?.title || draft.eventTitle,
        headline: design.headline,
        subhead: design.subhead,
        body: design.body,
        generatedImageDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(design.svg)}`,
        savedDesignId: design.id,
      })
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } catch (error) {
      setGenerationError(plainFailure(error instanceof Error ? error.message : ''))
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
    setSaved((current) => current.map((item) => (item.id === id ? { ...item, status } : item)))
  }

  function revise(design: SavedDesign) {
    setDraft({
      ...draft,
      productId: design.productId,
      headline: design.headline,
      subhead: design.subhead,
      body: design.body,
      eventId: design.eventId || draft.eventId,
    })
    setActiveId(design.id)
    setShowHelpful(true)
    setPhase('compose')
    void setStatus(design.id, 'revision')
    textRef.current?.focus()
  }

  function download(design: SavedDesign, kind: 'svg' | 'png') {
    if (kind === 'svg') {
      const blob = new Blob([design.svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${design.headline || 'preview'}.svg`
      a.click()
      URL.revokeObjectURL(url)
      return
    }
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
        a.download = `${design.headline || 'preview'}.png`
        a.click()
        URL.revokeObjectURL(href)
      }, 'image/png')
      URL.revokeObjectURL(url)
    }
    image.src = url
  }

  function resume(design: SavedDesign) {
    const item = productById(design.productId)
    setActiveId(design.id)
    setPhase('review')
    setDraft({
      ...draft,
      productId: design.productId,
      size: item?.sizes[0] || draft.size,
      headline: design.headline,
      subhead: design.subhead,
      body: design.body,
      eventId: design.eventId || '',
      generatedImageDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(design.svg)}`,
    })
  }

  function continueToOrder() {
    setDraft({ ...draft, eventId: selected?.id || draft.eventId, eventTitle: selected?.title || draft.eventTitle || '' })
    navigate('/order')
  }

  return (
    <div className={phase === 'review' && active ? 'studio review' : 'studio'}>
      <section className="stack">
        <div className="section-head">
          <div>
            <h1>{phase === 'review' ? 'المعاينة' : 'المنتج والنص'}</h1>
          </div>
        </div>

        <div className="brand-strip">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={`شعار ${brand.companyName}`} />
          ) : (
            <span className="brand-fallback" aria-hidden="true">{brand.companyName.slice(0, 1)}</span>
          )}
          <div>
            <strong>{brand.companyName}</strong>
            <p className="muted">من ملف الهوية</p>
          </div>
          <span className="swatch" style={{ background: brand.primaryColor }} title="اللون الأساسي" />
          <span className="swatch" style={{ background: brand.accentColor }} title="لون الإبراز" />
          {!brand.logoUrl && <Link to="/brand">أضف الشعار</Link>}
        </div>

        {phase === 'review' && active ? (
          <div className="review-summary card">
            <p><strong>{product.name}</strong> · {draft.size}</p>
            <p dir={textDir}>{headline}</p>
            <button type="button" className="btn btn-ghost" onClick={() => setPhase('compose')}>
              تغيير المنتج أو النص
            </button>
          </div>
        ) : (
          <>
            <fieldset>
              <legend>المنتج</legend>
              <div className="product-grid">
                {catalog.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === product.id ? 'product-tile on' : 'product-tile'}
                    aria-pressed={item.id === product.id}
                    disabled={generating}
                    onClick={() => chooseProduct(item.id)}
                  >
                    <span className={`silhouette sil-${shapeFor(item.id)}`} aria-hidden="true" />
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
              {!showAllProducts && catalog.length < products.length && (
                <button type="button" className="text-link advanced-toggle" onClick={() => setShowAllProducts(true)}>
                  منتجات أخرى
                </button>
              )}
              <p className="muted">{product.summary}</p>
            </fieldset>

            {user && (
              <div className="field">
                <span>المناسبة</span>
                {eventsStatus === 'loading' && <p className="muted">جارٍ تحميل مناسبات التقويم…</p>}
                {eventsStatus === 'error' && (
                  <div className="notice err" role="alert">
                    <p>{eventsError}</p>
                    <button type="button" className="btn btn-secondary" onClick={() => setEventsLoad((value) => value + 1)}>
                      إعادة المحاولة
                    </button>
                  </div>
                )}
                {eventsStatus === 'ready' && (
                  <>
                    <select value={selected?.id || ''} onChange={(event) => chooseEvent(event.target.value)} aria-label="المناسبة">
                      <option value="">بدون مناسبة</option>
                      {occasions.map((item) => (
                        <option key={item.id} value={item.id}>{item.title} · {item.date}</option>
                      ))}
                    </select>
                    {selected && <p className="muted">المناسبة المحددة: {selected.title} · {selected.date}</p>}
                    {occasions.length === 0 && (
                      <p className="muted">
                        لا مناسبات قادمة في تقويم الشركة.{' '}
                        <Link to="/calendar">أضف مناسبة من التقويم</Link>
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <label className="field">
              <span>وصف النص</span>
              <textarea
                ref={textRef}
                rows={3}
                dir={textDir}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="صف العبارة، مثل: تهنئة رمضانية قصيرة ودافئة للموظفين"
              />
              <p className="muted">لا تكتب العبارة النهائية. يولَّد النص من هذا الوصف ويظهر فوق التصميم.</p>
            </label>

            <button type="button" className="text-link advanced-toggle" onClick={() => setShowHelpful((open) => !open)}>
              {showHelpful ? 'إخفاء الخيارات الإضافية' : 'خيارات إضافية: المقاس، السطر الثاني، اللغة'}
            </button>
            {showHelpful && (
              <div className="stack">
                <label className="field">
                  <span>المقاس</span>
                  <select value={draft.size} onChange={(e) => setDraft({ ...draft, size: e.target.value })}>
                    {product.sizes.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>الجمهور</span>
                  <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="اختياري" />
                </label>
                <label className="field">
                  <span>سطر مساند</span>
                  <input dir={textDir} value={draft.subhead} onChange={(e) => setDraft({ ...draft, subhead: e.target.value })} />
                </label>
                <div className="tone-row" role="group" aria-label="النبرة">
                  {tones.map((item) => (
                    <button key={item} type="button" className={tone === item ? 'pick on' : 'pick'} aria-pressed={tone === item} onClick={() => setTone(item)}>
                      {item}
                    </button>
                  ))}
                </div>
                <label className="field">
                  <span>لغة النص على التصميم</span>
                  <select value={language} onChange={(e) => setLanguage(e.target.value as 'ar' | 'en')}>
                    <option value="ar">العربية</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="field">
                  <span>ملاحظة اختيارية للمولّد</span>
                  <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              </div>
            )}
          </>
        )}

        {generationError && (
          <div className="notice err" role="alert">
            <p>{generationError}</p>
            {user && (
              <button type="button" className="btn btn-secondary" disabled={generating} onClick={() => void generateArtwork()}>
                إعادة المحاولة
              </button>
            )}
          </div>
        )}

        {phase === 'compose' && (
          <div className="studio-cta">
            {!loading && !user ? (
              <Link className="btn btn-primary" to="/login" state={{ from: '/studio' }}>
                سجّل الدخول ثم ولّد
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading || generating || (!note.trim() && !selected)}
                onClick={() => void generateArtwork()}
              >
                {generating ? 'جارٍ تجهيز المعاينة…' : 'ولّد المعاينة'}
              </button>
            )}
            {!user && !loading && <p className="muted">يلزم الدخول لحفظ التصميم على حساب الشركة.</p>}
          </div>
        )}
      </section>

      <aside className="preview-panel card stack canvas" ref={previewRef} aria-live="polite" aria-busy={generating}>
        <p className="eyebrow">{generating ? 'جارٍ التوليد' : active ? 'معاينة الشاشة' : 'قبل التوليد'} · {product.name}</p>
        <p className="preview-caption">معاينة فقط. ليست ملف طباعة.</p>
        {previewError && phase === 'compose' && (
          <div className="notice err" role="alert">
            <p>{previewError}</p>
            <button type="button" className="btn btn-secondary" onClick={() => setPreviewAttempt((value) => value + 1)}>
              إعادة المحاولة
            </button>
          </div>
        )}
        <div className={`canvas-frame shape-${shapeFor(product.id)} ${generating ? 'is-busy' : ''}`}>
          {active ? (
            <div className="svg-stage" dangerouslySetInnerHTML={{ __html: active.svg }} />
          ) : liveSvg ? (
            <div className="svg-stage" dangerouslySetInnerHTML={{ __html: liveSvg }} />
          ) : (
            <PrintPreview brand={brand} product={product} draft={{ ...draft, headline, body: draft.subhead }} />
          )}
        </div>
        {active && <p className="muted">{previewSourceNote(active.backgroundKind, active.backgroundNote)}</p>}
        {active && phase === 'review' && (
          <>
            <p>الحالة: {statusLabel[active.status] || 'مسودة'}</p>
            <div className="hero-actions">
              <button type="button" className="btn btn-primary" onClick={continueToOrder}>طلب طباعة</button>
              <button type="button" className="btn btn-secondary" onClick={() => download(active, 'png')}>تنزيل معاينة PNG</button>
            </div>
            <div className="hero-actions">
              <button type="button" className="btn btn-ghost" disabled={generating} onClick={() => void generateArtwork()}>
                أعد التوليد
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => revise(active)}>عدّل النص</button>
              <button type="button" className="btn btn-ghost" onClick={() => download(active, 'svg')}>تنزيل SVG للتحرير</button>
              <button type="button" className="btn btn-ghost" onClick={() => void setStatus(active.id, 'approved')}>اعتماد المعاينة</button>
            </div>
          </>
        )}
        {saved.length > 0 && phase === 'compose' && (
          <div className="past-list">
            <p className="muted">أكمل من معاينة سابقة</p>
            {saved.slice(0, 3).map((design) => (
              <button key={design.id} type="button" className="text-link" onClick={() => resume(design)}>
                {design.headline} · {statusLabel[design.status] || 'مسودة'}
              </button>
            ))}
          </div>
        )}
      </aside>
    </div>
  )
}
