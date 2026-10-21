import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { eventById, events, formatMoney, productById, products } from '../data'
import { PrintPreview } from '../components/PrintPreview'
import { useStore } from '../store'

export function Order() {
  const { brand, draft, placeOrder } = useStore()
  const navigate = useNavigate()
  const product = productById(draft.productId) ?? products[0]
  const event = eventById(draft.eventId) ?? events[0]
  const [quantity, setQuantity] = useState(100)
  const [deliveryDate, setDeliveryDate] = useState(event.date)
  const [address, setAddress] = useState(
    `قاعة الاستلام — ${event.venue}، ${brand.city}`,
  )
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const estimate = Math.round(product.fromPrice * quantity * 10) / 10

  function onSubmit(formEvent: FormEvent) {
    formEvent.preventDefault()
    setError(null)
    const order = placeOrder({
      productId: product.id,
      eventId: event.id,
      size: draft.size,
      quantity,
      deliveryDate,
      address,
      notes,
      headline: draft.headline,
      subhead: draft.subhead,
      body: draft.body,
    })
    if (!order) {
      setError('لم يُحفظ الطلب. لم يتم تأكيد الإرسال.')
      return
    }
    navigate(`/order/${order.id}`)
  }

  return (
    <form className="studio" onSubmit={onSubmit}>
      <section className="stack">
        <div className="section-head">
          <p className="eyebrow">طلب طباعة</p>
          <h1>راجع التصميم وأكمل بيانات التسليم</h1>
        </div>

        <p>
          المنتج: <strong>{product.name}</strong> · المناسبة:{' '}
          <strong>{event.title}</strong>
        </p>

        <label className="field">
          <span>الكمية</span>
          <input
            type="number"
            min={10}
            step={10}
            required
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>تاريخ التسليم المطلوب</span>
          <input
            type="date"
            required
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </label>
        <label className="field">
          <span>عنوان التسليم</span>
          <textarea
            required
            rows={3}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <label className="field">
          <span>ملاحظات للطباعة</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثل: لمسة ذهبية على الاسم فقط"
          />
        </label>

        <p className="estimate">
          تقدير مبدئي: {formatMoney(estimate)} · مدة التجهيز المعتادة{' '}
          {product.leadDays} أيام عمل
        </p>

        <button type="submit" className="btn btn-primary">
          إرسال طلب الطباعة
        </button>
        {error && <p className="notice err">{error}</p>}
      </section>

      <aside className="preview-panel card">
        <p className="eyebrow">ملخص التصميم</p>
        <PrintPreview brand={brand} product={product} draft={draft} />
        <p className="muted">
          الطلب يُحفظ على هذا الجهاز للعرض التجريبي، دون إرسال لمطبعة حقيقية.
        </p>
      </aside>
    </form>
  )
}
