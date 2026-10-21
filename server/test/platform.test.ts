import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { seedAccounts } from '../seed.ts'
import { SqliteStore } from '../store.ts'
import { HashingEmbeddingProvider, ScriptedLlm } from './hashingEmbeddings.ts'
import { LocalObjectStorage } from '../platform/storage.ts'
import { PlatformStore } from '../platform/store.ts'
import { addDays, daysUntil, riyadhYmd } from '../platform/occasions.ts'
import { dispatchDueReminders } from '../platform/reminders.ts'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'anjz-plat-'))
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'k.sqlite'),
    PLATFORM_SQLITE_PATH: join(dir, 'p.sqlite'),
    UPLOAD_ROOT: join(dir, 'up'),
    SESSION_SECRET: 'plat-secret',
    VECTOR_BACKEND: 'sqlite',
    CRON_SECRET: 'cron-test',
  })
  const store = new SqliteStore(config.sqlitePath)
  const platform = new PlatformStore(config.platformSqlitePath)
  const storage = new LocalObjectStorage(config.uploadRoot)
  const app = createApp({
    config,
    store,
    embeddings: new HashingEmbeddingProvider(),
    llm: new ScriptedLlm(),
    platform,
    storage,
  })
  return { app, store, platform, config }
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app).post('/api/login').send({ email, password: 'AnjzDemo!26' }).expect(200)
  const cookie = response.headers['set-cookie']
  return Array.isArray(cookie) ? cookie : [String(cookie)]
}

describe('company platform isolation', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.()
  })

  it('keeps events and designs inside the session company', async () => {
    const { app, store } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const nebras = await login(app, 'sara@nebras.sa')
    const qimam = await login(app, 'fahd@qimam.sa')

    const created = await request(app)
      .post('/api/events')
      .set('Cookie', nebras)
      .send({ title: 'إطلاق نبراس', date: '2026-11-02', category: 'launch', reminderDays: [7, 1], company_id: 'company_qimam' })
      .expect(201)
    const eventId = created.body.event.id as string

    const stolen = await request(app).put(`/api/events/${eventId}`).set('Cookie', qimam).send({
      title: 'سرقة',
      date: '2026-11-02',
      category: 'launch',
    }).expect(404)
    expect(stolen.body.code).toBe('NOT_FOUND')

    const listed = await request(app).get('/api/events').set('Cookie', qimam).expect(200)
    expect(listed.body.events).toHaveLength(0)

    const composed = await request(app)
      .post('/api/designs/compose')
      .set('Cookie', nebras)
      .send({
        eventId,
        eventTitle: 'إطلاق نبراس',
        productId: 'prd-poster',
        productName: 'ملصقات',
        purpose: 'إطلاق',
        language: 'ar',
      })
      .expect(201)
    expect(composed.body.design.svg).toContain('نبراس')
    expect(composed.body.design.companyId).toBe('company_nebras')
    expect(composed.body.design.backgroundKind).toBe('branded_svg')

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    await request(app)
      .post('/api/brand/logo')
      .set('Cookie', nebras)
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' })
      .expect(200)
    const branded = await request(app)
      .post('/api/designs/compose')
      .set('Cookie', nebras)
      .send({
        eventId,
        eventTitle: 'إطلاق نبراس',
        productId: 'prd-poster',
        productName: 'ملصقات',
        purpose: 'إطلاق',
        language: 'ar',
      })
      .expect(201)
    expect(branded.body.design.svg).toContain('<image')
    expect(branded.body.design.svg).toContain('data:image/png;base64,')

    const qimamDesigns = await request(app).get('/api/designs').set('Cookie', qimam).expect(200)
    expect(qimamDesigns.body.designs).toHaveLength(0)

    const stolenLogo = await request(app).get('/api/brand/logo').set('Cookie', qimam).expect(404)
    expect(stolenLogo.body.code).toBe('NO_LOGO')
    const qimamCompose = await request(app)
      .post('/api/designs/compose')
      .set('Cookie', qimam)
      .send({
        eventTitle: 'مؤتمر قمم',
        productId: 'prd-poster',
        productName: 'ملصقات',
        purpose: 'إطلاق',
        language: 'ar',
        company_id: 'company_nebras',
      })
      .expect(201)
    expect(qimamCompose.body.design.svg).not.toContain(png.toString('base64'))
    expect(qimamCompose.body.design.companyId).toBe('company_qimam')
  })

  it('protects the reminder cron and avoids duplicate deliveries', async () => {
    const { app, store, platform } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    await request(app).post('/api/internal/cron/reminders').expect(401)
    const nebras = await login(app, 'sara@nebras.sa')
    const today = riyadhYmd()
    const date = addDays(today, 7)
    await request(app).post('/api/events').set('Cookie', nebras).send({
      title: 'تذكير أسبوع',
      date,
      category: 'internal',
      reminderDays: [7],
    }).expect(201)
    const first = dispatchDueReminders(platform)
    const second = dispatchDueReminders(platform)
    expect(first.created).toBe(1)
    expect(second.created).toBe(0)
    expect(daysUntil(date, today)).toBe(7)
  })

  it('rejects oversized/invalid logos', async () => {
    const { app, store } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const cookie = await login(app, 'sara@nebras.sa')
    await request(app)
      .post('/api/brand/logo')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('not-an-image'), 'notes.txt')
      .expect(400)
  })
})
