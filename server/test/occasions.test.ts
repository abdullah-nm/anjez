import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { addDays, nextFixedDate, presentOccasion, occasionByKey, riyadhYmd } from '../platform/occasions.ts'
import { dispatchDueReminders } from '../platform/reminders.ts'
import { LocalObjectStorage } from '../platform/storage.ts'
import { PlatformStore } from '../platform/store.ts'
import { seedAccounts } from '../seed.ts'
import { SqliteStore } from '../store.ts'
import { HashingEmbeddingProvider, ScriptedLlm } from './hashingEmbeddings.ts'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'anjz-occ-'))
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'k.sqlite'),
    PLATFORM_SQLITE_PATH: join(dir, 'p.sqlite'),
    UPLOAD_ROOT: join(dir, 'up'),
    SESSION_SECRET: 'occ-secret',
    VECTOR_BACKEND: 'sqlite',
    EMBEDDING_DIMENSIONS: '64',
  })
  const store = new SqliteStore(config.sqlitePath)
  const platform = new PlatformStore(config.platformSqlitePath)
  const app = createApp({
    config,
    store,
    embeddings: new HashingEmbeddingProvider(),
    llm: new ScriptedLlm(),
    platform,
    storage: new LocalObjectStorage(config.uploadRoot),
  })
  return { app, store, platform, dir }
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app).post('/api/login').send({ email, password: 'AnjzDemo!26' }).expect(200)
  const cookie = response.headers['set-cookie']
  return Array.isArray(cookie) ? cookie : [String(cookie)]
}

