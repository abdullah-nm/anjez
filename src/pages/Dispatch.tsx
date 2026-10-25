import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'

type ProviderRow = {
  userId: string
  email: string
  kind: 'shop' | 'individual'
  displayName: string
  city: string
  phone: string
  services: string[]
  approval: 'pending' | 'approved' | 'rejected'
}

type OrderRow = {
  companyId: string
  companyName: string
  id: string
  productId: string
  status: string
  quantity: number
  deliveryCity: string
  serviceKey: string
  providerName: string
}

export function Dispatch() {
  const { t, statusLabel, serviceLabel, productLabel, errorText } = useI18n()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [providerResponse, orderResponse] = await Promise.all([
      fetch('/api/providers', { credentials: 'include' }),
      fetch('/api/dispatch/orders', { credentials: 'include' }),
    ])
    const providerPayload = await providerResponse.json().catch(() => null)
    const orderPayload = await orderResponse.json().catch(() => null)
    if (!providerResponse.ok || !orderResponse.ok) {
      setError(errorText(providerPayload?.code || orderPayload?.code, providerPayload?.error || orderPayload?.error))
      return
    }
    setProviders(providerPayload.providers || [])
    setOrders(orderPayload.orders || [])
  }

  useEffect(() => { void load() }, [])

  async function approve(userId: string, approval: 'approved' | 'rejected') {
    setError(null)
    const response = await fetch(`/api/providers/${userId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approval }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      setError(errorText(payload?.code, payload?.error))
      return
    }
    await load()
  }

  async function assign(order: OrderRow) {
    const providerUserId = choice[`${order.companyId}:${order.id}`]
    if (!providerUserId) return
    setError(null)
    const response = await fetch(`/api/dispatch/orders/${order.companyId}/${order.id}/assign`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerUserId }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      setError(errorText(payload?.code, payload?.error))
      return
    }
    await load()
  }

  return (
    <div className="stack">
      <header className="section-head">
        <h1>{t('dispatchTitle')}</h1>
        <p className="muted">{t('approvedOnly')}</p>
      </header>
      {error && <p className="notice err" role="alert">{error}</p>}
      <section className="stack">
        <h2>{t('pendingProviders')}</h2>
        {providers.length === 0 && <p className="muted">{t('noProviders')}</p>}
        {providers.map((provider) => (
          <article key={provider.userId} className="card stack">
            <strong>{provider.displayName}</strong>
            <p>{provider.kind === 'shop' ? t('shop') : t('individual')} · {provider.city} · {provider.phone}</p>
            <p>{provider.email}</p>
            <p>{provider.services.map(serviceLabel).join(' · ')}</p>
            <p>{t('status')}: {t(provider.approval === 'approved' ? 'approval_approved' : provider.approval === 'rejected' ? 'approval_rejected' : 'approval_pending')}</p>
            <div className="hero-actions">
              <button type="button" className="btn btn-primary" onClick={() => void approve(provider.userId, 'approved')}>{t('approve')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => void approve(provider.userId, 'rejected')}>{t('rejectProvider')}</button>
            </div>
          </article>
        ))}
      </section>
      <section className="stack">
        <h2>{t('ordersToAssign')}</h2>
        {orders.length === 0 && <p className="muted">{t('noOrders')}</p>}
        {orders.map((order) => {
          const eligible = providers.filter((provider) => provider.approval === 'approved' && provider.services.includes(order.serviceKey))
          const key = `${order.companyId}:${order.id}`
          return (
            <article key={key} className="card stack">
              <strong>{order.id}</strong>
              <p>{order.companyName} · {productLabel(order.productId, order.productId)} · {t('quantity')} {order.quantity}</p>
              <p>{t('status')}: {statusLabel(order.status)} · {serviceLabel(order.serviceKey)}</p>
              <p>{t('deliveryCity')}: {order.deliveryCity || '—'}</p>
              {order.providerName && <p>{t('providerLabel')}: {order.providerName}</p>}
              {(order.status === 'محفوظ' || order.status === 'مرفوض') && (
                <div className="hero-actions">
                  <select value={choice[key] || ''} onChange={(event) => setChoice((current) => ({ ...current, [key]: event.target.value }))} aria-label={t('assign')}>
                    <option value="">{t('providerLabel')}</option>
                    {eligible.map((provider) => <option key={provider.userId} value={provider.userId}>{provider.displayName}</option>)}
                  </select>
                  <button type="button" className="btn btn-primary" onClick={() => void assign(order)}>{t('assign')}</button>
                </div>
              )}
            </article>
          )
        })}
      </section>
    </div>
  )
}
