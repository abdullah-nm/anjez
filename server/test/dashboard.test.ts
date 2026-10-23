import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { activityBoard, activityTrend, adminAttention, applyDashboardFocus, changeRatio, generationPerformance, orderNeedsFollowUp, parseDashboardRange } from '../observability/dashboard.ts'
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
    expect(board.occasions.find((item) => item.key === null)).toMatchObject({ label: 'غير محدد', generations: 1, orders: 0 })
    expect(board.generationsPerCompany).toBe(2)
    expect(board.savedRequests).toBe(1)
    expect(board.calendarDays).toBe(1)
    expect(board.averageDailyOrders).toBe(1)
    expect(board.periodPartial).toBe(true)
    expect(board.cities).toEqual([expect.objectContaining({ label: 'غير محدد', orders: 1 })])
    expect(board.leaders).toEqual([])
    expect(board.products).toEqual([expect.objectContaining({ productId: 'prd-invite', orders: 1, quantity: 10 })])
    expect(board.companyActivity).toEqual([expect.objectContaining({ companyId: 'company_a', generations: 2, orders: 0 })])
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
    }, { now: Date.now(), failedDesignIds: new Set() })
    expect(follow).toBeNull()
    const late = orderNeedsFollowUp({
      id: 'ORD-2',
      userName: 'ناصر',
      productId: 'prd-invite',
      status: 'محفوظ',
      quantity: 10,
      deliveryDate: '2020-01-01',
      designId: null,
      createdAt: new Date().toISOString(),
    }, { now: Date.parse('2026-10-23T12:00:00+03:00'), failedDesignIds: new Set() })
    expect(late).toContain('2020-01-01')
    const trend = activityTrend({
      from: Date.parse('2026-10-22T00:00:00+03:00'),
      to: Date.parse('2026-10-23T15:00:00+03:00'),
      jobs: [{ status: 'succeeded', requested_at: Date.parse('2026-10-23T10:00:00+03:00') }],
      orders: [{ status: 'محفوظ', createdAt: new Date(Date.parse('2026-10-24T01:00:00+03:00')).toISOString() }],
    })
    expect(trend.map((point) => point.day)).toEqual(['2026-10-22', '2026-10-23'])
    expect(trend[1]).toMatchObject({ succeeded: 1, orders: 0, partial: true })
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
      deliveryCity: 'جده',
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
    expect(report.body.board.cities).toEqual([expect.objectContaining({ label: 'جدة', orders: 1 })])
    expect(report.body.board.savedRequests).toBe(1)
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
    expect(stored).toContain('جدة')
    expect(stored).not.toContain('جده')
    db.close()
  })

  it('ranks saved orders by company and delivery city without counting cancelled rows or retries as new operations', () => {
    const from = Date.parse('2026-10-22T00:00:00+03:00')
    const to = Date.parse('2026-10-23T15:00:00+03:00')
    const board = activityBoard({
      from,
      to,
      previousFrom: Date.parse('2026-10-20T00:00:00+03:00'),
      previousTo: Date.parse('2026-10-22T00:00:00+03:00'),
      companiesTotal: 3,
      registrations: [],
      jobs: [],
      previousJobs: [],
      orders: [
        { id: 'ORD-1', companyId: 'c1', companyName: 'الأولى', userName: 'أ', productId: 'prd-poster', status: 'محفوظ', quantity: 40, deliveryDate: '2026-12-01', deliveryCity: 'جده', designId: null, createdAt: new Date(Date.parse('2026-10-22T10:00:00+03:00')).toISOString() },
        { id: 'ORD-2', companyId: 'c1', companyName: 'الأولى', userName: 'أ', productId: 'prd-invite', status: 'محفوظ', quantity: 5, deliveryDate: '2026-12-01', deliveryCity: 'Jeddah', designId: null, createdAt: new Date(Date.parse('2026-10-22T11:00:00+03:00')).toISOString() },
        { id: 'ORD-3', companyId: 'c2', companyName: 'الثانية', userName: 'ب', productId: 'prd-mug', status: 'محفوظ', quantity: 2, deliveryDate: '2026-12-01', deliveryCity: '', designId: null, createdAt: new Date(Date.parse('2026-10-23T09:00:00+03:00')).toISOString() },
        { id: 'ORD-4', companyId: 'c1', companyName: 'الأولى', userName: 'أ', productId: 'prd-poster', status: 'ملغى', quantity: 99, deliveryDate: '2026-12-01', deliveryCity: 'الرياض', designId: null, createdAt: new Date(Date.parse('2026-10-22T12:00:00+03:00')).toISOString() },
      ],
      previousOrders: [
        { id: 'ORD-0', companyId: 'c2', companyName: 'الثانية', userName: 'ب', productId: 'prd-mug', status: 'محفوظ', quantity: 1, deliveryDate: '2026-12-01', deliveryCity: 'الرياض', designId: null, createdAt: new Date(Date.parse('2026-10-21T10:00:00+03:00')).toISOString() },
      ],
      companyNames: new Map([['c1', 'الأولى'], ['c2', 'الثانية']]),
    })
    expect(board.savedRequests).toBe(3)
    expect(board.calendarDays).toBe(2)
    expect(board.averageDailyOrders).toBe(1.5)
    expect(board.periodPartial).toBe(true)
    expect(board.products.map((item) => item.quantity)).toEqual([40, 5, 2])
    expect(board.cities.map((city) => [city.label, city.orders])).toEqual([['جدة', 2], ['غير محدد', 1]])
    expect(board.leaders).toEqual([expect.objectContaining({ companyId: 'c1', orders: 2 })])
    expect(board.leadersTied).toBe(false)
    expect(board.orderTrend.map((point) => [point.day, point.orders, point.previousOrders])).toEqual([
      ['2026-10-22', 2, 0],
      ['2026-10-23', 1, 1],
    ])
    const tied = activityBoard({
      from,
      to,
      previousFrom: from,
      previousTo: from,
      companiesTotal: 2,
      registrations: [],
      jobs: [],
      previousJobs: [],
      orders: [
        { id: 'ORD-8', companyId: 'c1', companyName: 'الأولى', userName: 'أ', productId: 'prd-poster', status: 'محفوظ', quantity: 1, deliveryDate: '2026-12-01', deliveryCity: 'الرياض', designId: null, createdAt: new Date(from).toISOString() },
        { id: 'ORD-9', companyId: 'c2', companyName: 'الثانية', userName: 'ب', productId: 'prd-poster', status: 'محفوظ', quantity: 9, deliveryDate: '2026-12-01', deliveryCity: 'الرياض', designId: null, createdAt: new Date(from).toISOString() },
      ],
      previousOrders: [],
    })
    expect(tied.leadersTied).toBe(true)
    expect(tied.leaders.map((row) => row.companyId).sort()).toEqual(['c1', 'c2'])
    expect(tied.leaders.every((row) => row.orders === 1)).toBe(true)

    const perf = generationPerformance({
      from: Date.parse('2026-10-23T00:00:00+03:00'),
      to: Date.parse('2026-10-23T12:00:00+03:00'),
      jobs: [
        { id: 'gen_fail', company_id: 'c1', status: 'failed', requested_at: Date.parse('2026-10-23T09:00:00+03:00'), api_duration_ms: 150, generation_duration_ms: 150, failure_code: 'QUOTA', http_status: 200 },
        { id: 'gen_run', company_id: 'c1', status: 'running', requested_at: Date.parse('2026-10-23T10:00:00+03:00'), api_duration_ms: null, generation_duration_ms: null, failure_code: null },
        { id: 'gen_ok', company_id: 'c1', status: 'succeeded', requested_at: Date.parse('2026-10-23T11:00:00+03:00'), api_duration_ms: 400, generation_duration_ms: 900, failure_code: null, http_status: 200 },
      ],
      attempts: [
        { job_id: 'gen_fail', failure_code: 'QUOTA' },
        { job_id: 'gen_fail', failure_code: 'QUOTA' },
        { job_id: 'gen_ok', failure_code: null },
      ],
    })
    expect(perf.started).toBe(3)
    expect(perf.providerCalls).toBe(3)
    expect(perf.succeeded).toBe(1)
    expect(perf.failed).toBe(1)
    expect(perf.inProgress).toBe(1)
    expect(perf.successRate).toBe(0.5)
    expect(perf.sameMeasurement).toBe(false)
    expect(perf.avgApiMs).toBe(275)
    expect(perf.avgGenerationMs).toBe(900)
    expect(perf.failures).toEqual([expect.objectContaining({ code: 'QUOTA', count: 1 })])
    const sameClock = generationPerformance({
      from: Date.parse('2026-10-23T00:00:00+03:00'),
      to: Date.parse('2026-10-23T12:00:00+03:00'),
      jobs: [
        { id: 'gen_ok', company_id: 'c1', status: 'succeeded', requested_at: Date.parse('2026-10-23T11:00:00+03:00'), api_duration_ms: 150, generation_duration_ms: 150, failure_code: null, http_status: 200 },
      ],
      attempts: [],
    })
    expect(sameClock.sameMeasurement).toBe(true)
    expect(sameClock.avgApiMs).toBe(150)
    expect(sameClock.avgGenerationMs).toBe(150)

    const attention = adminAttention({
      now: Date.parse('2026-10-23T12:00:00+03:00'),
      orders: [{ id: 'ORD-9', companyId: 'c1', companyName: 'الأولى', userName: 'أ', productId: 'prd-poster', status: 'محفوظ', quantity: 1, deliveryDate: '2020-01-01', designId: null, createdAt: '2026-10-23T08:00:00.000Z' }],
      jobs: [{ id: 'gen_fail', company_id: 'c1', status: 'failed', requested_at: 1, finished_at: 2, api_duration_ms: 10, generation_duration_ms: 10, failure_code: 'QUOTA', http_status: 200 }],
      attempts: [
        { job_id: 'gen_fail', company_id: 'c1', at: 1, failure_code: 'QUOTA' },
        { job_id: 'gen_fail', company_id: 'c1', at: 2, failure_code: 'QUOTA' },
      ],
      companyNames: new Map([['c1', 'الأولى']]),
      failedDesignIds: new Set(),
    })
    expect(attention.find((item) => item.kind === 'order')?.subject).toBe('ORD-9')
    expect(attention.find((item) => item.kind === 'generation')?.reason).toBe('تجاوز حصة المزود')
    expect(attention.find((item) => item.kind === 'provider')?.reason).toContain('2 استدعاءات')
  })

  it('filters orders by city without dropping generations, and filters both by company or occasion', () => {
    const orders = [
      { id: 'ORD-1', companyId: 'c1', userName: 'أ', productId: 'prd-poster', status: 'محفوظ', quantity: 2, deliveryDate: '2026-12-01', deliveryCity: 'الرياض', designId: 'des-1', createdAt: '2026-10-23T08:00:00.000Z', occasionKey: 'eid-fitr' },
      { id: 'ORD-2', companyId: 'c2', userName: 'ب', productId: 'prd-mug', status: 'محفوظ', quantity: 1, deliveryDate: '2026-12-01', deliveryCity: '', designId: null, createdAt: '2026-10-23T09:00:00.000Z', occasionKey: null },
    ]
    const jobs = [
      { id: 'gen-1', company_id: 'c1', user_name: 'أ', user_id: null, requested_at: 1, started_at: null, finished_at: 2, status: 'succeeded' as const, http_status: 200, api_duration_ms: 10, generation_duration_ms: 10, failure_code: null, preview_mime: 'image/png', kind: 'image', design_id: 'des-1', order_id: null, background_stage: null, provider_attempts: 1, provider_duration_ms: 10 },
      { id: 'gen-2', company_id: 'c2', user_name: 'ب', user_id: null, requested_at: 1, started_at: null, finished_at: 2, status: 'succeeded' as const, http_status: 200, api_duration_ms: 10, generation_duration_ms: 10, failure_code: null, preview_mime: null, kind: 'image', design_id: null, order_id: null, background_stage: null, provider_attempts: 1, provider_duration_ms: 10 },
    ]
    const attempts = [
      { job_id: 'gen-1', company_id: 'c1', at: 1, duration_ms: 10, http_status: 200, failure_code: null, model: 'm' },
      { job_id: 'gen-2', company_id: 'c2', at: 1, duration_ms: 10, http_status: 200, failure_code: null, model: 'm' },
    ]
    const links = new Map([['des-1', 'eid-fitr']])
    const byCity = applyDashboardFocus({
      focus: { cityKey: 'الرياض' },
      orders,
      previousOrders: [],
      jobs,
      previousJobs: [],
      attempts,
      live: [{ id: 'gen-2' }],
      occasionByDesign: links,
    })
    expect(byCity.orders.map((order) => order.id)).toEqual(['ORD-1'])
    expect(byCity.jobs.map((job) => job.id)).toEqual(['gen-1', 'gen-2'])
    expect(byCity.attempts).toHaveLength(2)
    expect(byCity.scope.citySkipsGenerations).toBe(true)
    const byCompany = applyDashboardFocus({
      focus: { companyId: 'c1' },
      orders,
      previousOrders: [],
      jobs,
      previousJobs: [],
      attempts,
      live: [{ id: 'gen-2' }],
      occasionByDesign: links,
    })
    expect(byCompany.orders.map((order) => order.id)).toEqual(['ORD-1'])
    expect(byCompany.jobs.map((job) => job.id)).toEqual(['gen-1'])
    expect(byCompany.live).toEqual([])
    const byOccasion = applyDashboardFocus({
      focus: { occasionKey: 'eid-fitr' },
      orders,
      previousOrders: [],
      jobs,
      previousJobs: [],
      attempts,
      live: [],
      occasionByDesign: links,
    })
    expect(byOccasion.orders.map((order) => order.id)).toEqual(['ORD-1'])
    expect(byOccasion.jobs.map((job) => job.id)).toEqual(['gen-1'])
    expect(byOccasion.attempts.map((attempt) => attempt.job_id)).toEqual(['gen-1'])
  })
})
