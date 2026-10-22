import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { percentile95, MetricsStore, type MetricsRecorder } from '../observability/metrics.ts'
import { LocalObjectStorage } from '../platform/storage.ts'
import { PlatformStore } from '../platform/store.ts'
import { seedAccounts } from '../seed.ts'
import { SqliteStore } from '../store.ts'
import { HashingEmbeddingProvider, ScriptedLlm } from './hashingEmbeddings.ts'

function harness(metrics?: MetricsRecorder) {
  const dir = mkdtempSync(join(tmpdir(), 'anjz-obs-'))
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'k.sqlite'),
    PLATFORM_SQLITE_PATH: join(dir, 'p.sqlite'),
    UPLOAD_ROOT: join(dir, 'up'),
    SESSION_SECRET: 'obs-secret',
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
    metrics,
  })
  return { app, store, config }
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app).post('/api/login').send({ email, password: 'AnjzDemo!26' })
  const cookie = response.headers['set-cookie']
  return { status: response.status, cookie: Array.isArray(cookie) ? cookie : [String(cookie)] }
}

function blankMetric(overrides: Partial<Parameters<MetricsStore['record']>[0]> = {}) {
  return {
    companyId: 'company_almarai',
    method: 'GET',
    route: '/api/events',
    feature: 'http',
    status: 200,
    durationMs: 10,
    errorClass: null,
    geminiClass: null,
    retrieveOk: null,
    generateOk: null,
    indexOk: null,
    insufficient: null,
    backgroundKind: null,
    promptTokens: null,
    outputTokens: null,
    usageSamples: 0,
    usageMissing: 0,
    ...overrides,
  }
}

describe('observability', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.()
  })

  it('computes p95 from stored durations and keeps companies apart', () => {
    expect(percentile95([])).toBeNull()
    expect(percentile95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(10)
    const dir = mkdtempSync(join(tmpdir(), 'anjz-metrics-'))
    const metrics = new MetricsStore(join(dir, 'p.sqlite'))
    for (let duration = 1; duration <= 100; duration += 1) {
      metrics.record(blankMetric({
        durationMs: duration,
        status: duration === 100 ? 500 : 200,
        errorClass: duration === 100 ? 'AIzaSySECRETKEY' : null,
        geminiClass: duration === 100 ? 'quota' : null,
        backgroundKind: duration === 1 ? 'not-a-kind' : null,
      }))
    }
    metrics.record(blankMetric({
      companyId: 'company_qimam',
      route: '/api/other-company-probe',
      durationMs: 5,
    }))
    const almarai = metrics.summary({ companyId: 'company_almarai', window: '1h' })
    const qimam = metrics.summary({ companyId: 'company_qimam', window: '1h' })
    expect(almarai.requests.total).toBe(100)
    expect(almarai.requests.failed).toBe(1)
    expect(almarai.requests.p95Ms).toBe(95)
    expect(almarai.requests.errorRate).toBe(0.01)
    expect(almarai.gemini).toEqual([{ geminiClass: 'quota', count: 1 }])
    expect(JSON.stringify(almarai)).not.toContain('AIza')
    expect(JSON.stringify(almarai)).not.toContain('other-company-probe')
    expect(qimam.requests.total).toBe(1)
    expect(qimam.routes[0]?.route).toBe('/api/other-company-probe')
    expect(almarai.tokens.available).toBe(false)
    expect(almarai.tokens.cost).toBeNull()
    metrics.close()
  })

  it('requires an admin session and ignores a client company id', async () => {
    const { app, store, config } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const anon = await request(app).get('/api/observability/summary').expect(401)
    expect(anon.body.code).toBe('UNAUTHENTICATED')

    const member = await login(app, 'hind@almarai.com')
    expect(member.status).toBe(200)
    const denied = await request(app).get('/api/observability/summary').set('Cookie', member.cookie).expect(403)
    expect(denied.body.code).toBe('FORBIDDEN')

    const admin = await login(app, 'nasser@almarai.com')
    const badWindow = await request(app)
      .get('/api/observability/summary?window=forever')
      .set('Cookie', admin.cookie)
      .expect(400)
    expect(badWindow.body.code).toBe('INVALID_WINDOW')

    const metrics = new MetricsStore(config.platformSqlitePath)
    metrics.record(blankMetric({ companyId: 'company_qimam', route: '/api/other-company-probe' }))
    metrics.close()

    const summary = await request(app)
      .get('/api/observability/summary?window=1h&company_id=company_qimam')
      .set('Cookie', admin.cookie)
      .expect(200)
    expect(summary.body.companyId).toBe('company_almarai')
    expect(JSON.stringify(summary.body)).not.toContain('other-company-probe')
    expect(JSON.stringify(summary.body)).not.toContain('company_qimam')
    expect(summary.body.health.server.status).toBe('ok')
    expect(summary.body.health.database.knowledge).toBe('ok')
    expect(summary.body.health.gemini.liveProbe).toBe(false)
    expect(summary.body.requests.total).toBeGreaterThan(0)
  })

  it('records indexing and ask results without the question text', async () => {
    const { app, store, config } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const admin = await login(app, 'nasser@almarai.com')
    const phrase = 'UNIQUE_METRIC_PROBE_77 AIzaSyShouldNotBeStored'
    await request(app)
      .post('/api/knowledge/documents')
      .set('Cookie', admin.cookie)
      .attach('file', Buffer.from('سياسة داخلية للطباعة'), { filename: 'policy.md', contentType: 'text/markdown' })
      .expect(201)
    await request(app)
      .post('/api/knowledge/ask')
      .set('Cookie', admin.cookie)
      .send({ question: phrase, company_id: 'company_qimam' })
      .expect(200)

    const summary = await request(app)
      .get('/api/observability/summary?window=24h')
      .set('Cookie', admin.cookie)
      .expect(200)
    expect(summary.body.indexing.ready).toBeGreaterThanOrEqual(1)
    expect(summary.body.retrieval.ok).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(summary.body)).not.toContain('UNIQUE_METRIC_PROBE_77')
    expect(JSON.stringify(summary.body)).not.toContain('AIza')

    const db = new DatabaseSync(config.platformSqlitePath, { readOnly: true })
    const stored = JSON.stringify(db.prepare('SELECT * FROM request_metrics').all())
    db.close()
    expect(stored).not.toContain('UNIQUE_METRIC_PROBE_77')
    expect(stored).not.toContain('AIza')
    expect(stored).not.toContain('سياسة داخلية')
  })

  it('keeps serving the product when metric recording throws', async () => {
    const { app, store } = harness({
      retentionDays: 14,
      record() {
        throw new Error('metrics disk failed')
      },
      summary() {
        throw new Error('metrics disk failed')
      },
      ping() {
        return false
      },
    })
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const admin = await login(app, 'nasser@almarai.com')
    expect(admin.status).toBe(200)
    const session = await request(app).get('/api/session').set('Cookie', admin.cookie).expect(200)
    expect(session.body.user.companyId).toBe('company_almarai')
    const broken = await request(app).get('/api/observability/summary').set('Cookie', admin.cookie).expect(500)
    expect(broken.body.code).toBe('INTERNAL')
    expect(broken.body.error).not.toContain('metrics disk')
  })
})
