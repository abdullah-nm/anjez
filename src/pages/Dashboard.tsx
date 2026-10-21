import { Link, useNavigate } from 'react-router-dom'
import {
  events,
  formatDate,
  formatMoney,
  productById,
  products,
  recommendations,
} from '../data'
import { useStore } from '../store'

export function Dashboard() {
  const { brand, draft, setDraft, orders } = useStore()
  const navigate = useNavigate()

  function openStudio(productId: string, eventId: string) {
    const product = productById(productId)
    if (!product) return
    setDraft({
      ...draft,
      productId,
      eventId,
      size: product.sizes[0],
      headline: brand.companyName,
      subhead: events.find((event) => event.id === eventId)?.title ?? draft.subhead,
      body: brand.slogan,
    })
    navigate('/studio')
  }

  return (
    <div className="stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">مرحباً {brand.contactName}</p>
          <h1>فعاليات قادمة، وتوصيات طباعة تناسبها</h1>
          <p className="lede">
            {brand.companyName} لديها أربعة مواعيد خلال الأسابيع القادمة. اختر
            منتجاً موصى به، عدّل النص في الاستوديو، ثم أرسل طلب الطباعة.
          </p>
        </div>
        <div className="hero-actions">
          <Link className="btn btn-primary" to="/studio">
            افتح الاستوديو
          </Link>
          <Link className="btn btn-ghost" to="/brand">
            راجع الهوية
          </Link>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>المواعيد القادمة</h2>
          <p>بيانات تجريبية لشركة ضيافة في الرياض.</p>
        </div>
        <div className="event-grid">
          {events.map((event) => (
            <article key={event.id} className="card event-card">
              <p className="eyebrow">{formatDate(event.date)}</p>
              <h3>{event.title}</h3>
              <p>{event.venue}</p>
              <p className="muted">
                {event.attendees} ضيفاً · {event.audience}
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openStudio('prd-invite', event.id)}
              >
                صمّم لهذه المناسبة
              </button>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>توصيات مخصصة</h2>
          <p>ربط مباشر بين نوع الحدث والمنتج الأنسب للطباعة.</p>
        </div>
        <div className="rec-list">
          {recommendations.map((rec) => {
            const event = events.find((item) => item.id === rec.eventId)
            const product = productById(rec.productId)
            if (!event || !product) return null
            return (
              <article key={rec.id} className="card rec-card">
                <div>
                  <p className="eyebrow">{event.title}</p>
                  <h3>{product.name}</h3>
                  <p>{rec.reason}</p>
                  <p className="muted">
                    من {formatMoney(product.fromPrice)} · جاهز خلال {product.leadDays} أيام
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openStudio(product.id, event.id)}
                >
                  تخصيص التصميم
                </button>
              </article>
            )
          })}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>كتالوج سريع</h2>
        </div>
        <div className="product-row">
          {products.map((product) => (
            <article key={product.id} className="card compact">
              <h3>{product.name}</h3>
              <p>{product.summary}</p>
              <Link
                className="text-link"
                to="/studio"
                onClick={() =>
                  setDraft({
                    ...draft,
                    productId: product.id,
                    size: product.sizes[0],
                  })
                }
              >
                ابدأ بهذا المنتج
              </Link>
            </article>
          ))}
        </div>
      </section>

      {orders.length > 0 && (
        <section>
          <div className="section-head">
            <h2>آخر الطلبات</h2>
          </div>
          <ul className="order-mini">
            {orders.slice(0, 3).map((order) => (
              <li key={order.id}>
                <strong>{order.id}</strong>
                <span>{order.status}</span>
                <span>{formatDate(order.deliveryDate)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