describe('saudi occasion calendar', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.()
  })

  it('rolls fixed Gregorian days and leaves hijri and seasons undated', () => {
    expect(nextFixedDate(2, 22, '2026-02-22')).toBe('2026-02-22')
    expect(nextFixedDate(2, 22, '2026-02-23')).toBe('2027-02-22')
    expect(nextFixedDate(3, 11, '2026-10-22')).toBe('2027-03-11')
    expect(nextFixedDate(9, 23, '2026-09-23')).toBe('2026-09-23')
    expect(nextFixedDate(9, 23, '2026-09-24')).toBe('2027-09-23')

    const founding = presentOccasion(occasionByKey('founding-day')!, '2030-03-01')
    expect(founding.date).toBe('2031-02-22')
    expect(founding.certainty).toBe('official')

    for (const key of ['ramadan', 'eid-fitr', 'arafah', 'eid-adha', 'hajj-season']) {
      const item = presentOccasion(occasionByKey(key)!, '2030-01-01')
      expect(item.date).toBeNull()
      expect(item.certainty).toBe('unannounced')
      expect(item.recurring).toBe(false)
    }
    for (const key of ['riyadh-season', 'jeddah-season', 'diriyah-season', 'alula-winter', 'book-fair', 'cultural-major', 'sports-major']) {
      const item = presentOccasion(occasionByKey(key)!, riyadhYmd())
      expect(item.date).toBeNull()
      expect(item.certainty).toBe('unannounced')
    }
  })

  it('adds a template once per company and keeps reminders inside that company', async () => {
    const { app, store, platform } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const almarai = await login(app, 'nasser@almarai.com')
    const qimam = await login(app, 'fahd@qimam.sa')
    const member = await login(app, 'hind@almarai.com')

    const first = await request(app).post('/api/events/from-occasion').set('Cookie', almarai).send({ key: 'founding-day' }).expect(201)
    expect(first.body.event.date.endsWith('-02-22')).toBe(true)
    expect(first.body.event.dateCertainty).toBe('official')
    expect(first.body.event.reminderDays).toEqual([30, 14, 7, 3, 1])
    await request(app).post('/api/events/from-occasion').set('Cookie', almarai).send({ key: 'founding-day' }).expect(409)
    await request(app).post('/api/events/from-occasion').set('Cookie', qimam).send({ key: 'founding-day' }).expect(201)

    const ramadan = await request(app).post('/api/events/from-occasion').set('Cookie', almarai).send({ key: 'ramadan' }).expect(201)
    expect(ramadan.body.event.date).toBeNull()
    expect(ramadan.body.event.dateCertainty).toBe('unannounced')
    const season = await request(app).post('/api/events/from-occasion').set('Cookie', almarai).send({ key: 'riyadh-season' }).expect(201)
    expect(season.body.event.date).toBeNull()

    const today = riyadhYmd()
    const due = await request(app).post('/api/events').set('Cookie', almarai).send({
      title: 'تذكير خاص بالمراعي',
      date: addDays(today, 30),
      category: 'internal',
      reminderDays: [30],
    }).expect(201)
    const dispatched = dispatchDueReminders(platform)
    expect(dispatched.created).toBe(1)
    expect(dispatchDueReminders(platform).created).toBe(0)

    const adminNotes = await request(app).get('/api/notifications').set('Cookie', almarai).expect(200)
    const memberNotes = await request(app).get('/api/notifications').set('Cookie', member).expect(200)
    const otherNotes = await request(app).get('/api/notifications').set('Cookie', qimam).expect(200)
    expect(adminNotes.body.notifications.some((note: { title: string }) => note.title.includes('تذكير خاص بالمراعي'))).toBe(true)
    expect(memberNotes.body.notifications.some((note: { title: string }) => note.title.includes('تذكير خاص بالمراعي'))).toBe(true)
    expect(otherNotes.body.notifications.some((note: { title: string }) => note.title.includes('تذكير خاص بالمراعي'))).toBe(false)
    expect(due.body.event.companyId).toBe('company_almarai')
  })

  it('updates a hijri date without rewriting the previous event', async () => {
    const { app, store } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const almarai = await login(app, 'nasser@almarai.com')
    const created = await request(app).post('/api/events/from-occasion').set('Cookie', almarai).send({ key: 'eid-fitr' }).expect(201)
    const id = created.body.event.id as string
    const today = riyadhYmd()
    const firstDate = addDays(today, 10)
    const setFirst = await request(app).post(`/api/events/${id}/annual-date`).set('Cookie', almarai).send({
      date: firstDate,
      dateCertainty: 'estimated',
    }).expect(200)
    expect(setFirst.body.event.id).toBe(id)
    expect(setFirst.body.event.date).toBe(firstDate)
    expect(setFirst.body.event.dateCertainty).toBe('estimated')

    await request(app).put(`/api/events/${id}`).set('Cookie', almarai).send({
      title: 'عيد الفطر',
      date: addDays(today, -1),
      category: 'islamic',
      description: created.body.event.description,
      reminderDays: [30, 14, 7, 3, 1],
      status: 'planned',
    }).expect(200)

    const nextDate = addDays(today, 40)
    const rolled = await request(app).post(`/api/events/${id}/annual-date`).set('Cookie', almarai).send({
      date: nextDate,
      dateCertainty: 'official',
    }).expect(201)
    expect(rolled.body.previousId).toBe(id)
    expect(rolled.body.event.date).toBe(nextDate)
    expect(rolled.body.event.id).not.toBe(id)

    const listed = await request(app).get('/api/events').set('Cookie', almarai).expect(200)
    const previous = listed.body.events.find((event: { id: string }) => event.id === id)
    expect(previous.date).toBe(addDays(today, -1))
    expect(previous.status).toBe('done')
    expect(listed.body.events.filter((event: { occasionKey: string, status: string }) => event.occasionKey === 'eid-fitr' && event.status !== 'done')).toHaveLength(1)
  })

  it('migrates an older events table that required a date', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anjz-migrate-'))
    const path = join(dir, 'old.sqlite')
    const db = new DatabaseSync(path)
    db.exec(`
      CREATE TABLE company_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned',
        reminder_days TEXT NOT NULL DEFAULT '[7,1]',
        occasion_key TEXT,
        recurring INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO company_events (
        id, company_id, title, date, description, category, reminder_days, created_by, created_at, updated_at
      ) VALUES ('evt_old', 'company_almarai', 'قديم', '2026-02-22', '', 'national', '[7,1]', 'user_almarai_admin', '2026-01-01', '2026-01-01');
    `)
    db.close()
    const platform = new PlatformStore(path)
    const events = platform.listEvents('company_almarai')
    expect(events).toHaveLength(1)
    expect(events[0]?.date).toBe('2026-02-22')
    expect(events[0]?.dateCertainty).toBe('official')
    platform.insertEvent({
      id: 'evt_open',
      companyId: 'company_almarai',
      title: 'رمضان',
      date: null,
      time: null,
      description: 'بلا تاريخ',
      category: 'islamic',
      audience: '',
      status: 'planned',
      reminderDays: [],
      occasionKey: 'ramadan',
      recurring: false,
      dateCertainty: 'unannounced',
      dateNote: 'يُحدَّد لاحقًا',
      createdBy: 'user_almarai_admin',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })
    expect(platform.dueEvents().some((event) => event.id === 'evt_open')).toBe(false)
    platform.close()
  })
})
