import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'

type Profile = {
  kind: 'shop' | 'individual'
  displayName: string
  city: string
  phone: string
  services: string[]
  approval: 'pending' | 'approved' | 'rejected'
  email: string
}

type OrderRow = {
  companyId: string
  companyName: string
  id: string
  productId: string
  status: string
  quantity: number
  deliveryDate: string
  deliveryCity: string
  statusNote: string
  events: { id: string, toStatus: string, note: string, createdAt: string }[]
}

const SERVICES = ['print', 'install', 'gifts', 'signage'] as const

export function ProviderDesk() {
  const { refresh } = useAuth()
  const { t, serviceLabel, statusLabel, productLabel, formatDate, formatDateTime, errorText, cityLabel } = useI18n()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const [profileResponse, orderResponse] = await Promise.all([
      fetch('/api/provider/me', { credentials: 'include' }),
      fetch('/api/provider/orders', { credentials: 'include' }),
    ])
    const profilePayload = await profileResponse.json().catch(() => null)
    const orderPayload = await orderResponse.json().catch(() => null)
    if (profileResponse.ok) setProfile(profilePayload.profile)
    else setError(errorText(profilePayload?.code, profilePayload?.error))
    if (orderResponse.ok) setOrders(orderPayload.orders || [])
  }

  useEffect(() => { void load() }, [])

  function toggle(id: string) {
    setProfile((current) => current ? { ...current, services: current.services.includes(id) ? current.services.filter((item) => item !== id) : [...current.services, id] } : current)
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!profile) return
    setBusy(true)
    setMessage(null)
    setError(null)
    const response = await fetch('/api/provider/me', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    })
    const payload = await response.json().catch(() => null)
    setBusy(false)
    if (!response.ok) {
      setError(errorText(payload?.code, payload?.error))
      return
    }
    setProfile(payload.profile)
    setMessage(t('profileSaved'))
    await refresh()
  }

  async function act(order: OrderRow, action: 'accept' | 'reject' | 'start' | 'complete') {
    setError(null)
    const response = await fetch(`/api/provider/orders/${order.companyId}/${order.id}/transition`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note: action === 'reject' ? note : '' }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      setError(errorText(payload?.code, payload?.error))
      return
    }
    await load()
  }

  if (!profile) return <p>{error || t('loading')}</p>

  return (
    <div className="stack">
      <header className="section-head">
        <h1>{t('navProvider')}</h1>
        {profile.approval === 'pending' && <p className="notice">{t('providerWaiting')}</p>}
        {profile.approval === 'rejected' && <p className="notice err">{t('providerRejected')}</p>}
      </header>
      <form className="card stack" onSubmit={saveProfile}>
        <label className="field">
          <span>{t('providerKind')}</span>
          <select value={profile.kind} onChange={(event) => setProfile({ ...profile, kind: event.target.value as Profile['kind'] })}>
            <option value="shop">{t('shop')}</option>
            <option value="individual">{t('individual')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('activityName')}</span>
          <input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} required />
        </label>
        <label className="field">
          <span>{t('city')}</span>
          <input value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} required />
        </label>
        <label className="field">
          <span>{t('phone')}</span>
          <input value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} required />
        </label>
        <fieldset className="field">
          <legend>{t('services')}</legend>
          {SERVICES.map((id) => (
            <label key={id} className="check-row">
              <input type="checkbox" checked={profile.services.includes(id)} onChange={() => toggle(id)} />
              <span>{serviceLabel(id)}</span>
            </label>
          ))}
        </fieldset>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? t('saving') : t('save')}</button>
        {message && <p className="notice">{message}</p>}
      </form>
      <section className="stack">
        <h2>{t('assignedOrders')}</h2>
        {orders.length === 0 && <p className="muted">{t('noAssigned')}</p>}
        {orders.map((order) => (
          <article key={`${order.companyId}-${order.id}`} className="card stack">
            <strong>{order.id}</strong>
            <p>{order.companyName} · {productLabel(order.productId, order.productId)} · {t('quantity')} {order.quantity}</p>
            <p>{t('status')}: {statusLabel(order.status)}</p>
            <p>{t('deliveryCity')}: {order.deliveryCity ? cityLabel(order.deliveryCity) : '—'} · {formatDate(order.deliveryDate)}</p>
            {order.events.length > 0 && (
              <ul>
                {order.events.map((event) => <li key={event.id}>{statusLabel(event.toStatus)} · {formatDateTime(event.createdAt)}{event.note ? ` · ${event.note}` : ''}</li>)}
              </ul>
            )}
            {order.status === 'مسند' && (
              <div className="hero-actions">
                <button type="button" className="btn btn-primary" onClick={() => void act(order, 'accept')}>{t('accept')}</button>
                <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('rejectNote')} aria-label={t('rejectNote')} />
                <button type="button" className="btn btn-ghost" onClick={() => void act(order, 'reject')}>{t('reject')}</button>
              </div>
            )}
            {order.status === 'مقبول' && <button type="button" className="btn btn-primary" onClick={() => void act(order, 'start')}>{t('startWork')}</button>}
            {order.status === 'قيد التنفيذ' && <button type="button" className="btn btn-primary" onClick={() => void act(order, 'complete')}>{t('completeWork')}</button>}
          </article>
        ))}
        {error && <p className="notice err" role="alert">{error}</p>}
      </section>
    </div>
  )
}
