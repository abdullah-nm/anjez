import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { activityBoard, changeRatio, orderNeedsFollowUp, parseDashboardRange } from '../observability/dashboard.ts'
import { MetricsStore } from '../observability/metrics.ts'
import { LocalObjectStorage } from '../platform/storage.ts'
import { PlatformStore } from '../platform/store.ts'
import { seedAccounts } from '../seed.ts'
import { SqliteStore } from '../store.ts'
import { HashingEmbeddingProvider, ScriptedLlm } from './hashingEmbeddings.ts'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'anjz-dash-'))
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'k.sqlite'),
    PLATFORM_SQLITE_PATH: join(dir, 'p.sqlite'),
    UPLOAD_ROOT: join(dir, 'up'),
    SESSION_SECRET: 'dash-secret',
    VECTOR_BACKEND: 'sqlite',
    ORDER_FOLLOWUP_HOURS: '48',
  })
  const store = new SqliteStore(config.sqlitePath)
  const metrics = new MetricsStore(config.platformSqlitePath)
  const platform = new PlatformStore(config.platformSqlitePath)
  const app = createApp({
    config,
    store,
    embeddings: new HashingEmbeddingProvider(),
    llm: new ScriptedLlm(),
    platform,
    storage: new LocalObjectStorage(config.uploadRoot),
    metrics,
  })
  return { app, store, metrics, platform, config }
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app).post('/api/login').send({ email, password: 'AnjzDemo!26' })
  const cookie = response.headers['set-cookie']
  return Array.isArray(cookie) ? cookie : [String(cookie)]
}

