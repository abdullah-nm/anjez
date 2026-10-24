import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { eventById, formatDate, productById } from '../data'
import { useStore } from '../store'

export function Confirmation() {
  const { orderId } = useParams()
  const { orders, brand } = useStore()
  const { user } = useAuth()
  const companyName = user?.companyName || brand.companyName
  const contactName = user?.name || brand.contactName
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
        <h1>حُفظ {order.id}</h1>
      </div>
      <article className="card">
        <p>
          الحالة: <strong>{order.status}</strong>
        </p>
        <p>
          الشركة: {companyName} · {contactName}
        </p>
        <p>المنتج: {product?.name} · المقاس {order.size}</p>
        <p>المناسبة: {order.eventTitle || event?.title || 'بدون مناسبة'}</p>
        <p className="muted">لم يُرسل الطلب إلى مطبعة، والتصميم المرفق معاينة وليست ملفاً جاهزاً للطباعة.</p>
        <p>الكمية: {order.quantity}</p>
        <p>التسليم: {formatDate(order.deliveryDate)}</p>
        {order.deliveryCity && <p>مدينة التسليم: {order.deliveryCity}</p>}
        <p>{order.address}</p>
        {order.notes && <p>ملاحظات: {order.notes}</p>}
      </article>
      <div className="hero-actions">
        <Link className="btn btn-primary" to="/studio">
          تصميم آخر
        </Link>
        <Link className="btn btn-ghost" to="/home">
          إلى اللوحة
        </Link>
      </div>
    </div>
  )
}
