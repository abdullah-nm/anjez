import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { upcomingDesignOccasions } from '../../src/studioOccasions.ts'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { HashingEmbeddingProvider, ScriptedLlm } from './hashingEmbeddings.ts'
import { LocalObjectStorage } from '../platform/storage.ts'
import { PlatformStore } from '../platform/store.ts'
import { seedAccounts } from '../seed.ts'
import { SqliteStore } from '../store.ts'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'anjz-studio-'))
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'k.sqlite'),
    PLATFORM_SQLITE_PATH: join(dir, 'p.sqlite'),
    UPLOAD_ROOT: join(dir, 'up'),
    SESSION_SECRET: 'studio-secret',
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
  return { app, store }
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app).post('/api/login').send({ email, password: 'AnjzDemo!26' }).expect(200)
  const cookie = response.headers['set-cookie']
  return Array.isArray(cookie) ? cookie : [String(cookie)]
}

const today = '2026-10-22'

describe('studio occasion list', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.()
  })

  it('keeps upcoming company events, drops past and completed rows, and does not repeat a system template', () => {
    const list = upcomingDesignOccasions({
      events: [
        { id: 'evt-future', title: 'إطلاق', date: '2026-11-02', status: 'planned', occasionKey: null },
        { id: 'evt-same-title', title: 'إطلاق', date: '2026-12-01', status: 'planned', occasionKey: null },
        { id: 'evt-past', title: 'قديم', date: '2026-01-01', status: 'planned', occasionKey: null },
        { id: 'evt-done', title: 'مكتمل', date: '2026-12-20', status: 'done', occasionKey: null },
        { id: 'evt-company-copy', title: 'يوم التأسيس', date: '2027-02-22', status: 'planned', occasionKey: 'founding-day' },
        { id: 'evt-demo-national', title: '[تجريبي] اليوم الوطني السعودي 2027', date: '2027-09-23', status: 'planned', occasionKey: null },
      ],
      systemOccasions: [
        { id: 'sys:founding-day', key: 'founding-day', titleAr: 'يوم التأسيس', date: '2027-02-22' },
        { id: 'sys:riyadh-season', key: 'riyadh-season', titleAr: 'موسم الرياض', date: null },
        { id: 'sys:national-day', key: 'national-day', titleAr: 'اليوم الوطني السعودي', date: '2027-09-23' },
        { id: 'sys:old-national', key: 'flag-day', titleAr: 'يوم العلم', date: '2026-09-23' },
      ],
    }, today)

    expect(list.map((item) => item.id)).toEqual(['evt-future', 'evt-same-title', 'evt-company-copy', 'evt-demo-national'])
    expect(list.filter((item) => item.id === 'sys:founding-day' || item.id === 'sys:national-day')).toHaveLength(0)
    expect(list.filter((item) => item.occasionKey === 'founding-day')).toHaveLength(1)
    expect(list.every((item) => item.date >= today)).toBe(true)
  })

  it('shows a newly added company event in the studio list without duplicating it', async () => {
    const { app, store } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const almarai = await login(app, 'nasser@almarai.com')
    const qimam = await login(app, 'fahd@qimam.sa')

    const created = await request(app).post('/api/events').set('Cookie', almarai).send({
      title: 'إطلاق المراعي',
      date: '2026-11-02',
      category: 'launch',
      company_id: 'company_qimam',
    }).expect(201)

    const first = await request(app).get('/api/events').set('Cookie', almarai).expect(200)
    const firstList = upcomingDesignOccasions(first.body, today)
    expect(firstList.filter((item) => item.id === created.body.event.id)).toHaveLength(1)
    expect(firstList.find((item) => item.id === created.body.event.id)?.title).toBe('إطلاق المراعي')
    expect(first.body.events.some((event: { id: string, status: string }) => event.status === 'done' && event.id === created.body.event.id)).toBe(false)

    const added = await request(app).post('/api/events').set('Cookie', almarai).send({
      title: 'إطلاق المراعي',
      date: '2026-12-01',
      category: 'launch',
    }).expect(201)
    const second = await request(app).get('/api/events').set('Cookie', almarai).expect(200)
    const secondList = upcomingDesignOccasions(second.body, today)
    expect(secondList.filter((item) => item.id === created.body.event.id)).toHaveLength(1)
    expect(secondList.filter((item) => item.id === added.body.event.id)).toHaveLength(1)
    expect(secondList.map((item) => item.date)).toEqual([...secondList.map((item) => item.date)].sort())

    const other = await request(app).get('/api/events').set('Cookie', qimam).expect(200)
    expect(upcomingDesignOccasions(other.body, today).some((item) => item.id === created.body.event.id)).toBe(false)

    await request(app).post('/api/events').set('Cookie', almarai).send({
      title: 'مناسبة قديمة',
      date: '2026-01-04',
      category: 'internal',
    }).expect(201)
    await request(app).put(`/api/events/${added.body.event.id}`).set('Cookie', almarai).send({
      title: 'إطلاق المراعي',
      date: '2026-12-01',
      category: 'launch',
      status: 'done',
    }).expect(200)
    const calendar = await request(app).get('/api/events').set('Cookie', almarai).expect(200)
    expect(calendar.body.events.some((event: { title: string }) => event.title === 'مناسبة قديمة')).toBe(true)
    expect(calendar.body.events.some((event: { id: string, status: string }) => event.id === added.body.event.id && event.status === 'done')).toBe(true)
    const visible = upcomingDesignOccasions(calendar.body, today)
    expect(visible.some((item) => item.title === 'مناسبة قديمة')).toBe(false)
    expect(visible.some((item) => item.id === added.body.event.id)).toBe(false)
    expect(visible.filter((item) => item.id === 'sys:founding-day' || item.occasionKey === 'founding-day')).toHaveLength(1)
  })

  it('sends the selected event id and rejects an event from another company', async () => {
    const { app, store } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const almarai = await login(app, 'nasser@almarai.com')
    const qimam = await login(app, 'fahd@qimam.sa')
    const created = await request(app).post('/api/events').set('Cookie', almarai).send({
      title: 'إطلاق المراعي',
      date: '2026-11-02',
      category: 'launch',
    }).expect(201)
    const eventId = created.body.event.id as string

    const design = await request(app).post('/api/designs/compose').set('Cookie', almarai).send({
      eventId,
      eventTitle: 'اسم مزيف من المتصفح',
      productId: 'prd-poster',
      productName: 'ملصقات',
      content: '',
      company_id: 'company_qimam',
    }).expect(201)
    expect(design.body.design.eventId).toBe(eventId)
    expect(design.body.design.companyId).toBe('company_almarai')
    expect(design.body.design.headline).toBe('إطلاق المراعي')

    const stolen = await request(app).post('/api/designs/compose').set('Cookie', qimam).send({
      eventId,
      eventTitle: 'إطلاق المراعي',
      productId: 'prd-poster',
      productName: 'ملصقات',
      company_id: 'company_almarai',
    }).expect(404)
    expect(stolen.body.code).toBe('NOT_FOUND')
    await request(app).post('/api/designs/compose').set('Cookie', almarai).send({
      eventId: 'evt-missing',
      eventTitle: 'غير موجود',
      productId: 'prd-poster',
      productName: 'ملصقات',
    }).expect(404)

    const listed = await request(app).get('/api/events').set('Cookie', almarai).expect(200)
    const founding = listed.body.systemOccasions.find((item: { key: string }) => item.key === 'founding-day')
    const systemDesign = await request(app).post('/api/designs/compose').set('Cookie', qimam).send({
      eventId: founding.id,
      eventTitle: 'عنوان شركة أخرى',
      productId: 'prd-poster',
      productName: 'ملصقات',
      content: '',
      company_id: 'company_almarai',
    }).expect(201)
    expect(systemDesign.body.design.eventId).toBe('sys:founding-day')
    expect(systemDesign.body.design.companyId).toBe('company_qimam')
    expect(systemDesign.body.design.headline).toBe('يوم التأسيس')
    await request(app).post('/api/designs/compose').set('Cookie', qimam).send({
      eventId: 'sys:not-real',
      productId: 'prd-poster',
      productName: 'ملصقات',
    }).expect(404)

    const qimamDesigns = await request(app).get('/api/designs').set('Cookie', qimam).expect(200)
    expect(qimamDesigns.body.designs.every((item: { companyId: string }) => item.companyId === 'company_qimam')).toBe(true)
    expect(qimamDesigns.body.designs.some((item: { eventId: string }) => item.eventId === eventId)).toBe(false)
  })
})
