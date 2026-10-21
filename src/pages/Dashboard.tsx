import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { events as demoEvents, formatDate, formatMoney, productById, products, recommendations } from '../data'
import { useStore } from '../store'
import { useAuth } from '../auth'

type LiveEvent = {
  id: string
  title: string
  date: string
  audience: string
  category: string
  reminderDays: number[]
}

function remaining(ymd: string) {
  const a = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00+03:00`)
  const b = Date.parse(`${ymd}T00:00:00+03:00`)
  return Math.round((b - a) / 86400000)
}

export function Dashboard() {
  const { brand, draft, setDraft, orders } = useStore()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([])
  const [unread, setUnread] = useState(0)
  const [eventsReady, setEventsReady] = useState(false)

  useEffect(() => {
    if (!user) {
      setEventsReady(true)
      return
    }
    setEventsReady(false)
    void Promise.all([
      fetch('/api/events', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/notifications', { credentials: 'include' }).then((r) => r.json()),
    ]).then(([eventsPayload, notesPayload]) => {
      setLiveEvents(eventsPayload.events || [])
      setUnread(notesPayload.unread || 0)
      setEventsReady(true)
    })
  }, [user])

  function openStudio(productId: string, eventId: string) {
    const product = productById(productId)
    if (!product) return
    const live = liveEvents.find((item) => item.id === eventId)
    const demo = demoEvents.find((item) => item.id === eventId)
    setDraft({
      ...draft,
      productId,
      eventId,
      size: product.sizes[0],
      headline: brand.companyName,
      subhead: live?.title || demo?.title || draft.subhead,
      body: brand.slogan,
    })
    navigate(`/studio?eventId=${eventId}`)
  }

  const upcoming = (user ? liveEvents : demoEvents.map((event) => ({
    id: event.id,
    title: event.title,
    date: event.date,
    audience: event.audience,
    category: event.kind,
    reminderDays: [7, 1],
  }))).filter((event) => remaining(event.date) >= -1).slice(0, 6)

  if (loading || (user && !eventsReady)) return <p>جارٍ التحميل…</p>

  return (
    <div className="stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">مرحباً {brand.contactName}</p>
          <h1>الهوية، ثم المناسبات، ثم التصميم المطبوع</h1>
          <p className="lede">
            اضبط عدة الهوية، أضف مناسبات الشركة، راقب التذكير، ثم ولّد تصميماً يحمل الشعار والألوان.
          </p>
        </div>
        <div className="hero-actions">
          <Link className="btn btn-primary" to="/studio">استوديو التصميم</Link>
          <Link className="btn btn-ghost" to="/brand">عدة الهوية</Link>
          <Link className="btn btn-ghost" to="/calendar">التقويم</Link>
        </div>
      </section>

      {user && unread > 0 && (
        <p className="notice">
          لديك {unread} تنبيه غير مقروء. <Link to="/notifications">مركز التنبيهات</Link>
        </p>
      )}
      {!user && <p className="muted">المواعيد أدناه من كتالوج تجريبي حتى تسجّل الدخول.</p>}

      <section>
        <div className="section-head">
          <h2>أقرب المناسبات</h2>
        </div>
        <div className="event-grid">
          {upcoming.length === 0 && <p className="muted">لا مناسبات قادمة. أضف من التقويم.</p>}
          {upcoming.map((event) => {
            const days = remaining(event.date)
            const productId = event.category === 'national' || event.category === 'islamic' ? 'prd-poster' : 'prd-invite'
            const product = productById(productId)
            return (
              <article key={event.id} className="card event-card">
                <p className="eyebrow">{formatDate(event.date)}</p>
                <h3>{event.title}</h3>
                <p>{days >= 0 ? `متبقي ${days} يوم` : 'اليوم أو فات الموعد'}</p>
                <p className="muted">تذكير قبل {event.reminderDays.join('، ')} يوم · مقترح: {product?.name}</p>
                <button type="button" className="btn btn-secondary" onClick={() => openStudio(productId, event.id)}>
                  ولّد تصاميم لهذه المناسبة
                </button>
              </article>
            )
          })}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>توصيات منتجات (بدون أسعار مخترعة للطلب)</h2>
        </div>
        <div className="rec-list">
          {recommendations.map((rec) => {
            const event = demoEvents.find((item) => item.id === rec.eventId)
            const product = productById(rec.productId)
            if (!event || !product) return null
            return (
              <article key={rec.id} className="card rec-card">
                <div>
                  <p className="eyebrow">{event.title}</p>
                  <h3>{product.name}</h3>
                  <p>{rec.reason}</p>
                  <p className="muted">سعر كتالوج استرشادي {formatMoney(product.fromPrice)} — ليس عرض تنفيذ.</p>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => openStudio(product.id, event.id)}>تخصيص</button>
              </article>
            )
          })}
        </div>
      </section>

      <section>
        <div className="product-row">
          {products.map((product) => (
            <article key={product.id} className="card compact">
              <h3>{product.name}</h3>
              <p>{product.summary}</p>
              <Link className="text-link" to="/studio" onClick={() => setDraft({ ...draft, productId: product.id, size: product.sizes[0] })}>ابدأ بهذا المنتج</Link>
            </article>
          ))}
        </div>
      </section>

      {orders.length > 0 && (
        <ul className="order-mini">
          {orders.slice(0, 3).map((order) => (
            <li key={order.id}><strong>{order.id}</strong><span>{order.status}</span></li>
          ))}
        </ul>
      )}
    </div>
  )
}
