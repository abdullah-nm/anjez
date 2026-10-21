import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { eventById, formatMoney, productById, products } from '../data'
import { PrintPreview } from '../components/PrintPreview'
import { useStore } from '../store'

function defaultDelivery(leadDays: number, eventDate?: string) {
  if (eventDate) return eventDate
  const next = new Date()
  next.setDate(next.getDate() + leadDays)
  return next.toISOString().slice(0, 10)
}

export function Order() {
  const { brand, draft, placeOrder } = useStore()
  const navigate = useNavigate()
  const product = productById(draft.productId) ?? products[0]
  const catalogEvent = eventById(draft.eventId)
  const eventTitle = draft.eventTitle || catalogEvent?.title || 'بدون مناسبة'
  const [quantity, setQuantity] = useState(100)
  const [deliveryDate, setDeliveryDate] = useState(() => defaultDelivery(product.leadDays, catalogEvent?.date))
  const [address, setAddress] = useState(brand.city || '')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  function onSubmit(formEvent: FormEvent) {
    formEvent.preventDefault()
    setError(null)
    const order = placeOrder({
      productId: product.id,
      eventId: draft.eventId,
      size: draft.size,
      quantity,
      deliveryDate,
      address,
      notes,
      headline: draft.headline,
      subhead: draft.subhead,
      body: draft.body,
      eventTitle,
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
          <h1>طلب الطباعة</h1>
        </div>

        <p>
          المنتج: <strong>{product.name}</strong> · المقاس: <strong>{draft.size}</strong> · المناسبة: <strong>{eventTitle}</strong>
        </p>
        {!draft.generatedImageDataUrl && (
          <p className="notice">
            لا توجد معاينة مولَّدة بعد. يمكنك <Link to="/studio">العودة للاستوديو</Link> أو حفظ الطلب بالنص الحالي.
          </p>
        )}
        <p className="preview-caption">المعاينة ليست ملف طباعة.</p>

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

        <p className="muted">
          سعر الكتالوج للوحدة {formatMoney(product.fromPrice)} للاستئناس فقط، وليس عرض مطبعة.
          المدة المعتادة في الكتالوج {product.leadDays} أيام عمل.
        </p>

        <button type="submit" className="btn btn-primary">
          حفظ طلب المراجعة
        </button>
        {error && <p className="notice err">{error}</p>}
      </section>

      <aside className="preview-panel card stack">
        <p className="eyebrow">معاينة الشاشة · ليست ملف طباعة</p>
        <PrintPreview brand={brand} product={product} draft={draft} />
        <p className="muted">يُحفظ الطلب على هذا الجهاز دون إرسال إلى مطبعة.</p>
      </aside>
    </form>
  )
}
