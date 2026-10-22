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

  async function load() {
    const response = await fetch('/api/notifications', { credentials: 'include' })
    const payload = await response.json()
    if (response.ok) setNotes(payload.notifications || [])
  }

  useEffect(() => {
    if (user) void load()
  }, [user])

  if (loading) return <p>جارٍ التحميل…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return (
    <div className="stack">
      <h1>مركز التنبيهات</h1>
      <p className="muted">تنبيهات داخل التطبيق فقط. لا يُرسل بريد ما لم يُضبط SMTP_URL.</p>
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
