import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const METRIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
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

export class MetricsStore {
  readonly retentionDays = 14
  private db: DatabaseSync
  private lastPurge = 0

  constructor(path: string) {
    const dir = dirname(path)
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true })
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
    `)
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
  }
}
