import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

type Note = {
  id: string
  title: string
  body: string
  eventId: string | null
  designId: string | null
  readAt: string | null
  createdAt: string
}

export function NotificationsPage() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [notes, setNotes] = useState<Note[]>([])
  const [reminderDays, setReminderDays] = useState<number[]>([30, 14, 7, 3, 1])
  const choices = [30, 14, 7, 3, 1]

  async function load() {
    const response = await fetch('/api/notifications', { credentials: 'include' })
    const payload = await response.json()
    if (!response.ok) return
    setNotes(payload.notifications || [])
    if (Array.isArray(payload.reminderDays)) setReminderDays(payload.reminderDays)
  }

  async function saveReminders() {
    const response = await fetch('/api/notifications/preferences', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reminderDays }),
    })
    if (response.ok) await load()
  }

  useEffect(() => {
    if (user) void load()
  }, [user])

  if (loading) return <p>جارٍ التحميل…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return (
    <div className="stack">
      <h1>مركز التنبيهات</h1>
      <p className="muted">تنبيهات داخل التطبيق فقط. لا يُرسل بريد ما لم يُضبط SMTP_URL. التذكير يُنشأ من الخادم في يوم الاستحقاق بتوقيت الرياض.</p>
      <fieldset className="card field">
        <legend>تذكير مناسبات النظام لهذا الحساب</legend>
        <div className="tone-row">
          {choices.map((day) => (
            <label key={day} className="tone">
              <input
                type="checkbox"
                checked={reminderDays.includes(day)}
                onChange={(event) => setReminderDays(event.target.checked ? [...reminderDays, day] : reminderDays.filter((item) => item !== day))}
              />
              {day} يوم
            </label>
          ))}
        </div>
        <p className="muted">إلغاء كل الخيارات يوقف تذكير المناسبات العامة لهذا المستخدم. مناسبات الشركة تبقى بتذكيرها في التقويم.</p>
        <button type="button" className="btn btn-secondary" onClick={() => void saveReminders()}>حفظ التذكير</button>
      </fieldset>
      {notes.length === 0 && <p>لا تنبيهات بعد.</p>}
      {notes.map((note) => (
        <article key={note.id} className="card rec-card">
          <div>
            <h3>{note.title}</h3>
            <p>{note.body}</p>
            <p className="muted">{new Date(note.createdAt).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })}</p>
          </div>
          <div className="hero-actions">
            {note.eventId && <Link className="btn btn-primary" to={`/calendar`}>المناسبة</Link>}
            {note.eventId && <Link className="btn btn-ghost" to={`/studio?eventId=${note.eventId}`}>التصاميم</Link>}
            {!note.readAt && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void fetch(`/api/notifications/${note.id}/read`, { method: 'POST', credentials: 'include' }).then(load)}
              >
                تعيين كمقروء
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}