describe('operations dashboard', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.()
  })

  it('keeps raster images, open print orders, and saved occasions distinct', () => {
    const board = activityBoard({
      from: 1_000,
      to: 5_000,
      previousFrom: 0,
      previousTo: 1_000,
      companiesTotal: 2,
      registrations: [200, 1_200],
      jobs: [
        { company_id: 'company_a', status: 'succeeded', preview_mime: 'image/png', design_id: 'des_aa', requested_at: 2_000, generation_duration_ms: 100 },
        { company_id: 'company_a', status: 'succeeded', preview_mime: 'image/svg+xml', design_id: 'des_bb', requested_at: 2_100, generation_duration_ms: 50 },
      ],
      previousJobs: [],
      orders: [
        { id: 'ORD-1', userName: 'أ', productId: 'prd-invite', status: 'محفوظ', quantity: 10, deliveryDate: '2026-12-01', designId: 'des_aa', createdAt: new Date(2_000).toISOString(), occasionKey: 'eid-adha' },
        { id: 'ORD-2', userName: 'ب', productId: 'prd-banner', status: 'ملغى', quantity: 1, deliveryDate: '2026-12-01', designId: null, createdAt: new Date(3_000).toISOString(), occasionKey: null },
      ],
      previousOrders: [],
      occasionByDesign: new Map([['des_aa', 'eid-adha'], ['des_bb', null]]),
    })
    expect(board.images).toBe(1)
    expect(board.generationsSucceeded).toBe(2)
    expect(board.companiesNew).toBe(1)
    expect(board.incomplete).toBe(1)
    expect(board.completed).toBe(0)
    expect(board.statuses.reduce((sum, item) => sum + item.count, 0)).toBe(2)
    expect(board.occasions.find((item) => item.key === 'eid-adha')).toMatchObject({ label: 'عيد الأضحى', generations: 1, orders: 1 })
    expect(board.occasions.find((item) => item.key === null)).toMatchObject({ label: 'غير محدد', generations: 1, orders: 1 })
    expect(board.generationsPerCompany).toBe(2)
  })

  it('hides a change ratio when the previous period is zero and rejects an invalid custom range', () => {
    expect(changeRatio(4, 0)).toBeNull()
    expect(changeRatio(4, 2)).toBe(1)
    const now = Date.parse('2026-10-23T04:00:00+03:00')
    const today = parseDashboardRange({ preset: 'today', now })
    expect(today.from).toBe(Date.parse('2026-10-23T00:00:00+03:00'))
    expect(() => parseDashboardRange({ preset: 'custom', from: '2026-10-01', to: '2026-09-01', now })).toThrow('INVALID_RANGE')
  })

  it('counts one compose as one saved design and keeps provider retries on the same operation', async () => {
    const { app, store, metrics } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const admin = await login(app, 'nasser@almarai.com')
    const member = await login(app, 'hind@almarai.com')
    const other = await login(app, 'fahd@qimam.sa')

    const composed = await request(app).post('/api/designs/compose').set('Cookie', admin).send({
      eventId: null,
      eventTitle: 'منتدى',
      productId: 'prd-invite',
      productName: 'بطاقات دعوة',
      purpose: 'دعوة',
      audience: 'شركاء',
      language: 'ar',
      style: 'فاخر',
      dimensions: 'portrait',
      size: 'A6',
      instructions: '',
      content: 'عنوان قصير',
    }).expect(201)
    expect(String(composed.body.design.svg)).toContain('<svg')

    const job = metrics.openGeneration({ companyId: 'company_almarai', userName: 'ناصر', kind: 'image' })
    metrics.markGenerationRunning(job)
    metrics.recordProviderAttempt({ jobId: job, companyId: 'company_almarai', model: 'gemini-test', httpStatus: 429, durationMs: 40, failureCode: 'QUOTA' })
    metrics.recordProviderAttempt({ jobId: job, companyId: 'company_almarai', model: 'gemini-test', httpStatus: 200, durationMs: 80, failureCode: null })
    metrics.finishGeneration({ id: job, status: 'succeeded', httpStatus: 200, apiDurationMs: 150, generationDurationMs: 150, failureCode: null, preview: { mime: 'image/png', bytes: Buffer.from('x') } })

    const report = await request(app).get('/api/observability/dashboard?preset=7d').set('Cookie', admin).expect(200)
    expect(report.body.journey.succeeded).toBeGreaterThanOrEqual(2)
    expect(report.body.api.calls).toBe(2)
    expect(report.body.api.errorRate).toBe(0.5)
    await login(app, 'nasser@almarai.com')
    const again = await request(app).get('/api/observability/dashboard?preset=7d').set('Cookie', admin).expect(200)
    expect(again.body.summary.activeUsers).toBe(3)
    expect(report.body.summary.ordersChange).toBeNull()
    const retried = report.body.recent.find((row: { id: string }) => row.id === job)
    expect(retried.providerAttempts).toBe(2)
    expect(report.body.journey.total).toBe(report.body.recent.length)
    expect(report.body.companies.total).toBe(2)
    expect(report.body.companies.newInPeriod).toBe(2)
    expect(report.body.board.images).toBe(1)
    expect(report.body.board.generationsSucceeded).toBeGreaterThanOrEqual(2)
    expect(report.body.board.images).toBeLessThan(report.body.board.generationsSucceeded)

    await request(app).get('/api/observability/dashboard?preset=7d').set('Cookie', member).expect(403)
    await request(app).get('/api/observability/companies/company_almarai').set('Cookie', member).expect(403)
    const hidden = await request(app).get('/api/observability/dashboard?preset=7d').set('Cookie', other).expect(200)
    expect(hidden.body.journey.total).toBe(report.body.journey.total)
    expect(hidden.body.companies.total).toBe(2)
    await request(app).get('/api/observability/dashboard?preset=custom&from=2026-11-01&to=2026-10-01').set('Cookie', admin).expect(400)

    const follow = orderNeedsFollowUp({
      id: 'ORD-1',
      userName: 'ناصر',
      productId: 'prd-invite',
      status: 'محفوظ',
      quantity: 10,
      deliveryDate: '2099-01-01',
      designId: null,
      createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
    }, { now: Date.now(), followupHours: 48, failedDesignIds: new Set() })
    expect(follow).toContain('48')
  })

  it('records a print order without the address and shows it on every admin dashboard', async () => {
    const { app, store, config } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const admin = await login(app, 'nasser@almarai.com')
    const other = await login(app, 'fahd@qimam.sa')
    const saved = await request(app).post('/api/orders').set('Cookie', admin).send({
      id: 'ORD-123456',
      productId: 'prd-invite',
      quantity: 20,
      deliveryDate: '2026-11-02',
      designId: null,
      address: 'عنوان سري لا يُحفظ',
      notes: 'ملاحظة سرية',
    }).expect(201)
    expect(saved.body.status).toBe('محفوظ')
    expect(saved.body.address).toBeUndefined()

    const report = await request(app).get('/api/observability/dashboard?preset=7d').set('Cookie', admin).expect(200)
    expect(report.body.summary.orders).toBe(1)
    expect(report.body.board.orders).toBe(1)
    expect(report.body.board.incomplete).toBe(1)
    expect(report.body.board.completed).toBe(0)
    expect(report.body.board.statuses.reduce((sum: number, item: { count: number }) => sum + item.count, 0)).toBe(1)
    expect(report.body.orders.recent[0].id).toBe('ORD-123456')
    expect(JSON.stringify(report.body)).not.toContain('عنوان سري')

    const hidden = await request(app).get('/api/observability/dashboard?preset=7d').set('Cookie', other).expect(200)
    expect(hidden.body.summary.orders).toBe(1)
    expect(hidden.body.orders.recent[0].companyId).toBe('company_almarai')
    const ownOrders = await request(app).get('/api/orders').set('Cookie', other).expect(200)
    expect(ownOrders.body.orders).toEqual([])
    const detail = await request(app).get('/api/observability/companies/company_almarai').set('Cookie', other).expect(200)
    expect(detail.body.orders.map((order: { id: string }) => order.id)).toContain('ORD-123456')
    expect(JSON.stringify(detail.body)).not.toContain('عنوان سري')
    const db = new DatabaseSync(config.platformSqlitePath)
    const stored = JSON.stringify(db.prepare('SELECT * FROM print_orders').all())
    expect(stored).not.toContain('عنوان سري')
    expect(stored).not.toContain('ملاحظة سرية')
    db.close()
  })
})
