import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { AppError } from '../lib/errors.ts'
import { loadConfig } from '../config.ts'
import type { ImageGenerator } from '../lib/imageGeneration.ts'
import { MetricsStore } from '../observability/metrics.ts'
import { LocalObjectStorage } from '../platform/storage.ts'
import { PlatformStore } from '../platform/store.ts'
import { seedAccounts } from '../seed.ts'
import { SqliteStore } from '../store.ts'
import { HashingEmbeddingProvider, ScriptedLlm } from './hashingEmbeddings.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function harness(images?: ImageGenerator) {
  const dir = mkdtempSync(join(tmpdir(), 'anjz-gen-'))
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'k.sqlite'),
    PLATFORM_SQLITE_PATH: join(dir, 'p.sqlite'),
    UPLOAD_ROOT: join(dir, 'up'),
    SESSION_SECRET: 'gen-secret',
    VECTOR_BACKEND: 'sqlite',
    EMBEDDING_DIMENSIONS: '64',
  })
  const store = new SqliteStore(config.sqlitePath)
  await seedAccounts(store)
  const metrics = new MetricsStore(config.platformSqlitePath)
  const app = createApp({
    config,
    store,
    embeddings: new HashingEmbeddingProvider(),
    llm: new ScriptedLlm(),
    platform: new PlatformStore(config.platformSqlitePath),
    storage: new LocalObjectStorage(config.uploadRoot),
    metrics,
    images,
  })
  return { app, store, metrics, config }
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app).post('/api/login').send({ email, password: 'AnjzDemo!26' })
  const cookie = response.headers['set-cookie']
  return Array.isArray(cookie) ? cookie : [String(cookie)]
}

const body = {
  description: 'دعوة فاخرة بنقوش هندسية ومساحة للنص',
  productName: 'بطاقات دعوة',
  eventTitle: 'منتدى القيادة',
  layout: 'portrait',
  palette: ['#1f2937', '#b8893d'],
}

