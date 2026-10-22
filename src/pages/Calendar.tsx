import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { productById } from '../data'

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

type Occasion = {
  key: string
  titleAr: string
  date: string | null
  category: 'national' | 'islamic' | 'season'
  dateNote: string
  certainty: Certainty
  recurring: boolean
  needsAnnualUpdate: boolean
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

const categoryLabel: Record<string, string> = {
  national: 'وطني',
  islamic: 'إسلامي',
  season: 'موسم/فعالية',
  custom: 'مخصص',
  conference: 'مؤتمر',
  launch: 'إطلاق',
  internal: 'داخلي',
}

const certaintyLabel: Record<Certainty, string> = {
  official: 'مؤكد',
  estimated: 'تقديري',
  unannounced: 'يُحدَّد لاحقًا',
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
  const location = useLocation()
  const [params] = useSearchParams()
  const today = riyadhParts()
  const [events, setEvents] = useState<EventRow[]>([])
  const [occasions, setOccasions] = useState<Occasion[]>([])
  const [view, setView] = useState<'month' | 'week' | 'list'>('month')
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
    const [ev, meta] = await Promise.all([
      fetch('/api/events', { credentials: 'include' }).then((response) => response.json()),
      fetch('/api/platform/meta', { credentials: 'include' }).then((response) => response.json()),
    ])
    setEvents(ev.events || [])
    setOccasions(meta.occasions || [])
  }

  if (loading) return <p>جارٍ التحميل…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstWeekday = new Date(`${year}-${pad(month)}-01T12:00:00+03:00`).getUTCDay()
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => index - firstWeekday + 1)
  const query = params.get('q')
  const visible = events.filter((event) => !query || `${event.title} ${event.category}`.includes(query))
  const dated = visible.filter((event) => event.date && event.status !== 'done')
  const undated = visible.filter((event) => !event.date && event.status !== 'done')
  const history = visible.filter((event) => event.status === 'done')
  const openKeys = new Set(visible.filter((event) => event.status !== 'done' && event.occasionKey).map((event) => event.occasionKey))

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
      setError(body.error || 'تعذر حفظ المناسبة.')
      return
    }
    setForm(emptyForm)
    setEditing(null)
    await reload()
  }

  async function addOccasion(item: Occasion) {
    setError(null)
    const response = await fetch('/api/events/from-occasion', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: item.key }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(body.error || 'تعذر إضافة المناسبة.')
      return
    }
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
      setError(body.error || 'تعذر تحديث الموعد.')
      return
    }
    await reload()
  }

  const weekStart = `${year}-${pad(month)}-${pad(today.month === month && today.year === year ? today.day : 1)}`
  const weekEvents = dated.filter((event) => {
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
    { id: 'national', title: 'وطني' },
    { id: 'islamic', title: 'إسلامي' },
    { id: 'season', title: 'موسم/فعالية' },
  ] as const

  return (
    <div className="stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">تقويم الشركة · Asia/Riyadh</p>
          <h1>المناسبات والتذكير قبل الموعد</h1>
        </div>
        <div className="hero-actions">
          <button type="button" className={view === 'month' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setView('month')}>شهر</button>
          <button type="button" className={view === 'week' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setView('week')}>أسبوع</button>
          <button type="button" className={view === 'list' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setView('list')}>قائمة</button>
        </div>
      </div>
      <p className="muted">التذكير داخل التطبيق يُفحص كل ساعة ما دام الخادم يعمل، وفي يوم الاستحقاق بتوقيت الرياض. لا يُرسل بريد.</p>

      <div className="hero-actions">
        <button type="button" className="btn btn-ghost" onClick={() => shiftMonth(-1)}>الشهر السابق</button>
        <strong>{new Date(`${year}-${pad(month)}-01T12:00:00+03:00`).toLocaleDateString('ar-SA', { month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' })}</strong>
        <button type="button" className="btn btn-ghost" onClick={() => shiftMonth(1)}>الشهر التالي</button>
      </div>

      {view === 'month' && (
        <div className="cal-grid">
          {cells.map((day, index) => {
            const ymd = day > 0 ? `${year}-${pad(month)}-${pad(day)}` : ''
            const dayEvents = dated.filter((event) => event.date === ymd)
            return (
              <div key={index} className="cal-cell">
                {day > 0 && <strong>{day}</strong>}
                {dayEvents.map(eventButton)}
              </div>
            )
          })}
        </div>
      )}

      {view === 'week' && (
        <ul className="order-mini">
          {weekEvents.length === 0 && <li>لا مناسبات مؤرخة في هذا الأسبوع.</li>}
          {weekEvents.map((event) => (
            <li key={event.id}>{event.date} · {event.title} · {certaintyLabel[event.dateCertainty]}</li>
          ))}
        </ul>
      )}

      {view === 'list' && (
        <div className="stack">
          {dated.length === 0 && undated.length === 0 && <p className="muted">لا مناسبات مفتوحة. أضف مناسبة أو اختر قالباً.</p>}
          {dated.map((event) => (
            <EventCard key={event.id} event={event} onReload={reload} annual={annual} setAnnual={setAnnual} onAnnual={saveAnnual} />
          ))}
        </div>
      )}

      {undated.length > 0 && (
        <section className="stack">
          <h2>بانتظار موعد معلن</h2>
          {undated.map((event) => (
            <EventCard key={event.id} event={event} onReload={reload} annual={annual} setAnnual={setAnnual} onAnnual={saveAnnual} />
          ))}
        </section>
      )}

      {history.length > 0 && (
        <section className="stack">
          <h2>سجل سابق</h2>
          {history.map((event) => (
            <article key={event.id} className="card rec-card">
              <div>
                <p className="eyebrow">{event.date} · {certaintyLabel[event.dateCertainty]}</p>
                <h3>{event.title}</h3>
                <p className="muted">{event.dateNote}</p>
              </div>
            </article>
          ))}
        </section>
      )}

      <form className="card stack" onSubmit={save}>
        <h2>{editing ? 'تعديل مناسبة' : 'مناسبة جديدة'}</h2>
        <div className="grid-2">
          <label className="field"><span>العنوان</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="field"><span>التاريخ</span><input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
          <label className="field"><span>الوقت (اختياري)</span><input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} /></label>
          <label className="field"><span>التصنيف</span>
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              <option value="custom">مخصص</option>
              <option value="national">وطني</option>
              <option value="islamic">إسلامي</option>
              <option value="season">موسم/فعالية</option>
              <option value="conference">مؤتمر</option>
              <option value="launch">إطلاق</option>
              <option value="internal">داخلي</option>
            </select>
          </label>
        </div>
        <label className="field"><span>الجمهور</span><input value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} /></label>
        <label className="field"><span>الوصف</span><textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <fieldset className="field">
          <legend>التذكير قبل الموعد. إلغاء كل الخيارات يوقف التذكير.</legend>
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
                {day} يوم
              </label>
            ))}
          </div>
        </fieldset>
        <div className="hero-actions">
          <button className="btn btn-primary" type="submit">حفظ</button>
          {editing && <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setForm(emptyForm) }}>إلغاء</button>}
        </div>
        {error && <p className="notice err">{error}</p>}
      </form>

      <section className="stack">
        <h2>قوالب المناسبات</h2>
        <p className="muted">المواعيد الميلادية الثابتة تُضاف لأقرب سنة. المناسبات الهجرية والمواسم تُضاف بلا تاريخ إلى أن تُدخله. مثال منتج: {productById('prd-poster')?.name}</p>
        {groups.map((group) => (
          <div key={group.id} className="stack">
            <h3>{group.title}</h3>
            {occasions.filter((item) => item.category === group.id).map((item) => (
              <article key={item.key} className="card rec-card">
                <div>
                  <p className="eyebrow">{categoryLabel[item.category]} · {certaintyLabel[item.certainty]}</p>
                  <h3>{item.titleAr}</h3>
                  <p>{item.date || 'يُحدَّد لاحقًا'}</p>
                  <p className="muted">{item.dateNote}</p>
                </div>
                {openKeys.has(item.key) ? (
                  <span className="muted">مضافة للتقويم</span>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={() => void addOccasion(item)}>أضف للتقويم</button>
                )}
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
  const draft = annual[event.id] || { date: event.date || '', certainty: event.dateCertainty === 'estimated' ? 'estimated' as const : 'official' as const }
  return (
    <article className="card rec-card">
      <div>
        <p className="eyebrow">{categoryLabel[event.category] || event.category} · {certaintyLabel[event.dateCertainty]}</p>
        <h3>{event.title}</h3>
        <p>{event.date || 'يُحدَّد لاحقًا'} {event.time || ''}</p>
        <p>{event.description}</p>
        {event.dateNote && <p className="muted">{event.dateNote}</p>}
        <p className="muted">{event.reminderDays.length ? `تذكير قبل ${event.reminderDays.join('، ')} يوم` : 'التذكير متوقف'}</p>
      </div>
      <div className="hero-actions">
        <Link className="btn btn-primary" to={`/studio?eventId=${event.id}`}>ولّد تصاميم</Link>
        {!event.recurring && (
          <>
            <input
              type="date"
              value={draft.date}
              onChange={(input) => setAnnual({ ...annual, [event.id]: { ...draft, date: input.target.value } })}
              aria-label={`موعد ${event.title}`}
            />
            <select
              value={draft.certainty}
              onChange={(input) => setAnnual({
                ...annual,
                [event.id]: { ...draft, certainty: input.target.value === 'estimated' ? 'estimated' : 'official' },
              })}
              aria-label={`تأكيد موعد ${event.title}`}
            >
              <option value="official">مؤكد رسمياً</option>
              <option value="estimated">تقديري</option>
            </select>
            <button type="button" className="btn btn-secondary" onClick={() => void onAnnual(event.id)}>تحديث الموعد</button>
          </>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => void fetch(`/api/events/${event.id}`, { method: 'DELETE', credentials: 'include' }).then(onReload)}>حذف</button>
      </div>
    </article>
  )
}
