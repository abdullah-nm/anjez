import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { newId } from '../lib/crypto.ts'

export const METRIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
export const GENERATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const GENERATION_TIMEOUT_MS = 120_000

const FAILURE_CODES = new Set([
  'INVALID_OUTPUT',
  'IMAGE_TIMEOUT',
  'TIMEOUT',
  'IMAGE_RATE_LIMITED',
  'COMPOSE_RATE_LIMIT',
  'IMAGE_GENERATION_UNAVAILABLE',
  'NOT_CONFIGURED',
  'QUOTA',
  'UNAVAILABLE',
  'INVALID',
  'AUTH',
  'FAILED',
])

export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout'

export function isDisplayableImage(value: unknown) {
  if (typeof value !== 'string' || value.length < 80 || value.length > 12_000_000) return false
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value)
  if (!match) return false
  const payload = match[2].replace(/\s/g, '')
  if (payload.length < 64) return false
  const buffer = Buffer.from(payload, 'base64')
  if (buffer.length < 32) return false
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  return png || jpeg || webp
}

export function safeFailureCode(value: string | null | undefined) {
  if (!value) return null
  return FAILURE_CODES.has(value) ? value : 'FAILED'
}

export function safeUserLabel(value: string) {
  const cleaned = value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80)
  return cleaned || 'مستخدم'
}
export const METRIC_WINDOWS = ['1h', '24h', '7d', '14d'] as const
export type MetricWindow = (typeof METRIC_WINDOWS)[number]

const WINDOW_MS: Record<MetricWindow, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
}

export type MetricWrite = {
  companyId: string
  method: string
  route: string
  feature: string
  status: number
  durationMs: number
  errorClass: string | null
  geminiClass: string | null
  retrieveOk: boolean | null
  generateOk: boolean | null
  indexOk: boolean | null
  insufficient: boolean | null
  backgroundKind: string | null
  promptTokens: number | null
  outputTokens: number | null
  usageSamples: number
  usageMissing: number
}

type MetricRow = {
  recorded_at: number
  method: string
  route: string
  feature: string
  status: number
  duration_ms: number
  error_class: string | null
  gemini_class: string | null
  retrieve_ok: number | null
  generate_ok: number | null
  index_ok: number | null
  insufficient: number | null
  background_kind: string | null
  prompt_tokens: number | null
  output_tokens: number | null
  usage_samples: number
  usage_missing: number
}

