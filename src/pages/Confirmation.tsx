import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { eventById, productById } from '../data'
import { useI18n } from '../i18n'
import { useStore } from '../store'

export function Confirmation() {
  const { orderId } = useParams()
  const { orders, brand } = useStore()
  const { user } = useAuth()
  const { t, statusLabel, productLabel, formatDate, formatNumber, formatDateTime } = useI18n()
  const companyName = user?.companyName || brand.companyName
  const contactName = user?.name || brand.contactName
  const order = orders.find((item) => item.id === orderId)

  if (!order) {
    return (
      <div className="stack form-narrow">
        <h1>{t('missingOrder')}</h1>
        <p>{t('missingOrderHint')}</p>
        <Link className="btn btn-primary" to="/order">{t('backToOrder')}</Link>
      </div>
    )
  }

  const product = productById(order.productId)
  const event = eventById(order.eventId)

  return (
    <div className="stack form-narrow">
      <div className="section-head">
        <h1>{t('savedOrder', { id: order.id })}</h1>
      </div>
      <article className="card">
        <p>{t('status')}: <strong>{statusLabel(order.status)}</strong></p>
        <p>{t('companyLine', { company: companyName, contact: contactName })}</p>
        <p>{t('productBits', { product: productLabel(order.productId, product?.name || order.productId), size: order.size })}</p>
        <p>{t('occasion')}: {order.eventTitle || event?.title || t('noOccasion')}</p>
        <p className="muted">{t('notPrintFile')}</p>
        {order.providerName && <p>{t('providerLabel')}: {order.providerName}</p>}
        <p>{t('quantity')}: {formatNumber(order.quantity)}</p>
        <p>{t('deliveryDate')}: {formatDate(order.deliveryDate)}</p>
        {order.deliveryCity && <p>{t('deliveryCity')}: {order.deliveryCity}</p>}
        <p>{order.address}</p>
        {order.notes && <p>{t('printNotes')}: {order.notes}</p>}
        {order.events && order.events.length > 0 && (
          <>
            <h2>{t('updates')}</h2>
            <ul>
              {order.events.map((eventItem) => (
                <li key={eventItem.id}>{statusLabel(eventItem.toStatus)} · {formatDateTime(eventItem.createdAt)}{eventItem.note ? ` · ${eventItem.note}` : ''}</li>
              ))}
            </ul>
          </>
        )}
      </article>
      <div className="hero-actions">
        <Link className="btn btn-primary" to="/studio">{t('anotherDesign')}</Link>
        <Link className="btn btn-ghost" to="/home">{t('toHome')}</Link>
      </div>
    </div>
  )
}
