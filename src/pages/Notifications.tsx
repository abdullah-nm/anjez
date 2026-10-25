import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'

type Note = {
  id: string
  title: string
  body: string
  kind?: string
  payload?: string
  eventId: string | null
  designId: string | null
  readAt: string | null
  createdAt: string
}

export function NotificationsPage() {
  const { user, loading } = useAuth()
  const { t, formatDateTime, countText, occasionLabel } = useI18n()
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

  function shown(note: Note) {
    if (note.kind !== 'reminder' || !note.payload) return { title: note.title, body: note.body }
    try {
      const data = JSON.parse(note.payload) as { title?: string, offset?: number, estimated?: boolean, occasionKey?: string }
      const title = occasionLabel(data.occasionKey, data.title || note.title)
      return {
        title: t('ntfReminder', { title }),
        body: `${countText('ntfBody', Number(data.offset) || 0)}${data.estimated ? t('ntfEstimate') : ''}`,
      }
    } catch {
      return { title: note.title, body: note.body }
    }
  }

  if (loading) return <p>{t('loading')}</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return (
    <div className="stack">
      <h1>{t('alertsTitle')}</h1>
      <p className="muted">{t('alertsIntro')}</p>
      <fieldset className="card field">
        <legend>{t('reminderSystemLegend')}</legend>
        <div className="tone-row">
          {choices.map((day) => (
            <label key={day} className="tone">
              <input
                type="checkbox"
                checked={reminderDays.includes(day)}
                onChange={(event) => setReminderDays(event.target.checked ? [...reminderDays, day] : reminderDays.filter((item) => item !== day))}
              />
              {t('reminderBefore', { days: day })}
            </label>
          ))}
        </div>
        <p className="muted">{t('reminderSystemHint')}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void saveReminders()}>{t('saveReminders')}</button>
      </fieldset>
      {notes.length === 0 && <p>{t('noAlerts')}</p>}
      {notes.map((note) => {
        const copy = shown(note)
        return (
        <article key={note.id} className="card rec-card">
          <div>
            <h3>{copy.title}</h3>
            <p>{copy.body}</p>
            <p className="muted">{formatDateTime(note.createdAt)}</p>
          </div>
          <div className="hero-actions">
            {note.eventId && <Link className="btn btn-primary" to={`/calendar`}>{t('navCalendar')}</Link>}
            {note.eventId && <Link className="btn btn-ghost" to={`/studio?eventId=${note.eventId}`}>{t('designs')}</Link>}
            {!note.readAt && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void fetch(`/api/notifications/${note.id}/read`, { method: 'POST', credentials: 'include' }).then(load)}
              >
                {t('markRead')}
              </button>
            )}
          </div>
        </article>
        )
      })}
    </div>
  )
}