export function percentile95(samples: number[]) {
  if (!samples.length) return null
  const sorted = [...samples].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

function flag(value: boolean | null) {
  if (value === true) return 1
  if (value === false) return 0
  return null
}

function safeToken(value: string, fallback: string, max: number) {
  const cleaned = value.replace(/[^\w./:-]+/g, '').slice(0, max)
  return cleaned || fallback
}

function safeCode(value: string | null) {
  if (!value || !/^[A-Z0-9_]{1,48}$/.test(value)) return null
  return value
}

function safeGemini(value: string | null) {
  if (!value) return null
  const allowed = new Set(['quota', 'auth', 'model_not_found', 'unavailable', 'invalid', 'not_configured', 'unknown'])
  return allowed.has(value) ? value : 'unknown'
}

function safeKind(value: string | null) {
  if (value === 'branded_svg' || value === 'ai_bitmap_background') return value
  return null
}

function safeCount(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return null
  return Math.min(Math.round(value), 1_000_000_000)
}

export function featureForRoute(method: string, route: string) {
  if (route.startsWith('/api/knowledge/ask')) return 'knowledge.ask'
  if (route.includes('/reindex') || (method === 'POST' && route === '/api/knowledge/documents')) return 'knowledge.index'
  if (route.startsWith('/api/designs/preview')) return 'design.preview'
  if (route.startsWith('/api/designs/compose')) return 'design.compose'
  if (route.startsWith('/api/design/generate')) return 'design.image'
  return 'http'
}

function average(values: number[]) {
  if (!values.length) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function bucketSize(window: MetricWindow) {
  if (window === '1h') return 5 * 60 * 1000
  if (window === '24h') return 60 * 60 * 1000
  return 24 * 60 * 60 * 1000
}

function buildGenerationReport(
  rows: GenerationRow[],
  input: { window: MetricWindow, from: number, to: number, status: GenerationStatus | 'all' },
) {
  const succeeded = rows.filter((row) => row.status === 'succeeded')
  const failed = rows.filter((row) => row.status === 'failed')
  const timedOut = rows.filter((row) => row.status === 'timeout')
  const incomplete = rows.filter((row) => row.status === 'queued' || row.status === 'running')
  const apiDurations = rows.map((row) => row.api_duration_ms).filter((value): value is number => value !== null)
  const completionDurations = succeeded.map((row) => row.generation_duration_ms).filter((value): value is number => value !== null)
  const decided = succeeded.length + failed.length + timedOut.length
  const size = bucketSize(input.window)
  const buckets = new Map<number, GenerationRow[]>()
  for (let cursor = input.from; cursor <= input.to; cursor += size) buckets.set(cursor, [])
  for (const row of rows) {
    const index = Math.floor((row.requested_at - input.from) / size) * size + input.from
    const bucket = buckets.get(index)
    if (bucket) bucket.push(row)
  }
  const series = [...buckets.entries()].map(([at, bucket]) => {
    const api = bucket.map((row) => row.api_duration_ms).filter((value): value is number => value !== null)
    return {
      at: new Date(at).toISOString(),
      count: bucket.length,
      succeeded: bucket.filter((row) => row.status === 'succeeded').length,
      failed: bucket.filter((row) => row.status === 'failed' || row.status === 'timeout').length,
      incomplete: bucket.filter((row) => row.status === 'queued' || row.status === 'running').length,
      avgApiMs: average(api),
    }
  })
  const reasons = new Map<string, number>()
  for (const row of rows) {
    if ((row.status === 'failed' || row.status === 'timeout') && row.failure_code) {
      reasons.set(row.failure_code, (reasons.get(row.failure_code) || 0) + 1)
    }
  }
  const recentRows = (input.status === 'all' ? rows : rows.filter((row) => row.status === input.status))
    .slice()
    .sort((left, right) => right.requested_at - left.requested_at)
    .slice(0, 20)
  return {
    window: input.window,
    from: new Date(input.from).toISOString(),
    to: new Date(input.to).toISOString(),
    generatedAt: new Date(input.to).toISOString(),
    timezone: 'Asia/Riyadh',
    totals: {
      total: rows.length,
      succeeded: succeeded.length,
      incomplete: incomplete.length,
      failed: failed.length,
      timedOut: timedOut.length,
      queued: rows.filter((row) => row.status === 'queued').length,
      running: rows.filter((row) => row.status === 'running').length,
      successRate: decided === 0 ? null : Number((succeeded.length / decided).toFixed(4)),
      avgApiMs: average(apiDurations),
      p95ApiMs: percentile95(apiDurations),
      avgGenerationMs: average(completionDurations),
    },
    series,
    failures: [...reasons.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => right.count - left.count),
    recent: recentRows.map((row) => ({
      id: row.id,
      userName: row.user_name,
      requestedAt: new Date(row.requested_at).toISOString(),
      httpStatus: row.http_status,
      status: row.status,
      apiDurationMs: row.api_duration_ms,
      generationDurationMs: row.generation_duration_ms,
      failureCode: row.failure_code,
      previewUrl: row.status === 'succeeded' && row.preview_mime ? `/api/observability/generations/${row.id}/preview` : null,
    })),
  }
}

function rate(failed: number, total: number) {
  if (total === 0) return null
  return Number((failed / total).toFixed(4))
}

function tally(rows: MetricRow[]) {
  const durations: number[] = []
  const routes = new Map<string, { method: string, route: string, ok: number, failed: number, durations: number[] }>()
  let ok = 0
  let failed = 0
  const indexing = { attempts: 0, ready: 0, failed: 0 }
  const retrieval = { attempts: 0, ok: 0, failed: 0, empty: 0 }
  const generation = { attempts: 0, ok: 0, failed: 0, insufficient: 0 }
  const preview = { attempts: 0, ok: 0, failed: 0 }
  const compose = { attempts: 0, saved: 0, failed: 0, bitmapBackgrounds: 0, templateOnly: 0 }
  const image = { attempts: 0, ok: 0, failed: 0 }
  const gemini = new Map<string, number>()
  let promptTokens = 0
  let outputTokens = 0
  let usageSamples = 0
  let usageMissing = 0
  const errors: MetricRow[] = []

  for (const row of rows) {
    durations.push(row.duration_ms)
    if (row.status < 400) ok += 1
    else {
      failed += 1
      errors.push(row)
    }
    const key = `${row.method} ${row.route}`
    const bucket = routes.get(key) || { method: row.method, route: row.route, ok: 0, failed: 0, durations: [] }
    if (row.status < 400) bucket.ok += 1
    else bucket.failed += 1
    bucket.durations.push(row.duration_ms)
    routes.set(key, bucket)

    if (row.feature === 'knowledge.index') {
      indexing.attempts += 1
      if (row.index_ok === 1) indexing.ready += 1
      else indexing.failed += 1
    }
    if (row.feature === 'knowledge.ask' && row.retrieve_ok !== null) {
      retrieval.attempts += 1
      if (row.retrieve_ok === 1) retrieval.ok += 1
      else retrieval.failed += 1
      if (row.retrieve_ok === 1 && row.insufficient === 1 && row.generate_ok === null) retrieval.empty += 1
    }
    if (row.feature === 'knowledge.ask' && row.generate_ok !== null) {
      generation.attempts += 1
      if (row.generate_ok === 1) generation.ok += 1
      else generation.failed += 1
      if (row.generate_ok === 1 && row.insufficient === 1) generation.insufficient += 1
    }
    if (row.feature === 'design.preview') {
      preview.attempts += 1
      if (row.status < 400) preview.ok += 1
      else preview.failed += 1
    }
    if (row.feature === 'design.compose') {
      compose.attempts += 1
      if (row.status < 400) compose.saved += 1
      else compose.failed += 1
      if (row.background_kind === 'ai_bitmap_background') compose.bitmapBackgrounds += 1
      if (row.background_kind === 'branded_svg') compose.templateOnly += 1
    }
    if (row.feature === 'design.image') {
      image.attempts += 1
      if (row.status < 400) image.ok += 1
      else image.failed += 1
    }
    if (row.gemini_class) gemini.set(row.gemini_class, (gemini.get(row.gemini_class) || 0) + 1)
    if (row.usage_samples > 0) {
      promptTokens += row.prompt_tokens || 0
      outputTokens += row.output_tokens || 0
      usageSamples += row.usage_samples
    }
    usageMissing += row.usage_missing || 0
  }

  const routeRows = [...routes.values()]
    .sort((left, right) => right.ok + right.failed - (left.ok + left.failed))
  const shown = routeRows.slice(0, 12).map((row) => ({
    method: row.method,
    route: row.route,
    ok: row.ok,
    failed: row.failed,
    p95Ms: percentile95(row.durations),
  }))

  return {
    requests: {
      total: rows.length,
      ok,
      failed,
      errorRate: rate(failed, rows.length),
      p95Ms: percentile95(durations),
    },
    routes: shown,
    routesOmitted: Math.max(0, routeRows.length - shown.length),
    indexing,
    retrieval,
    generation,
    preview,
    compose,
    image,
    gemini: [...gemini.entries()].map(([geminiClass, count]) => ({ geminiClass, count })),
    tokens: {
      available: usageSamples > 0,
      promptTokens: usageSamples > 0 ? promptTokens : null,
      outputTokens: usageSamples > 0 ? outputTokens : null,
      samples: usageSamples,
      missingUsage: usageMissing,
      cost: null,
    },
    errors: errors
      .sort((left, right) => right.recorded_at - left.recorded_at)
      .slice(0, 20)
      .map((row) => ({
        at: new Date(row.recorded_at).toISOString(),
        method: row.method,
        route: row.route,
        feature: row.feature,
        status: row.status,
        errorClass: row.error_class,
        geminiClass: row.gemini_class,
        durationMs: row.duration_ms,
      })),
    errorsOmitted: Math.max(0, errors.length - 20),
  }
}

export type MetricsRecorder = Pick<MetricsStore, 'retentionDays' | 'record' | 'summary' | 'ping'>

export type GenerationWindowRow = {
  id: string
  company_id: string
  user_name: string
  user_id: string | null
  requested_at: number
  started_at: number | null
  finished_at: number | null
  status: GenerationStatus
  http_status: number | null
  api_duration_ms: number | null
  generation_duration_ms: number | null
  failure_code: string | null
  preview_mime: string | null
  kind: string
  design_id: string | null
  order_id: string | null
  background_stage: string | null
  provider_attempts: number
  provider_duration_ms: number | null
}

type GenerationRow = {
  id: string
  company_id: string
  user_name: string
  requested_at: number
  started_at: number | null
  finished_at: number | null
  status: GenerationStatus
  http_status: number | null
  api_duration_ms: number | null
  generation_duration_ms: number | null
  failure_code: string | null
  preview_mime: string | null
}

export class MetricsStore {
  readonly retentionDays = 14
  private db: DatabaseSync
  private previewRoot: string
  private lastPurge = 0

  constructor(path: string) {
    const dir = dirname(path)
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true })
    this.previewRoot = join(dir || '.', 'generation-previews')
    mkdirSync(this.previewRoot, { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        method TEXT NOT NULL,
        route TEXT NOT NULL,
        feature TEXT NOT NULL,
        status INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        error_class TEXT,
        gemini_class TEXT,
        retrieve_ok INTEGER,
        generate_ok INTEGER,
        index_ok INTEGER,
        insufficient INTEGER,
        background_kind TEXT,
        prompt_tokens INTEGER,
        output_tokens INTEGER,
        usage_samples INTEGER NOT NULL DEFAULT 0,
        usage_missing INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_request_metrics_company_time
        ON request_metrics(company_id, recorded_at);
      CREATE TABLE IF NOT EXISTS generation_jobs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_id TEXT,
        requested_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        status TEXT NOT NULL,
        http_status INTEGER,
        api_duration_ms INTEGER,
        generation_duration_ms INTEGER,
        failure_code TEXT,
        preview_mime TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_generation_jobs_company_time
        ON generation_jobs(company_id, requested_at);
      CREATE TABLE IF NOT EXISTS provider_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        http_status INTEGER NOT NULL,
        failure_code TEXT,
        model TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_provider_attempts_company_time
        ON provider_attempts(company_id, at);
      CREATE TABLE IF NOT EXISTS metric_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    this.ensureGenerationColumns()
    this.db.prepare(
      `INSERT OR IGNORE INTO metric_meta (key, value) VALUES ('detailed_since', ?)`,
    ).run(String(Date.now()))
  }

  private ensureGenerationColumns() {
    const names = new Set(
      (this.db.prepare(`PRAGMA table_info(generation_jobs)`).all() as { name: string }[]).map((column) => column.name),
    )
    const add = (name: string, ddl: string) => {
      if (!names.has(name)) this.db.exec(`ALTER TABLE generation_jobs ADD COLUMN ${ddl}`)
    }
    add('user_id', `user_id TEXT`)
    add('kind', `kind TEXT NOT NULL DEFAULT 'image'`)
    add('design_id', `design_id TEXT`)
    add('order_id', `order_id TEXT`)
    add('background_stage', `background_stage TEXT`)
    add('provider_attempts', `provider_attempts INTEGER NOT NULL DEFAULT 0`)
    add('provider_duration_ms', `provider_duration_ms INTEGER`)
  }

  openGeneration(input: { companyId: string, userName: string, userId?: string | null, now?: number, kind?: 'image' | 'compose' }) {
    const now = input.now ?? Date.now()
    const id = newId('gen')
    const companyId = input.companyId.trim()
    const kind = input.kind === 'compose' ? 'compose' : 'image'
    const userId = input.userId && /^[A-Za-z0-9_-]{1,80}$/.test(input.userId) ? input.userId : null
    this.db.prepare(
      `INSERT INTO generation_jobs (id, company_id, user_name, user_id, requested_at, status, kind)
       VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
    ).run(id, companyId, safeUserLabel(input.userName), userId, now, kind)
    return id
  }

  markGenerationRunning(id: string, now = Date.now()) {
    this.db.prepare(
      `UPDATE generation_jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'`,
    ).run(now, id)
  }

  finishGeneration(input: {
    id: string
    status: Exclude<GenerationStatus, 'queued' | 'running'>
    httpStatus: number
    apiDurationMs: number
    generationDurationMs: number | null
    failureCode: string | null
    preview?: { mime: string, bytes: Buffer } | null
    designId?: string | null
    backgroundStage?: string | null
    now?: number
  }) {
    const now = input.now ?? Date.now()
    const row = this.db.prepare(`SELECT company_id, status FROM generation_jobs WHERE id = ?`).get(input.id) as
      | { company_id: string, status: GenerationStatus }
      | undefined
    if (!row || (row.status !== 'queued' && row.status !== 'running')) return
    let mime: string | null = null
    if (input.status === 'succeeded' && input.preview && input.preview.bytes.length > 0) {
      const dir = join(this.previewRoot, row.company_id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, input.id), input.preview.bytes)
      mime = input.preview.mime
    }
    this.db.prepare(
      `UPDATE generation_jobs
       SET status = ?, finished_at = ?, http_status = ?, api_duration_ms = ?, generation_duration_ms = ?, failure_code = ?, preview_mime = ?,
           design_id = ?, background_stage = ?
       WHERE id = ? AND status IN ('queued', 'running')`,
    ).run(
      input.status,
      now,
      Math.max(0, Math.min(599, Math.round(input.httpStatus) || 0)),
      Math.max(0, Math.min(600_000, Math.round(input.apiDurationMs) || 0)),
      input.generationDurationMs === null ? null : Math.max(0, Math.min(600_000, Math.round(input.generationDurationMs) || 0)),
      input.status === 'succeeded' ? null : safeFailureCode(input.failureCode),
      mime,
      input.designId && /^des_[a-f0-9]+$/.test(input.designId) ? input.designId : null,
      input.backgroundStage && /^[a-z_]{1,40}$/.test(input.backgroundStage) ? input.backgroundStage : null,
      input.id,
    )
  }

  recordProviderAttempt(input: {
    jobId: string
    companyId: string
    model: string
    httpStatus: number
    durationMs: number
    failureCode: string | null
    now?: number
  }) {
    const now = input.now ?? Date.now()
    const model = input.model.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80) || 'unknown'
    const code = input.failureCode ? safeFailureCode(input.failureCode) : null
    this.db.prepare(
      `INSERT INTO provider_attempts (job_id, company_id, at, duration_ms, http_status, failure_code, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.jobId,
      input.companyId.trim(),
      now,
      Math.max(0, Math.min(600_000, Math.round(input.durationMs) || 0)),
      Math.max(0, Math.min(599, Math.round(input.httpStatus) || 0)),
      code,
      model,
    )
    this.db.prepare(
      `UPDATE generation_jobs
       SET provider_attempts = provider_attempts + 1,
           provider_duration_ms = COALESCE(provider_duration_ms, 0) + ?
       WHERE id = ? AND company_id = ?`,
    ).run(Math.max(0, Math.min(600_000, Math.round(input.durationMs) || 0)), input.jobId, input.companyId.trim())
  }

  generationCounts(companyIds: string[], from: number, to: number) {
    const ids = [...new Set(companyIds.map((id) => id.trim()).filter(Boolean))]
    const counts = new Map<string, { total: number, succeeded: number }>()
    if (!ids.length) return counts
    const marks = ids.map(() => '?').join(',')
    const rows = this.db.prepare(
      `SELECT company_id, COUNT(*) AS total,
              SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded
       FROM generation_jobs
       WHERE company_id IN (${marks}) AND requested_at >= ? AND requested_at <= ?
       GROUP BY company_id`,
    ).all(...ids, from, to) as { company_id: string, total: number, succeeded: number }[]
    for (const row of rows) counts.set(row.company_id, { total: Number(row.total) || 0, succeeded: Number(row.succeeded) || 0 })
    return counts
  }

  detailedSince() {
    const row = this.db.prepare(`SELECT value FROM metric_meta WHERE key = 'detailed_since'`).get() as { value: string } | undefined
    const parsed = Number(row?.value)
    return Number.isFinite(parsed) ? parsed : Date.now()
  }

  generationCountsAll() {
    const counts = new Map<string, { total: number, succeeded: number }>()
    const rows = this.db.prepare(
      `SELECT company_id, COUNT(*) AS total,
              SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded
       FROM generation_jobs
       GROUP BY company_id`,
    ).all() as { company_id: string, total: number, succeeded: number }[]
    for (const row of rows) counts.set(row.company_id, { total: Number(row.total) || 0, succeeded: Number(row.succeeded) || 0 })
    return counts
  }

  generationWindow(companyId: string, from: number, to: number, activeIds: string[] = [], now = Date.now()) {
    return this.readGenerationWindow(companyId.trim(), from, to, activeIds, now)
  }

  generationWindowAll(from: number, to: number, activeIds: string[] = [], now = Date.now()) {
    return this.readGenerationWindow(null, from, to, activeIds, now)
  }

  private readGenerationWindow(companyId: string | null, from: number, to: number, activeIds: string[], now: number) {
    this.sweepGenerations(now, activeIds)
    this.purge(now)
    const companySql = companyId ? 'company_id = ? AND ' : ''
    const companyArgs = companyId ? [companyId] : []
    const jobs = this.db.prepare(
      `SELECT id, company_id, user_name, user_id, requested_at, started_at, finished_at, status, http_status,
              api_duration_ms, generation_duration_ms, failure_code, preview_mime, kind, design_id, order_id,
              background_stage, provider_attempts, provider_duration_ms
       FROM generation_jobs
       WHERE ${companySql}requested_at >= ? AND requested_at <= ?
       ORDER BY requested_at ASC`,
    ).all(...companyArgs, from, to) as GenerationWindowRow[]
    const attempts = this.db.prepare(
      `SELECT job_id, company_id, at, duration_ms, http_status, failure_code, model
       FROM provider_attempts
       WHERE ${companySql}at >= ? AND at <= ?`,
    ).all(...companyArgs, from, to) as {
      job_id: string
      company_id: string
      at: number
      duration_ms: number
      http_status: number
      failure_code: string | null
      model: string
    }[]
    const live = this.db.prepare(
      `SELECT id, status, requested_at, user_name, kind FROM generation_jobs
       WHERE ${companyId ? 'company_id = ? AND ' : ''}status IN ('queued', 'running')`,
    ).all(...companyArgs) as { id: string, status: GenerationStatus, requested_at: number, user_name: string, kind: string }[]
    return { jobs, attempts, live }
  }

  sweepGenerations(now: number, activeIds: string[]) {
    const staleBefore = now - GENERATION_TIMEOUT_MS
    const rows = this.db.prepare(
      `SELECT id, requested_at, started_at FROM generation_jobs WHERE status IN ('queued', 'running') AND requested_at < ?`,
    ).all(staleBefore) as { id: string, requested_at: number, started_at: number | null }[]
    const active = new Set(activeIds)
    for (const row of rows) {
      if (active.has(row.id)) continue
      const elapsed = now - (row.started_at ?? row.requested_at)
      this.db.prepare(
        `UPDATE generation_jobs
         SET status = 'timeout', finished_at = ?, failure_code = 'TIMEOUT', generation_duration_ms = ?
         WHERE id = ? AND status IN ('queued', 'running')`,
      ).run(now, Math.max(0, elapsed), row.id)
    }
  }

  generationReport(input: {
    companyId: string
    window: MetricWindow
    status?: GenerationStatus | 'all'
    activeIds?: string[]
    now?: number
  }) {
    const now = input.now ?? Date.now()
    this.sweepGenerations(now, input.activeIds ?? [])
    this.purge(now)
    const companyId = input.companyId.trim()
    const from = now - WINDOW_MS[input.window]
    const rows = this.db.prepare(
      `SELECT id, company_id, user_name, requested_at, started_at, finished_at, status, http_status,
              api_duration_ms, generation_duration_ms, failure_code, preview_mime
       FROM generation_jobs
       WHERE company_id = ? AND requested_at >= ? AND requested_at <= ?
       ORDER BY requested_at ASC`,
    ).all(companyId, from, now) as GenerationRow[]
    return buildGenerationReport(rows, { window: input.window, from, to: now, status: input.status ?? 'all' })
  }

  readGenerationPreview(companyId: string, id: string) {
    return this.readPreview(id, companyId.trim())
  }

  readGenerationPreviewForAdmin(id: string) {
    return this.readPreview(id, null)
  }

  private readPreview(id: string, companyId: string | null) {
    if (!/^gen_[a-f0-9]+$/.test(id)) return null
    const row = (companyId
      ? this.db.prepare(`SELECT company_id, preview_mime, status FROM generation_jobs WHERE id = ? AND company_id = ?`).get(id, companyId)
      : this.db.prepare(`SELECT company_id, preview_mime, status FROM generation_jobs WHERE id = ?`).get(id)
    ) as { company_id: string, preview_mime: string | null, status: GenerationStatus } | undefined
    if (!row || row.status !== 'succeeded' || !row.preview_mime) return null
    try {
      const bytes = readFileSync(join(this.previewRoot, row.company_id, id))
      return { mime: row.preview_mime, bytes }
    } catch {
      return null
    }
  }

  record(input: MetricWrite) {
    try {
      const companyId = input.companyId.trim()
      if (!companyId) return
      const now = Date.now()
      this.purge(now)
      const method = safeToken(input.method.toUpperCase(), 'GET', 8)
      const route = input.route.replace(/[?#].*$/, '').replace(/[\u0000-\u001f]/g, '').slice(0, 120) || '/'
      const feature = /^[a-z0-9._]{1,40}$/.test(input.feature) ? input.feature : 'http'
      this.db.prepare(
        `INSERT INTO request_metrics (
          company_id, recorded_at, method, route, feature, status, duration_ms, error_class, gemini_class,
          retrieve_ok, generate_ok, index_ok, insufficient, background_kind, prompt_tokens, output_tokens,
          usage_samples, usage_missing
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        companyId,
        now,
        method,
        route,
        feature,
        Math.max(0, Math.min(599, Math.round(input.status) || 0)),
        Math.max(0, Math.min(600_000, Math.round(input.durationMs) || 0)),
        safeCode(input.errorClass),
        safeGemini(input.geminiClass),
        flag(input.retrieveOk),
        flag(input.generateOk),
        flag(input.indexOk),
        flag(input.insufficient),
        safeKind(input.backgroundKind),
        input.usageSamples > 0 ? safeCount(input.promptTokens) : null,
        input.usageSamples > 0 ? safeCount(input.outputTokens) : null,
        Math.max(0, Math.round(input.usageSamples) || 0),
        Math.max(0, Math.round(input.usageMissing) || 0),
      )
    } catch (error) {
      console.error(`metric record skipped: ${error instanceof Error ? error.name : 'error'}`)
    }
  }

  summary(input: { companyId: string, window: MetricWindow, now?: number }) {
    const companyId = input.companyId.trim()
    const now = input.now ?? Date.now()
    const windowMs = WINDOW_MS[input.window]
    const current = this.rows(companyId, now - windowMs, now, true)
    const previous = this.rows(companyId, now - windowMs * 2, now - windowMs, false)
    const currentTally = tally(current)
    const previousTally = tally(previous)
    return {
      window: input.window,
      windowMs,
      from: new Date(now - windowMs).toISOString(),
      to: new Date(now).toISOString(),
      generatedAt: new Date(now).toISOString(),
      retentionDays: this.retentionDays,
      companyId,
      sources: {
        requests: 'جدول request_metrics في قاعدة المنصة، طلبات جلسة هذه الشركة فقط.',
        latency: 'المدة من دخول الطلب حتى إرسال الرد. p95 بأسلوب nearest-rank.',
        gemini: 'تصنيف من رمز حالة HTTP الذي أعاده Gemini، دون نص الخطأ.',
        tokens: 'usageMetadata إن وُجد في رد Gemini. التكلفة غير معادة من المزود.',
        health: 'استعلام SELECT 1 وإعداد الخادم. لا يوجد فحص حي يستهلك حصة Gemini.',
      },
      requests: currentTally.requests,
      routes: currentTally.routes,
      routesOmitted: currentTally.routesOmitted,
      previous: {
        from: new Date(now - windowMs * 2).toISOString(),
        to: new Date(now - windowMs).toISOString(),
        ...previousTally.requests,
      },
      indexing: currentTally.indexing,
      retrieval: currentTally.retrieval,
      generation: currentTally.generation,
      preview: currentTally.preview,
      compose: currentTally.compose,
      image: currentTally.image,
      gemini: currentTally.gemini,
      tokens: {
        ...currentTally.tokens,
        costNote: 'Gemini لا يعيد تكلفة مالية في الرد، لذلك التكلفة غير متاحة.',
      },
      errors: currentTally.errors,
      errorsOmitted: currentTally.errorsOmitted,
    }
  }

  ping() {
    try {
      const row = this.db.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined
      return row?.ok === 1
    } catch {
      return false
    }
  }

  close() {
    this.db.close()
  }

  private rows(companyId: string, from: number, to: number, inclusiveEnd: boolean) {
    const end = inclusiveEnd ? '<=' : '<'
    return this.db.prepare(
      `SELECT recorded_at, method, route, feature, status, duration_ms, error_class, gemini_class,
              retrieve_ok, generate_ok, index_ok, insufficient, background_kind,
              prompt_tokens, output_tokens, usage_samples, usage_missing
       FROM request_metrics
       WHERE company_id = ? AND recorded_at >= ? AND recorded_at ${end} ?
       ORDER BY recorded_at ASC`,
    ).all(companyId, from, to) as MetricRow[]
  }

  private purge(now: number) {
    if (now - this.lastPurge < 60_000) return
    this.lastPurge = now
    this.db.prepare('DELETE FROM request_metrics WHERE recorded_at < ?').run(now - METRIC_RETENTION_MS)
    this.db.prepare('DELETE FROM provider_attempts WHERE at < ?').run(now - GENERATION_RETENTION_MS)
    const stale = this.db.prepare(
      `SELECT id, company_id FROM generation_jobs WHERE requested_at < ?`,
    ).all(now - GENERATION_RETENTION_MS) as { id: string, company_id: string }[]
    for (const row of stale) {
      rmSync(join(this.previewRoot, row.company_id, row.id), { force: true })
    }
    if (stale.length) {
      this.db.prepare('DELETE FROM generation_jobs WHERE requested_at < ?').run(now - GENERATION_RETENTION_MS)
    }
  }
}