describe('generation monitor', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.()
  })

  it('records a displayable image as success and keeps the preview for the same company admin', async () => {
    const { app, store } = await harness({ generate: async () => PNG })
    cleanups.push(() => store.close())
    const admin = await login(app, 'nasser@almarai.com')
    const member = await login(app, 'hind@almarai.com')
    const other = await login(app, 'fahd@qimam.sa')

    const generated = await request(app).post('/api/design/generate').set('Cookie', admin).send(body).expect(200)
    expect(generated.body.imageDataUrl.startsWith('data:image/png;base64,')).toBe(true)

    const report = await request(app).get('/api/observability/generations?window=1h').set('Cookie', admin).expect(200)
    expect(report.body.totals).toMatchObject({ total: 1, succeeded: 1, failed: 0, incomplete: 0, successRate: 1 })
    expect(report.body.recent[0].status).toBe('succeeded')
    expect(report.body.recent[0].httpStatus).toBe(200)
    expect(report.body.recent[0].apiDurationMs).toEqual(expect.any(Number))
    expect(report.body.recent[0].generationDurationMs).toEqual(expect.any(Number))
    expect(report.body.recent[0].previewUrl).toBe(`/api/observability/generations/${report.body.recent[0].id}/preview`)

    const preview = await request(app).get(report.body.recent[0].previewUrl).set('Cookie', admin).expect(200)
    expect(preview.headers['content-type']).toContain('image/png')
    expect(preview.body.length).toBeGreaterThan(30)

    await request(app).get('/api/observability/generations').set('Cookie', member).expect(403)
    await request(app).get(report.body.recent[0].previewUrl).set('Cookie', member).expect(403)
    const hidden = await request(app).get('/api/observability/generations?window=1h').set('Cookie', other).expect(200)
    expect(hidden.body.totals.total).toBe(0)
    const sharedPreview = await request(app).get(report.body.recent[0].previewUrl).set('Cookie', other).expect(200)
    expect(sharedPreview.headers['content-type']).toContain('image/png')
  })

  it('does not treat an invalid provider payload as a generated design', async () => {
    const { app, store } = await harness({ generate: async () => 'data:image/webp;base64,dGVzdA==' })
    cleanups.push(() => store.close())
    const admin = await login(app, 'nasser@almarai.com')
    const response = await request(app).post('/api/design/generate').set('Cookie', admin).send(body).expect(422)
    expect(response.body.code).toBe('INVALID_OUTPUT')
    const report = await request(app).get('/api/observability/generations?window=1h').set('Cookie', admin).expect(200)
    expect(report.body.totals).toMatchObject({ total: 1, succeeded: 0, failed: 1, successRate: 0 })
    expect(report.body.recent[0].status).toBe('failed')
    expect(report.body.recent[0].httpStatus).toBe(422)
    expect(report.body.recent[0].previewUrl).toBeNull()
    expect(report.body.failures[0].code).toBe('INVALID_OUTPUT')
  })

  it('records a provider quota rejection as a failed generation', async () => {
    const { app, store } = await harness({
      generate: async () => {
        throw new AppError('تجاوز الحصة', 429, 'IMAGE_GENERATION_UNAVAILABLE')
      },
    })
    cleanups.push(() => store.close())
    const admin = await login(app, 'nasser@almarai.com')
    const response = await request(app).post('/api/design/generate').set('Cookie', admin).send(body).expect(429)
    expect(response.body.code).toBe('IMAGE_GENERATION_UNAVAILABLE')
    const report = await request(app).get('/api/observability/generations?window=1h').set('Cookie', admin).expect(200)
    expect(report.body.recent[0]).toMatchObject({ status: 'failed', httpStatus: 429, failureCode: 'QUOTA', previewUrl: null })
    expect(report.body.totals.successRate).toBe(0)
  })

  it('keeps an in-flight generation running across refreshes and excludes it from the success rate', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { app, store } = await harness({
      generate: async () => {
        await gate
        return PNG
      },
    })
    cleanups.push(() => store.close())
    const admin = await login(app, 'nasser@almarai.com')
    const pending = request(app).post('/api/design/generate').set('Cookie', admin).send(body)
    void pending.then(() => undefined)
    let running = false
    let lastStatus = 'missing'
    for (let attempt = 0; attempt < 30 && !running; attempt += 1) {
      const report = await request(app).get('/api/observability/generations?window=1h').set('Cookie', admin)
      lastStatus = report.body.recent?.[0]?.status ?? `empty:${report.status}`
      running = lastStatus === 'running'
      if (!running) await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(lastStatus).toBe('running')
    const again = await request(app).get('/api/observability/generations?window=1h&status=running').set('Cookie', admin).expect(200)
    expect(again.body.recent[0].status).toBe('running')
    expect(again.body.totals.incomplete).toBe(1)
    expect(again.body.totals.successRate).toBeNull()
    release()
    await pending.expect(200)
    const done = await request(app).get('/api/observability/generations?window=1h').set('Cookie', admin).expect(200)
    expect(done.body.recent[0].status).toBe('succeeded')
    expect(done.body.totals.successRate).toBe(1)
  })

  it('times out abandoned jobs without timing out an active one, and stores no prompt or secret', async () => {
    const { app, store, metrics, config } = await harness()
    cleanups.push(() => store.close())
    const now = Date.now()
    const stale = metrics.openGeneration({ companyId: 'company_almarai', userName: 'ناصر', now: now - 130_000 })
    metrics.markGenerationRunning(stale, now - 130_000)
    const active = metrics.openGeneration({ companyId: 'company_almarai', userName: 'ناصر', now: now - 130_000 })
    metrics.markGenerationRunning(active, now - 130_000)
    metrics.finishGeneration({
      id: metrics.openGeneration({ companyId: 'company_almarai', userName: 'ناصر', now }),
      status: 'failed',
      httpStatus: 503,
      apiDurationMs: 40,
      generationDurationMs: 30,
      failureCode: 'QUOTA',
      now,
    })
    const report = metrics.generationReport({
      companyId: 'company_almarai',
      window: '1h',
      activeIds: [active],
      now,
    })
    expect(report.recent.find((row) => row.id === stale)?.status).toBe('timeout')
    expect(report.recent.find((row) => row.id === active)?.status).toBe('running')
    expect(report.totals.successRate).toBe(0)
    expect(report.totals.incomplete).toBe(1)
    expect(report.failures.map((item) => item.code).sort()).toEqual(['QUOTA', 'TIMEOUT'])

    const admin = await login(app, 'nasser@almarai.com')
    await request(app).post('/api/design/generate').set('Cookie', admin).send({
      ...body,
      description: 'عبارة سرية لا يجوز تخزينها UNIQUEPROMPT',
    }).expect(503)
    const db = new DatabaseSync(config.platformSqlitePath)
    const stored = JSON.stringify(db.prepare('SELECT * FROM generation_jobs').all())
    expect(stored).not.toContain('UNIQUEPROMPT')
    expect(stored).not.toContain('nasser@almarai.com')
    expect(stored).not.toContain('GEMINI')
    db.close()
  })
})
