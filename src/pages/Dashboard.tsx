import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { productById } from '../data'
import { draftHasWork, prefillFromOccasion } from '../occasionPrefill'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'

type LiveEvent = {
  id: string
  title: string
  date: string | null
  audience: string
  category: string
  reminderDays: number[]
  scope: 'company' | 'system'
  dateCertainty?: string
  occasionKey?: string | null
}

function remaining(ymd: string) {
  const a = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00+03:00`)
  const b = Date.parse(`${ymd}T00:00:00+03:00`)
  return Math.round((b - a) / 86400000)
}

export function Dashboard() {
  const { t, formatDate, productLabel, statusLabel, countText, occasionLabel } = useI18n()
  const { draft, setDraft, orders } = useStore()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([])
  const [unread, setUnread] = useState(0)
  const [eventsReady, setEventsReady] = useState(false)
  const [eventsError, setEventsError] = useState(false)
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setEventsReady(false)
    setEventsError(false)
    void (async () => {
      try {
        const [eventsResponse, notesResponse] = await Promise.all([
          fetch('/api/events', { credentials: 'include' }),
          fetch('/api/notifications', { credentials: 'include' }),
        ])
        if (!eventsResponse.ok || !notesResponse.ok) throw new Error('load')
        const eventsPayload = await eventsResponse.json()
        const notesPayload = await notesResponse.json()
        if (cancelled) return
        const company = (eventsPayload.events || []).map((event: LiveEvent) => ({
          ...event,
          audience: event.audience || '',
          scope: 'company' as const,
        }))
        const system = (eventsPayload.systemOccasions || []).filter((event: { date: string | null }) => event.date).map((event: {
          id: string
          title?: string
          titleAr?: string
          key?: string
          date: string
          category: string
          dateCertainty?: string
        }) => ({
          id: event.id,
          title: event.titleAr || event.title || '',
          occasionKey: event.key || null,
          date: event.date,
          audience: '',
          category: event.category,
          reminderDays: event.dateCertainty === 'official' ? [30, 14, 7, 3, 1] : [],
          scope: 'system' as const,
          dateCertainty: event.dateCertainty,
        }))
        setLiveEvents([...company, ...system])
        setUnread(notesPayload.unread || 0)
        setEventsReady(true)
      } catch (error) {
        if (cancelled) return
        setEventsError(true)
        setEventsReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, loadKey])

  function openStudio(event: LiveEvent) {
    const next = prefillFromOccasion({
      id: event.id,
      title: event.title,
      date: event.date,
      dateOfficial: event.dateCertainty === 'official',
      audience: event.audience,
      category: event.category,
      companyName: user?.companyName || '',
    })
    const product = productById(next.productId) ?? productById('prd-poster')
    if (!product) return
    if (draftHasWork(draft) && draft.eventId !== event.id) {
      const replace = window.confirm(t('replaceDraft'))
      if (!replace) return
    }
    setDraft({
      productId: product.id,
      eventId: event.id,
      eventTitle: next.eventTitle,
      size: product.sizes[0],
      headline: next.headline,
      subhead: next.subhead,
      body: next.body,
    })
    navigate(`/studio?eventId=${encodeURIComponent(event.id)}`, { state: { prefill: next } })
  }

  const upcoming = liveEvents
    .filter((event) => event.date && remaining(event.date) >= -1)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 6)

  if (loading || !eventsReady) return <p>{t('loading')}</p>

  return (
    <div className="stack">
      <section className="section-head">
        <h1>{t('designNew')}</h1>
        <Link className="btn btn-primary" to="/studio">{t('start')}</Link>
      </section>

      {unread > 0 && (
        <p className="notice">
          {countText('unreadAlerts', unread)} <Link to="/notifications">{t('navAlerts')}</Link>
        </p>
      )}

      <section>
        <div className="section-head">
          <h2>{t('upcoming')}</h2>
        </div>
        {eventsError ? (
          <div className="notice err" role="alert">
            <p>{t('loadEventsFailed')}</p>
            <button type="button" className="btn btn-secondary" onClick={() => setLoadKey((value) => value + 1)}>
              {t('retry')}
            </button>
          </div>
        ) : (
        <div className="event-grid">
          {upcoming.length === 0 && <p className="muted">{t('noUpcoming')}</p>}
          {upcoming.map((event) => {
            if (!event.date) return null
            const days = remaining(event.date)
            const product = productById(event.category === 'national' || event.category === 'islamic' || event.category === 'season' ? 'prd-poster' : 'prd-invite')
            return (
              <article key={event.id} className="card event-card">
                <p className="eyebrow">{formatDate(event.date)}</p>
                <h3>{event.scope === 'system' ? occasionLabel(event.occasionKey, event.title) : event.title}</h3>
                <p>{days >= 0 ? countText('daysLeft', days) : t('dueOrPast')}</p>
                <p className="muted">
                  {event.scope === 'system' ? t('publicOccasion') : t('companyOccasion')}
                  {event.dateCertainty === 'estimated' ? ` · ${t('estimated')}` : ''}
                  {event.dateCertainty === 'unannounced' ? ` · ${t('unannounced')}` : ''}
                  {event.reminderDays.length ? ` · ${t('reminderBefore', { days: event.reminderDays.join(' · ') })}` : ` · ${t('noReminderUntil')}`}
                  {` · ${t('suggested')}: `}{product ? productLabel(product.id, product.name) : ''}
                </p>
                <button type="button" className="btn btn-secondary" onClick={() => openStudio(event)}>
                  {t('designForOccasion')}
                </button>
              </article>
            )
          })}
        </div>
        )}
      </section>

      {orders.length > 0 && (
        <ul className="order-mini">
          {orders.slice(0, 3).map((order) => (
            <li key={order.id}><strong>{order.id}</strong><span>{statusLabel(order.status)}</span></li>
          ))}
        </ul>
      )}
    </div>
  )
}
