import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { productById } from '../data'

type EventRow = {
  id: string
  title: string
  date: string
  time: string | null
  description: string
  category: string
  audience: string
  status: string
  reminderDays: number[]
}

type Occasion = { key: string; titleAr: string; date: string; category: string; dateNote: string }

const emptyForm = {
  title: '',
  date: '',
  time: '',
  description: '',
  category: 'custom',
  audience: '',
  status: 'planned',
  reminderDays: [7, 1] as number[],
}

export function CalendarPage() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [params] = useSearchParams()
  const [events, setEvents] = useState<EventRow[]>([])
  const [occasions, setOccasions] = useState<Occasion[]>([])
  const [view, setView] = useState<'month' | 'week' | 'list'>('month')
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(() => new Date())

  useEffect(() => {
    if (!user) return
    void reload()
  }, [user])

  async function reload() {
    const [ev, meta] = await Promise.all([
      fetch('/api/events', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/platform/meta', { credentials: 'include' }).then((r) => r.json()),
    ])
    setEvents(ev.events || [])
    setOccasions(meta.occasions || [])
  }

  if (loading) return <p>جارٍ التحميل…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const start = new Date(year, month, 1).getDay()
  const cells = Array.from({ length: start + daysInMonth }, (_, i) => i - start + 1)
  const visible = events.filter((event) => {
    const q = params.get('q')
    if (q && !`${event.title} ${event.category}`.includes(q)) return false
    return true
  })

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const payload = {
      ...form,
      time: form.time || null,
      reminderDays: form.reminderDays,
    }
    const response = await fetch(editing ? `/api/events/${editing}` : '/api/events', {
      method: editing ? 'PUT' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    await fetch('/api/events', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: item.titleAr,
        date: item.date,
        category: item.category,
        description: item.dateNote,
        reminderDays: [14, 7, 1],
        occasionKey: item.key,
        recurring: item.category === 'national',
      }),
    })
    await reload()
  }

  const weekEvents = visible.filter((event) => {
    const d = new Date(`${event.date}T12:00:00`)
    const startW = new Date(cursor)
    const day = (startW.getDay() + 6) % 7
    startW.setDate(startW.getDate() - day)
    const endW = new Date(startW)
    endW.setDate(startW.getDate() + 7)
    return d >= startW && d < endW
  })

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

      <div className="hero-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setCursor(new Date(year, month - 1, 1))}>الشهر السابق</button>
        <strong>{cursor.toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' })}</strong>
        <button type="button" className="btn btn-ghost" onClick={() => setCursor(new Date(year, month + 1, 1))}>الشهر التالي</button>
      </div>

      {view === 'month' && (
        <div className="cal-grid">
          {cells.map((day, i) => {
            const ymd = day > 0 ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''
            const dayEvents = visible.filter((event) => event.date === ymd)
            return (
              <div key={i} className="cal-cell">
                {day > 0 && <strong>{day}</strong>}
                {dayEvents.map((event) => (
                  <button key={event.id} type="button" className="cal-event" onClick={() => {
                    setEditing(event.id)
                    setForm({
                      title: event.title,
                      date: event.date,
                      time: event.time || '',
                      description: event.description,
                      category: event.category,
                      audience: event.audience,
                      status: event.status,
                      reminderDays: event.reminderDays,
                    })
                  }}>{event.title}</button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {view === 'week' && (
        <ul className="order-mini">
          {weekEvents.length === 0 && <li>لا مناسبات في هذا الأسبوع.</li>}
          {weekEvents.map((event) => (
            <li key={event.id}>{event.date} · {event.title}</li>
          ))}
        </ul>
      )}

      {view === 'list' && (
        <div className="stack">
          {visible.length === 0 && <p className="muted">لا مناسبات بعد. أضف مناسبة أو اختر من المناسبات السعودية.</p>}
          {visible.map((event) => (
            <article key={event.id} className="card rec-card">
              <div>
                <p className="eyebrow">{event.date} {event.time || ''}</p>
                <h3>{event.title}</h3>
                <p>{event.description}</p>
                <p className="muted">{event.category} · تذكير قبل {event.reminderDays.join('، ')} يوم</p>
              </div>
              <div className="hero-actions">
                <Link className="btn btn-primary" to={`/studio?eventId=${event.id}`}>ولّد تصاميم</Link>
                <button type="button" className="btn btn-ghost" onClick={() => void fetch(`/api/events/${event.id}`, { method: 'DELETE', credentials: 'include' }).then(reload)}>حذف</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <form className="card stack" onSubmit={save}>
        <h2>{editing ? 'تعديل مناسبة' : 'مناسبة جديدة'}</h2>
        <div className="grid-2">
          <label className="field"><span>العنوان</span><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="field"><span>التاريخ</span><input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <label className="field"><span>الوقت (اختياري)</span><input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
          <label className="field"><span>التصنيف</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="custom">مخصص</option>
              <option value="national">وطني</option>
              <option value="islamic">مناسبات إسلامية</option>
              <option value="conference">مؤتمر</option>
              <option value="launch">إطلاق</option>
              <option value="internal">داخلي</option>
            </select>
          </label>
        </div>
        <label className="field"><span>الجمهور</span><input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} /></label>
        <label className="field"><span>الوصف</span><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <fieldset className="field">
          <legend>التذكير (أيام قبل الموعد)</legend>
          <div className="tone-row">
            {[30, 14, 7, 3, 1].map((day) => (
              <label key={day} className="tone">
                <input
                  type="checkbox"
                  checked={form.reminderDays.includes(day)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      reminderDays: e.target.checked
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
        <h2>مناسبات جاهزة (تواريخ 2026 الموثقة)</h2>
        {occasions.map((item) => (
          <article key={item.key} className="card rec-card">
            <div>
              <h3>{item.titleAr}</h3>
              <p>{item.date}</p>
              <p className="muted">{item.dateNote}</p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void addOccasion(item)}>أضف للتقويم</button>
          </article>
        ))}
        <p className="muted">لا تُختلق أسعار أو مخزون للمنتجات المقترحة. مثال منتج مرتبط: {productById('prd-poster')?.name}</p>
      </section>
    </div>
  )
}
