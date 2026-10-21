import { Link, useParams } from 'react-router-dom'
import { eventById, formatDate, productById } from '../data'
import { useStore } from '../store'

export function Confirmation() {
  const { orderId } = useParams()
  const { orders, brand } = useStore()
  const order = orders.find((item) => item.id === orderId)

  if (!order) {
    return (
      <div className="stack form-narrow">
        <h1>لا يوجد طلب بهذا الرقم</h1>
        <p>ربما فُتح الرابط على جهاز آخر، أو لم يُحفظ الطلب بعد.</p>
        <Link className="btn btn-primary" to="/order">
          العودة لنموذج الطلب
        </Link>
      </div>
    )
  }

  const product = productById(order.productId)
  const event = eventById(order.eventId)

  return (
    <div className="stack form-narrow">
      <div className="section-head">
        <p className="eyebrow">تأكيد الطلب</p>
        <h1>تم حفظ طلب {order.id}</h1>
      </div>
      <article className="card">
        <p>
          الحالة: <strong>{order.status}</strong>
        </p>
        <p>
          الشركة: {brand.companyName} · {brand.contactName}
        </p>
        <p>المنتج: {product?.name} · المقاس {order.size}</p>
        <p>المناسبة: {event?.title}</p>
        <p>الكمية: {order.quantity}</p>
        <p>التسليم: {formatDate(order.deliveryDate)}</p>
        <p>{order.address}</p>
        {order.notes && <p>ملاحظات: {order.notes}</p>}
      </article>
      <div className="hero-actions">
        <Link className="btn btn-primary" to="/">
          إلى لوحة الشركة
        </Link>
        <Link className="btn btn-ghost" to="/studio">
          تصميم منتج آخر
        </Link>
      </div>
    </div>
  )
}
