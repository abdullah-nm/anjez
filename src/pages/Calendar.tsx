import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { DateField } from '../components/DateField'
import { useI18n, type MessageKey } from '../i18n'
type Certainty = 'official' | 'estimated' | 'unannounced'

type EventRow = {
  id: string
  title: string
  date: string | null
  time: string | null
  description: string
  category: string
  audience: string
  status: string
  reminderDays: number[]
  occasionKey: string | null
  recurring: boolean
  dateCertainty: Certainty
  dateNote: string
}

type SystemOccasion = {
  id: string
  key: string
  titleAr: string
  date: string | null
  category: 'national' | 'islamic' | 'season'
  dateNote: string
  dateCertainty: Certainty
  source: string
  checkedAt: string | null
  syncStatus: 'ok' | 'stale'
  recurring: boolean
  history: Array<{ date: string | null, cycle: string, dateCertainty: Certainty }>
}

type SyncState = {
  status: 'ok' | 'stale'
  message: string
  checkedAt: string | null
  attemptedAt: string | null
  source: string
}

const reminderChoices = [30, 14, 7, 3, 1]
const emptyForm = {
  title: '',
  date: '',
  time: '',
  description: '',
  category: 'custom',
  audience: '',
  status: 'planned',
  reminderDays: [...reminderChoices] as number[],
}

const categoryKey: Record<string, MessageKey> = {
  national: 'catNational',
  islamic: 'catIslamic',
  season: 'catSeason',
  custom: 'catCustom',
  conference: 'catConference',
  launch: 'catLaunch',
  internal: 'catInternal',
}

const certaintyKey: Record<Certainty, MessageKey> = {
  official: 'official',
  estimated: 'estimated',
  unannounced: 'unannounced',
}

const noteKey: Record<string, MessageKey> = {
  national: 'noteFixed',
  islamic: 'noteHijri',
  season: 'noteSeason',
}

function riyadhParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function CalendarPage() {
  const { user, loading } = useAuth()
  const { t, formatDateTime, errorText, monthTitle, weekdayLabels, monthNames, occasionLabel } = useI18n()
  const location = useLocation()
  const [params] = useSearchParams()
  const today = riyadhParts()
  const [events, setEvents] = useState<EventRow[]>([])
  const [systemOccasions, setSystemOccasions] = useState<SystemOccasion[]>([])
  const [sync, setSync] = useState<SyncState | null>(null)
  const [view, setView] = useState<'month' | 'week' | 'year' | 'list'>('month')
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState(today.year)
  const [month, setMonth] = useState(today.month)
  const [annual, setAnnual] = useState<Record<string, { date: string, certainty: 'official' | 'estimated' }>>({})

  useEffect(() => {
    if (!user) return
    void reload()
  }, [user])

  async function reload() {
    const response = await fetch('/api/events', { credentials: 'include' })
    const body = await response.json()
    setEvents(body.events || [])
    setSystemOccasions(body.systemOccasions || [])
    setSync(body.calendarSync || null)
  }

  if (loading) return <p>{t('loading')}</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstWeekday = new Date(`${year}-${pad(month)}-01T12:00:00+03:00`).getUTCDay()
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => index - firstWeekday + 1)
  const query = params.get('q')
  const visible = events.filter((event) => !query || `${event.title} ${event.category}`.includes(query))
  const dated = visible.filter((event) => event.date && event.status !== 'done')
  const undated = visible.filter((event) => !event.date && event.status !== 'done')
  const history = visible.filter((event) => event.status === 'done')
  const systemDated = systemOccasions.filter((item) => item.date)

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1))
    setYear(next.getUTCFullYear())
    setMonth(next.getUTCMonth() + 1)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const response = await fetch(editing ? `/api/events/${editing}` : '/api/events', {
      method: editing ? 'PUT' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, time: form.time || null, date: form.date || null }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(errorText(body.code, t('saveEventFailed')))
      return
    }
    setForm(emptyForm)
    setEditing(null)
    await reload()
  }

  async function saveAnnual(eventId: string) {
    const draft = annual[eventId]
    if (!draft?.date) return
    setError(null)
    const response = await fetch(`/api/events/${eventId}/annual-date`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(errorText(body.code, t('updateDateFailed')))
      return
    }
    await reload()
  }

  const weekStart = `${year}-${pad(month)}-${pad(today.month === month && today.year === year ? today.day : 1)}`
  const weekEvents = [...dated, ...systemDated.map((item) => ({ id: item.id, title: occasionLabel(item.key, item.titleAr), date: item.date, dateCertainty: item.dateCertainty }))].filter((event) => {
    if (!event.date) return false
    const anchor = new Date(`${weekStart}T12:00:00+03:00`)
    const day = anchor.getUTCDay()
    const start = new Date(anchor)
    start.setUTCDate(anchor.getUTCDate() - day)
    const end = new Date(start)
    end.setUTCDate(start.getUTCDate() + 7)
    const current = new Date(`${event.date}T12:00:00+03:00`)
    return current >= start && current < end
  })

  function eventButton(event: EventRow) {
    return (
      <button
        key={event.id}
        type="button"
        className={`cal-event cal-${event.dateCertainty}`}
        onClick={() => {
          setEditing(event.id)
          setForm({
            title: event.title,
            date: event.date || '',
            time: event.time || '',
            description: event.description,
            category: event.category,
            audience: event.audience,
            status: event.status,
            reminderDays: event.reminderDays,
          })
        }}
      >
        {event.title}
      </button>
    )
  }

  const groups = [
    { id: 'national', title: t('catNational') },
    { id: 'islamic', title: t('catIslamic') },
    { id: 'season', title: t('catSeason') },
  ] as const
  const todayYmd = `${today.year}-${pad(today.month)}-${pad(today.day)}`

  return (
    <div className="stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">{t('calEyebrow')}</p>
          <h1>{t('calendarTitle')}</h1>
        </div>
        <div className="hero-actions">
          <button type="button" className="btn btn-ghost" onClick={() => { setYear(today.year); setMonth(today.month); setView('month') }}>{t('goToday')}</button>
          <button type="button" className={view === 'week' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setView('week')}>{t('week')}</button>
          <button type="button" className={view === 'month' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setView('month')}>{t('month')}</button>
          <button type="button" className={view === 'year' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setView('year')}>{t('year')}</button>
          <button type="button" className={view === 'list' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setView('list')}>{t('list')}</button>
        </div>
      </div>
      <p className="muted">{t('calIntro')}</p>
      {sync?.status === 'stale' && (
        <p className="notice" role="status">
          {t('hijriStale')} {sync.checkedAt ? t('lastSuccess', { time: formatDateTime(sync.checkedAt) }) : ''}
        </p>
      )}

      <div className="hero-actions">
        <button type="button" className="btn btn-ghost" onClick={() => shiftMonth(-1)}>{t('previousMonth')}</button>
        <strong>{monthTitle(year, month)}</strong>
        <button type="button" className="btn btn-ghost" onClick={() => shiftMonth(1)}>{t('nextMonth')}</button>
      </div>

      {view === 'month' && (
        <div className="cal-grid" aria-label={t('weekdayLabel')}>
          {weekdayLabels().map((name) => <div key={name} className="cal-head">{name}</div>)}
          {cells.map((day, index) => {
            const ymd = day > 0 ? `${year}-${pad(month)}-${pad(day)}` : ''
            const dayEvents = dated.filter((event) => event.date === ymd)
            const daySystem = systemDated.filter((item) => item.date === ymd)
            return (
              <div key={index} className={ymd === todayYmd ? 'cal-cell cal-today' : 'cal-cell'}>
                {day > 0 && <strong>{day}</strong>}
                {dayEvents.map(eventButton)}
                {daySystem.map((item) => (
                  <span key={item.id} className={`cal-event cal-system cal-${item.dateCertainty}`}>{occasionLabel(item.key, item.titleAr)}</span>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {view === 'week' && (
        <ul className="order-mini">
          {weekEvents.length === 0 && <li>{t('noWeekEvents')}</li>}
          {weekEvents.map((event) => (
            <li key={event.id}>{event.date} · {event.title} · {t(certaintyKey[event.dateCertainty])}</li>
          ))}
        </ul>
      )}

      {view === 'year' && (
        <div className="grid-2">
          {monthNames().map((name, index) => (
            <button key={name} type="button" className={index + 1 === month ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => { setMonth(index + 1); setView('month') }}>{name} {year}</button>
          ))}
        </div>
      )}

      {view === 'list' && (
        <div className="stack">
          {dated.length === 0 && systemDated.length === 0 && undated.length === 0 && <p className="muted">{t('noOpenEvents')}</p>}
          {dated.map((event) => (
            <EventCard key={event.id} event={event} onReload={reload} annual={annual} setAnnual={setAnnual} onAnnual={saveAnnual} />
          ))}
        </div>
      )}

      {undated.length > 0 && (
        <section className="stack">
          <h2>{t('waitingDate')}</h2>
          {undated.map((event) => (
            <EventCard key={event.id} event={event} onReload={reload} annual={annual} setAnnual={setAnnual} onAnnual={saveAnnual} />
          ))}
        </section>
      )}

      {history.length > 0 && (
        <section className="stack">
          <h2>{t('pastLog')}</h2>
          {history.map((event) => (
            <article key={event.id} className="card rec-card">
              <div>
                <p className="eyebrow">{event.date} · {t(certaintyKey[event.dateCertainty])}</p>
                <h3>{event.title}</h3>
                <p className="muted">{event.dateNote}</p>
              </div>
            </article>
          ))}
        </section>
      )}

      <form className="card stack" onSubmit={save}>
        <h2>{editing ? t('editEvent') : t('newEvent')}</h2>
        <div className="grid-2">
          <label className="field"><span>{t('title')}</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="field"><span>{t('date')}</span><DateField required value={form.date} onChange={(date) => setForm({ ...form, date })} /></label>
          <label className="field"><span>{t('timeOptional')}</span><input placeholder="14:30" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} /></label>
          <label className="field"><span>{t('category')}</span>
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {Object.entries(categoryKey).map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
            </select>
          </label>
        </div>
        <label className="field"><span>{t('audience')}</span><input value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} /></label>
        <label className="field"><span>{t('description')}</span><textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <fieldset className="field">
          <legend>{t('reminderLegend')}</legend>
          <div className="tone-row">
            {reminderChoices.map((day) => (
              <label key={day} className="tone">
                <input
                  type="checkbox"
                  checked={form.reminderDays.includes(day)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      reminderDays: event.target.checked
                        ? [...form.reminderDays, day]
                        : form.reminderDays.filter((item) => item !== day),
                    })
                  }
                />
                {t('reminderBefore', { days: day })}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="hero-actions">
          <button className="btn btn-primary" type="submit">{t('save')}</button>
          {editing && <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setForm(emptyForm) }}>{t('cancel')}</button>}
        </div>
        {error && <p className="notice err">{error}</p>}
      </form>

      <section className="stack">
        <h2>{t('systemOccasions')}</h2>
        <p className="muted">{t('systemOccasionNote')}</p>
        {groups.map((group) => (
          <div key={group.id} className="stack">
            <h3>{group.title}</h3>
            {systemOccasions.filter((item) => item.category === group.id).map((item) => (
              <article key={item.key} className={`card rec-card cal-system-card cal-cat-${item.category}`}>
                <div>
                  <p className="eyebrow">
                    <span className={`cal-badge cal-badge-${item.dateCertainty}`}>{t(certaintyKey[item.dateCertainty])}</span>
                    <span className="cal-badge">{t(categoryKey[item.category])}</span>
                    {t('publicOccasion')}
                  </p>
                  <h3>{occasionLabel(item.key, item.titleAr)}</h3>
                  <p>{item.date || t('awaitingOfficial')}</p>
                  <p className="muted">{t('sourceLine', { source: item.source === 'umalqura' ? t('hijriSource') : item.source === 'fixed-gregorian' ? t('fixedSource') : item.source === 'admin-after-announcement' ? t('seasonSource') : item.source })}</p>
                  <p className="muted">{t('lastCheckLine', { time: item.checkedAt ? formatDateTime(item.checkedAt) : t('notChecked') })}{item.syncStatus === 'stale' ? ` · ${t('staleSync')}` : ''}</p>
                  <p className="muted">{t(noteKey[item.category] || 'noteSeason')}</p>
                  {item.history.length > 0 && (
                    <p className="muted">{t('pastHistory')}: {item.history.map((entry) => entry.date || t('noDate')).join(' · ')}</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        ))}
      </section>
    </div>
  )
}

function EventCard({
  event,
  onReload,
  annual,
  setAnnual,
  onAnnual,
}: {
  event: EventRow
  onReload: () => Promise<void>
  annual: Record<string, { date: string, certainty: 'official' | 'estimated' }>
  setAnnual: (value: Record<string, { date: string, certainty: 'official' | 'estimated' }>) => void
  onAnnual: (id: string) => Promise<void>
}) {
  const { t } = useI18n()
  const draft = annual[event.id] || { date: event.date || '', certainty: event.dateCertainty === 'estimated' ? 'estimated' as const : 'official' as const }
  return (
    <article className="card rec-card">
      <div>
        <p className="eyebrow">
          <span className={`cal-badge cal-badge-${event.dateCertainty}`}>{t(certaintyKey[event.dateCertainty])}</span>
          <span className="cal-badge">{categoryKey[event.category] ? t(categoryKey[event.category]) : event.category}</span>
        </p>
        <h3>{event.title}</h3>
        <p>{event.date || t('dateLater')} {event.time || ''}</p>
        <p>{event.description}</p>
        {event.dateNote && <p className="muted">{event.dateNote}</p>}
        <p className="muted">{event.reminderDays.length ? t('reminderBefore', { days: event.reminderDays.join(' · ') }) : t('reminderOff')}</p>
      </div>
      <div className="hero-actions">
        <Link className="btn btn-primary" to={`/studio?eventId=${event.id}`}>{t('generateDesigns')}</Link>
        {!event.recurring && (
          <>
            <DateField
              value={draft.date}
              onChange={(date) => setAnnual({ ...annual, [event.id]: { ...draft, date } })}
            />
            <select
              value={draft.certainty}
              onChange={(input) => setAnnual({
                ...annual,
                [event.id]: { ...draft, certainty: input.target.value === 'estimated' ? 'estimated' : 'official' },
              })}
              aria-label={t('confirmDate', { title: event.title })}
            >
              <option value="official">{t('officialFull')}</option>
              <option value="estimated">{t('estimated')}</option>
            </select>
            <button type="button" className="btn btn-secondary" onClick={() => void onAnnual(event.id)}>{t('updateDate')}</button>
          </>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => void fetch(`/api/events/${event.id}`, { method: 'DELETE', credentials: 'include' }).then(onReload)}>{t('delete')}</button>
      </div>
    </article>
  )
}
