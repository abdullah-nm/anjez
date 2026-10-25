import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { applyCalendarUpdate, syncSystemOccasions } from '../platform/calendarSync.ts'
import { gregorianForHijri } from '../platform/hijri.ts'
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
    CRON_SECRET: 'cron-test',
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

  it('rolls fixed Gregorian days and reads Umm al-Qura anchors without baking hijri dates into the template', () => {
    expect(nextFixedDate(2, 22, '2026-02-22')).toBe('2026-02-22')
    expect(nextFixedDate(2, 22, '2026-02-23')).toBe('2027-02-22')
    expect(nextFixedDate(3, 11, '2026-10-22')).toBe('2027-03-11')
    expect(nextFixedDate(9, 23, '2026-09-23')).toBe('2026-09-23')
    expect(nextFixedDate(9, 23, '2026-09-24')).toBe('2027-09-23')
    expect(gregorianForHijri(1448, 9, 1)).toBe('2027-02-08')
    expect(gregorianForHijri(1448, 10, 1)).toBe('2027-03-09')
    expect(gregorianForHijri(1448, 12, 8)).toBe('2027-05-14')
    expect(gregorianForHijri(1448, 12, 9)).toBe('2027-05-15')
    expect(gregorianForHijri(1448, 12, 10)).toBe('2027-05-16')

    const founding = presentOccasion(occasionByKey('founding-day')!, '2030-03-01')
    expect(founding.date).toBe('2031-02-22')
    expect(founding.certainty).toBe('official')

    for (const key of ['ramadan', 'eid-fitr', 'arafah', 'eid-adha', 'hajj-season', 'riyadh-season']) {
      const item = presentOccasion(occasionByKey(key)!, '2030-01-01')
      expect(item.date).toBeNull()
      expect(item.recurring).toBe(false)
    }
  })

  it('shows system occasions to every company without a manual add', async () => {
    const { app, store, platform } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const almarai = await login(app, 'nasser@almarai.com')
    const qimam = await login(app, 'fahd@qimam.sa')
    const member = await login(app, 'hind@almarai.com')

    const first = await request(app).get('/api/events').set('Cookie', almarai).expect(200)
    const founding = first.body.systemOccasions.find((item: { key: string }) => item.key === 'founding-day')
    const ramadan = first.body.systemOccasions.find((item: { key: string }) => item.key === 'ramadan')
    const season = first.body.systemOccasions.find((item: { key: string }) => item.key === 'riyadh-season')
    expect(founding.date.endsWith('-02-22')).toBe(true)
    expect(founding.dateCertainty).toBe('official')
    expect(founding.source).toBe('fixed-gregorian')
    expect(founding.checkedAt).toBeTruthy()
    expect(ramadan.dateCertainty).toBe('estimated')
    expect(ramadan.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(ramadan.source).toBe('umalqura')
    expect(season.date).toBeNull()
    expect(season.dateCertainty).toBe('unannounced')
    expect(first.body.events.some((event: { occasionKey: string | null }) => event.occasionKey === 'founding-day')).toBe(false)

    const second = await request(app).get('/api/events').set('Cookie', almarai).expect(200)
    expect(second.body.systemOccasions).toHaveLength(first.body.systemOccasions.length)
    expect(second.body.systemOccasions.filter((item: { key: string }) => item.key === 'founding-day')).toHaveLength(1)

    await request(app).post('/api/events').set('Cookie', almarai).send({
      title: 'مناسبة خاصة بالمراعي',
      date: addDays(riyadhYmd(), 4),
      category: 'internal',
    }).expect(201)
    const other = await request(app).get('/api/events').set('Cookie', qimam).expect(200)
    expect(other.body.systemOccasions.find((item: { key: string }) => item.key === 'founding-day').id).toBe(founding.id)
    expect(other.body.events.some((event: { title: string }) => event.title === 'مناسبة خاصة بالمراعي')).toBe(false)

    const blocked = await request(app).post('/api/events/from-occasion').set('Cookie', almarai).send({ key: 'founding-day' }).expect(409)
    expect(blocked.body.code).toBe('SYSTEM_OCCASION')
    const edited = await request(app).put('/api/events/sys:founding-day').set('Cookie', almarai).send({
      title: 'تغيير',
      date: '2027-02-22',
      category: 'national',
    }).expect(403)
    expect(edited.body.code).toBe('SYSTEM_OCCASION')
    await request(app).delete('/api/events/sys:ramadan').set('Cookie', almarai).expect(403)
    await request(app).post('/api/events/sys:ramadan/annual-date').set('Cookie', almarai).send({
      date: '2027-02-08',
      dateCertainty: 'official',
    }).expect(403)
    await request(app).post('/api/internal/calendar/occasions').set('Cookie', almarai).send({
      key: 'ramadan',
      date: '2027-02-08',
      dateCertainty: 'official',
      source: 'حساب شركة',
    }).expect(401)

    const today = riyadhYmd()
    const due = await request(app).post('/api/events').set('Cookie', almarai).send({
      title: 'تذكير خاص بالمراعي',
      date: addDays(today, 30),
      category: 'internal',
      reminderDays: [30],
    }).expect(201)
    dispatchDueReminders(platform)
    expect(dispatchDueReminders(platform).created).toBe(0)

    const adminNotes = await request(app).get('/api/notifications').set('Cookie', almarai).expect(200)
    const memberNotes = await request(app).get('/api/notifications').set('Cookie', member).expect(200)
    const otherNotes = await request(app).get('/api/notifications').set('Cookie', qimam).expect(200)
    expect(adminNotes.body.notifications.some((note: { title: string }) => note.title.includes('تذكير خاص بالمراعي'))).toBe(true)
    expect(memberNotes.body.notifications.some((note: { title: string }) => note.title.includes('تذكير خاص بالمراعي'))).toBe(true)
    expect(otherNotes.body.notifications.some((note: { title: string }) => note.title.includes('تذكير خاص بالمراعي'))).toBe(false)
    expect(due.body.event.companyId).toBe('company_almarai')
  })

  it('updates hijri and season dates centrally and keeps the last reliable date when sync fails', async () => {
    const { app, store, platform } = harness()
    cleanups.push(() => store.close())
    const today = riyadhYmd()
    syncSystemOccasions(platform, new Date('2026-02-21T12:00:00+03:00'))
    expect(platform.getSystemOccasion('founding-day')?.date).toBe('2026-02-22')
    syncSystemOccasions(platform, new Date('2026-02-21T18:00:00+03:00'))
    expect(platform.listSystemOccasions().filter((item) => item.key === 'founding-day')).toHaveLength(1)
    syncSystemOccasions(platform, new Date('2026-02-23T12:00:00+03:00'))
    const rolled = platform.getSystemOccasion('founding-day')
    expect(rolled?.date).toBe('2027-02-22')
    expect(rolled?.history.some((item) => item.date === '2026-02-22')).toBe(true)
    expect(platform.listSystemOccasions().filter((item) => item.key === 'founding-day')).toHaveLength(1)

    syncSystemOccasions(platform)
    const estimated = platform.getSystemOccasion('ramadan')
    expect(estimated?.dateCertainty).toBe('estimated')
    expect(estimated?.source).toBe('umalqura')
    const confirmedDate = addDays(today, 20)
    const confirmed = await request(app).post('/api/internal/calendar/occasions').set('Authorization', 'Bearer cron-test').send({
      key: 'ramadan',
      date: confirmedDate,
      dateCertainty: 'official',
      source: 'إعلان المحكمة العليا',
    }).expect(200)
    expect(confirmed.body.occasion.date).toBe(confirmedDate)
    expect(confirmed.body.occasion.dateCertainty).toBe('official')
    expect(confirmed.body.occasion.source).toBe('إعلان المحكمة العليا')
    syncSystemOccasions(platform)
    expect(platform.getSystemOccasion('ramadan')?.date).toBe(confirmedDate)
    expect(platform.getSystemOccasion('ramadan')?.dateCertainty).toBe('official')

    const past = addDays(today, -3)
    applyCalendarUpdate(platform, { key: 'ramadan', date: past, dateCertainty: 'official', source: 'إعلان سابق' })
    syncSystemOccasions(platform)
    const nextYear = platform.getSystemOccasion('ramadan')
    expect(nextYear?.dateCertainty).toBe('estimated')
    expect(nextYear?.date).not.toBe(past)
    expect(nextYear?.history.some((item) => item.date === past && item.source === 'إعلان سابق')).toBe(true)

    const seasonDate = addDays(today, 12)
    await request(app).post('/api/internal/calendar/occasions').set('Authorization', 'Bearer cron-test').send({
      key: 'riyadh-season',
      date: seasonDate,
      dateCertainty: 'estimated',
      source: 'بيان الهيئة العامة للترفيه',
    }).expect(200)
    syncSystemOccasions(platform)
    expect(platform.getSystemOccasion('riyadh-season')?.date).toBe(seasonDate)
    expect(platform.getSystemOccasion('riyadh-season')?.dateCertainty).toBe('estimated')
    expect(platform.getSystemOccasion('book-fair')?.date).toBeNull()
    await request(app).post('/api/internal/calendar/occasions').set('Authorization', 'Bearer cron-test').send({
      key: 'founding-day',
      date: '2027-01-01',
      dateCertainty: 'estimated',
      source: 'تعديل غير مسموح',
    }).expect(400)

    const kept = platform.getSystemOccasion('eid-fitr')
    syncSystemOccasions(platform, new Date(), { resolveHijri: () => { throw new Error('source down') } })
    expect(platform.getSystemOccasion('eid-fitr')?.date).toBe(kept?.date)
    expect(platform.getSystemOccasion('eid-fitr')?.syncStatus).toBe('stale')
    expect(platform.calendarSyncState()?.status).toBe('stale')
    expect(platform.calendarSyncState()?.message).toContain('آخر موعد')
  })

  it('reminds only confirmed system dates once, and keeps company notifications isolated', async () => {
    const { app, store, platform } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const almarai = await login(app, 'nasser@almarai.com')
    const member = await login(app, 'hind@almarai.com')
    const qimam = await login(app, 'fahd@qimam.sa')
    const today = riyadhYmd()
    const due = addDays(today, 14)

    await request(app).put('/api/notifications/preferences').set('Cookie', member).send({ reminderDays: [] }).expect(200)
    await request(app).post('/api/internal/calendar/occasions').set('Authorization', 'Bearer cron-test').send({
      key: 'eid-adha',
      date: due,
      dateCertainty: 'estimated',
      source: 'تقويم أم القرى',
    }).expect(200)
    dispatchDueReminders(platform)
    const quiet = await request(app).get('/api/notifications').set('Cookie', almarai).expect(200)
    expect(quiet.body.notifications.some((note: { title: string }) => note.title.includes('عيد الأضحى'))).toBe(false)

    await request(app).post('/api/internal/calendar/occasions').set('Authorization', 'Bearer cron-test').send({
      key: 'eid-adha',
      date: due,
      dateCertainty: 'official',
      source: 'إعلان المحكمة العليا',
    }).expect(200)
    const first = dispatchDueReminders(platform)
    const second = dispatchDueReminders(platform)
    expect(first.created).toBe(2)
    expect(second.created).toBe(0)

    const adminNotes = await request(app).get('/api/notifications').set('Cookie', almarai).expect(200)
    const memberNotes = await request(app).get('/api/notifications').set('Cookie', member).expect(200)
    const otherNotes = await request(app).get('/api/notifications').set('Cookie', qimam).expect(200)
    const adminHit = adminNotes.body.notifications.find((note: { title: string }) => note.title.includes('عيد الأضحى'))
    const otherHit = otherNotes.body.notifications.find((note: { title: string }) => note.title.includes('عيد الأضحى'))
    expect(adminHit.companyId).toBe('company_almarai')
    expect(otherHit.companyId).toBe('company_qimam')
    expect(memberNotes.body.notifications.some((note: { title: string }) => note.title.includes('عيد الأضحى'))).toBe(false)
    expect(otherNotes.body.notifications.some((note: { title: string, companyId: string }) => note.companyId === 'company_almarai')).toBe(false)
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
