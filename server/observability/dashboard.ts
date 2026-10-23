import type { GenerationStatus, GenerationWindowRow } from './metrics.ts'
import { occasionByKey } from '../platform/occasions.ts'

export const ORDER_STATUSES = ['محفوظ', 'قيد التجهيز', 'مستلم'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export type DashboardPreset = 'today' | '7d' | '30d' | 'custom'

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export function changeRatio(current: number, previous: number) {
  if (previous <= 0) return null
  return Number(((current - previous) / previous).toFixed(4))
}

export function riyadhDayStart(now: number) {
  const shifted = new Date(now + RIYADH_OFFSET_MS)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - RIYADH_OFFSET_MS
}

export function parseDashboardRange(input: {
  preset: DashboardPreset
  from?: string
  to?: string
  now?: number
}) {
  const now = input.now ?? Date.now()
  if (input.preset === 'today') {
    const from = riyadhDayStart(now)
    return { from, to: now, previousFrom: from - (now - from), previousTo: from }
  }
  if (input.preset === '7d' || input.preset === '30d') {
    const span = (input.preset === '7d' ? 7 : 30) * DAY_MS
    return { from: now - span, to: now, previousFrom: now - span * 2, previousTo: now - span }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(input.to || '')) {
    throw new Error('INVALID_RANGE')
  }
  const from = Date.parse(`${input.from}T00:00:00+03:00`)
  const to = Date.parse(`${input.to}T23:59:59.999+03:00`)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 31 * DAY_MS) {
    throw new Error('INVALID_RANGE')
  }
  const span = to - from
  return { from, to: Math.min(to, now), previousFrom: from - span, previousTo: from }
}

export function isDisplayableSvg(value: string) {
  const lowered = value.toLowerCase()
  return value.length > 40 && value.length < 2_000_000 && lowered.includes('<svg') && !lowered.includes('<script')
}

export type AttemptRow = {
  job_id: string
  at: number
  duration_ms: number
  http_status: number
  failure_code: string | null
  model: string
}

export type PrintOrderRow = {
  id: string
  companyId?: string
  companyName?: string
  userId?: string
  userName: string
  productId: string
  status: string
  quantity: number
  deliveryDate: string
  designId: string | null
  createdAt: string
  occasionKey?: string | null
}

function average(values: number[]) {
  if (!values.length) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function percentile95(samples: number[]) {
  if (!samples.length) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]
}

function bucketSize(from: number, to: number) {
  return to - from > 2 * DAY_MS ? DAY_MS : 60 * 60 * 1000
}

const OPEN_ORDER_STATUSES = ['محفوظ', 'قيد التجهيز'] as const
const COMPLETE_ORDER_STATUS = 'مستلم'

export function isRasterPreview(mime: string | null) {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/webp'
}

export function isCancelledOrder(status: string) {
  return status === 'ملغى' || status === 'ملغاة' || status === 'cancelled'
}

function riyadhDate(ms: number) {
  const shifted = new Date(ms + RIYADH_OFFSET_MS)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${month}-${day}`
}

type BoardJob = {
  company_id: string
  status: GenerationStatus
  preview_mime: string | null
  design_id: string | null
  requested_at: number
  generation_duration_ms: number | null
}

export function activityBoard(input: {
  from: number
  to: number
  previousFrom: number
  previousTo: number
  companiesTotal: number
  registrations: number[]
  jobs: BoardJob[]
  previousJobs: BoardJob[]
  orders: PrintOrderRow[]
  previousOrders: PrintOrderRow[]
  occasionByDesign?: Map<string, string | null>
}) {
  const inWindow = (at: number) => at >= input.previousFrom && at < input.previousTo
  const inCurrent = (at: number) => at >= input.from && at <= input.to
  const companiesNew = input.registrations.filter((at) => Number.isFinite(at) && inCurrent(at)).length
  const previousCompaniesNew = input.registrations.filter((at) => Number.isFinite(at) && inWindow(at)).length
  const images = input.jobs.filter((job) => job.status === 'succeeded' && isRasterPreview(job.preview_mime)).length
  const previousImages = input.previousJobs.filter((job) => job.status === 'succeeded' && isRasterPreview(job.preview_mime)).length
  const succeededJobs = input.jobs.filter((job) => job.status === 'succeeded')
  const companiesThatGenerated = new Set(input.jobs.map((job) => job.company_id).filter(Boolean))
  const completed = input.orders.filter((order) => order.status === COMPLETE_ORDER_STATUS)
  const previousCompleted = input.previousOrders.filter((order) => order.status === COMPLETE_ORDER_STATUS)
  const incomplete = input.orders.filter((order) => (OPEN_ORDER_STATUSES as readonly string[]).includes(order.status))
  const previousIncomplete = input.previousOrders.filter((order) => (OPEN_ORDER_STATUSES as readonly string[]).includes(order.status))
  const statusCounts = new Map<string, number>()
  for (const order of input.orders) statusCounts.set(order.status, (statusCounts.get(order.status) || 0) + 1)
  const statuses = [...statusCounts.entries()].map(([status, count]) => ({
    status,
    count,
    ratio: input.orders.length ? Number((count / input.orders.length).toFixed(4)) : 0,
  })).sort((left, right) => right.count - left.count)
  const days = new Map<string, Map<string, number>>()
  for (const order of input.orders) {
    const at = Date.parse(order.createdAt)
    if (!Number.isFinite(at) || !inCurrent(at)) continue
    const day = riyadhDate(at)
    const bucket = days.get(day) ?? new Map<string, number>()
    bucket.set(order.status, (bucket.get(order.status) || 0) + 1)
    days.set(day, bucket)
  }
  const orderDays = [...days.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([day, bucket]) => ({
    day,
    statuses: [...bucket.entries()].map(([status, count]) => ({ status, count })),
  }))
  const products = new Map<string, { orders: number, quantity: number }>()
  for (const order of input.orders) {
    const current = products.get(order.productId) ?? { orders: 0, quantity: 0 }
    current.orders += 1
    current.quantity += Number.isFinite(order.quantity) ? order.quantity : 0
    products.set(order.productId, current)
  }
  const productRows = [...products.entries()].map(([productId, value]) => ({
    productId,
    orders: value.orders,
    quantity: value.quantity,
    averageQuantity: value.orders ? Number((value.quantity / value.orders).toFixed(2)) : null,
  })).sort((left, right) => right.orders - left.orders || right.quantity - left.quantity)
  const occasionFor = (designId: string | null | undefined, explicit?: string | null) => {
    if (explicit !== undefined) return explicit
    if (!designId) return null
    return input.occasionByDesign?.get(designId) ?? null
  }
  const occasions = new Map<string, { key: string | null, generations: number, orders: number }>()
  const bump = (key: string | null, field: 'generations' | 'orders') => {
    const id = key || ''
    const current = occasions.get(id) ?? { key, generations: 0, orders: 0 }
    current[field] += 1
    occasions.set(id, current)
  }
  for (const job of succeededJobs) bump(occasionFor(job.design_id, undefined), 'generations')
  for (const order of input.orders) bump(order.occasionKey === undefined ? occasionFor(order.designId, undefined) : order.occasionKey, 'orders')
  const durations = succeededJobs.map((job) => job.generation_duration_ms).filter((value): value is number => value !== null)
  return {
    companiesTotal: input.companiesTotal,
    companiesNew,
    companiesNewChange: changeRatio(companiesNew, previousCompaniesNew),
    images,
    imagesChange: changeRatio(images, previousImages),
    orders: input.orders.length,
    completed: completed.length,
    completedChange: changeRatio(completed.length, previousCompleted.length),
    incomplete: incomplete.length,
    incompleteChange: changeRatio(incomplete.length, previousIncomplete.length),
    incompleteStatuses: [...OPEN_ORDER_STATUSES],
    statuses,
    orderDays,
    products: productRows,
    occasions: [...occasions.values()].map((item) => ({
      ...item,
      label: item.key ? (occasionByKey(item.key)?.titleAr ?? item.key) : 'غير محدد',
    })).sort((left, right) => (right.generations + right.orders) - (left.generations + left.orders)),
    generationsSucceeded: succeededJobs.length,
    generationsPerCompany: companiesThatGenerated.size ? Number((succeededJobs.length / companiesThatGenerated.size).toFixed(2)) : null,
    avgGenerationMs: average(durations),
  }
}

function seriesFor(from: number, to: number, jobs: GenerationWindowRow[], attempts: AttemptRow[], orders: PrintOrderRow[] = [], registrations: number[] = []) {
  const size = bucketSize(from, to)
  const buckets: { at: number, count: number, orders: number, registrations: number, succeeded: number, failed: number, incomplete: number, providerMs: number[], generationMs: number[] }[] = []
  for (let cursor = from; cursor <= to; cursor += size) {
    buckets.push({ at: cursor, count: 0, orders: 0, registrations: 0, succeeded: 0, failed: 0, incomplete: 0, providerMs: [], generationMs: [] })
  }
  if (!buckets.length) return []
  const indexFor = (at: number) => Math.min(buckets.length - 1, Math.max(0, Math.floor((at - from) / size)))
  for (const job of jobs) {
    const bucket = buckets[indexFor(job.requested_at)]
    if (!bucket) continue
    bucket.count += 1
    if (job.status === 'succeeded') {
      bucket.succeeded += 1
      if (job.generation_duration_ms !== null) bucket.generationMs.push(job.generation_duration_ms)
    } else if (job.status === 'failed' || job.status === 'timeout') bucket.failed += 1
    else bucket.incomplete += 1
  }
  for (const attempt of attempts) {
    const bucket = buckets[indexFor(attempt.at)]
    if (bucket) bucket.providerMs.push(attempt.duration_ms)
  }
  for (const order of orders) {
    const at = Date.parse(order.createdAt)
    if (!Number.isFinite(at) || at < from || at > to) continue
    const bucket = buckets[indexFor(at)]
    if (bucket) bucket.orders += 1
  }
  for (const at of registrations) {
    if (!Number.isFinite(at) || at < from || at > to) continue
    const bucket = buckets[indexFor(at)]
    if (bucket) bucket.registrations += 1
  }
  return buckets.map((bucket) => ({
    at: new Date(bucket.at).toISOString(),
    count: bucket.count,
    orders: bucket.orders,
    registrations: bucket.registrations,
    succeeded: bucket.succeeded,
    failed: bucket.failed,
    incomplete: bucket.incomplete,
    avgProviderMs: average(bucket.providerMs),
    avgGenerationMs: average(bucket.generationMs),
  }))
}

function clientFunnel(jobs: GenerationWindowRow[], orders: PrintOrderRow[]) {
  const excludedJobs = jobs.filter((job) => !job.user_id).length
  const started = new Set(jobs.flatMap((job) => job.user_id ? [job.user_id] : []))
  const succeeded = new Set(jobs.flatMap((job) => job.user_id && job.status === 'succeeded' ? [job.user_id] : []))
  const ready = [...succeeded].filter((id) => started.has(id))
  const ordered = ready.filter((id) => orders.some((order) => order.userId === id))
  return {
    started: started.size,
    succeeded: ready.length,
    ordered: ordered.length,
    excludedJobs,
    ordersOutside: orders.filter((order) => !order.userId || !ready.includes(order.userId)).length,
    sequential: true,
  }
}

function tally(jobs: GenerationWindowRow[]) {
  const succeeded = jobs.filter((job) => job.status === 'succeeded')
  const failed = jobs.filter((job) => job.status === 'failed')
  const timedOut = jobs.filter((job) => job.status === 'timeout')
  const incomplete = jobs.filter((job) => job.status === 'queued' || job.status === 'running')
  const decided = succeeded.length + failed.length + timedOut.length
  const durations = succeeded.map((job) => job.generation_duration_ms).filter((value): value is number => value !== null)
  return {
    total: jobs.length,
    succeeded: succeeded.length,
    failed: failed.length,
    timedOut: timedOut.length,
    incomplete: incomplete.length,
    queued: jobs.filter((job) => job.status === 'queued').length,
    running: jobs.filter((job) => job.status === 'running').length,
    decided,
    successRate: decided === 0 ? null : Number((succeeded.length / decided).toFixed(4)),
    avgGenerationMs: average(durations),
  }
}

export function orderNeedsFollowUp(order: PrintOrderRow, input: { now: number, followupHours: number, failedDesignIds: Set<string> }) {
  const created = Date.parse(order.createdAt)
  const ageMs = Number.isFinite(created) ? input.now - created : 0
  if (order.designId && input.failedDesignIds.has(order.designId)) {
    return 'التوليد المرتبط بهذا الطلب فشل أو انتهت مهلته'
  }
  const today = new Date(input.now + RIYADH_OFFSET_MS).toISOString().slice(0, 10)
  if (order.deliveryDate < today) return 'تجاوز تاريخ التسليم المطلوب'
  if (order.status === 'محفوظ' && !order.designId && ageMs >= input.followupHours * 60 * 60 * 1000) {
    return `ما زال محفوظًا دون تصميم مرتبط منذ أكثر من ${input.followupHours} ساعة`
  }
  return null
}

export function buildDashboard(input: {
  preset: DashboardPreset
  from: number
  to: number
  previousFrom: number
  previousTo: number
  now: number
  detailedSince: number
  followupHours: number
  jobs: GenerationWindowRow[]
  previousJobs: GenerationWindowRow[]
  attempts: AttemptRow[]
  live: { id: string, status: GenerationStatus, requested_at: number, user_name: string, kind: string }[]
  orders: PrintOrderRow[]
  previousOrderCount: number
  activeUsers: number
  previousActiveUsers: number
  status: GenerationStatus | 'all'
  registrations?: number[]
  companyNames?: Map<string, string>
  previousOrders?: PrintOrderRow[]
  occasionByDesign?: Map<string, string | null>
  companiesTotal?: number
}) {
  const current = tally(input.jobs)
  const previous = tally(input.previousJobs)
  const providerDurations = input.attempts.map((attempt) => attempt.duration_ms)
  const providerFailures = input.attempts.filter((attempt) => attempt.failure_code)
  const avgProvider = average(providerDurations)
  const separateProviderAverage = avgProvider !== null && current.avgGenerationMs !== null
    && Math.abs(avgProvider - current.avgGenerationMs) / Math.max(current.avgGenerationMs, 1) > 0.15
  const stages = {
    compose: input.jobs.filter((job) => job.kind === 'compose').length,
    image: input.jobs.filter((job) => job.kind !== 'compose').length,
    backgroundReady: input.jobs.filter((job) => job.background_stage === 'background_ready').length,
    backgroundFallback: input.jobs.filter((job) => job.background_stage === 'background_fallback').length,
    backgroundSkipped: input.jobs.filter((job) => job.background_stage === 'background_skipped' || job.background_stage === 'background_skipped_unconfigured').length,
    saved: input.jobs.filter((job) => job.status === 'succeeded').length,
  }
  const attemptReasons = new Map<string, number>()
  for (const attempt of providerFailures) {
    if (!attempt.failure_code) continue
    attemptReasons.set(attempt.failure_code, (attemptReasons.get(attempt.failure_code) || 0) + 1)
  }
  const failedDesignIds = new Set(input.jobs.filter((job) => job.design_id && (job.status === 'failed' || job.status === 'timeout')).map((job) => job.design_id as string))
  const followed = input.orders.flatMap((order) => {
    const reason = orderNeedsFollowUp(order, { now: input.now, followupHours: input.followupHours, failedDesignIds })
    if (!reason) return []
    const created = Date.parse(order.createdAt)
    const ageHours = Number.isFinite(created) ? Math.max(0, Math.round((input.now - created) / 3_600_000)) : 0
    return [{ ...order, reason, ageHours }]
  })
  const presentStatuses = [...new Set(input.orders.map((order) => order.status))]
  const statusCounts = presentStatuses.map((status) => ({
    status,
    count: input.orders.filter((order) => order.status === status).length,
  }))
  const recentJobs = (input.status === 'all' ? input.jobs : input.jobs.filter((job) => job.status === input.status))
    .slice()
    .sort((left, right) => right.requested_at - left.requested_at)
  const failedJobsByCode = new Map<string, number>()
  for (const job of input.jobs) {
    if ((job.status === 'failed' || job.status === 'timeout') && job.failure_code) {
      failedJobsByCode.set(job.failure_code, (failedJobsByCode.get(job.failure_code) || 0) + 1)
    }
  }
  const alerts = [
    ...(current.timedOut ? [{ id: 'timeout', tone: 'danger' as const, kind: 'timeout' as const, count: current.timedOut, code: 'TIMEOUT', href: '#operations' }] : []),
    ...[...failedJobsByCode.entries()].flatMap(([code, count]) => (
      count >= 2 && code !== 'TIMEOUT'
        ? [{ id: `repeated-${code}`, tone: 'danger' as const, kind: 'repeated' as const, count, code, href: '#operations' }]
        : []
    )),
    ...(followed.length ? [{ id: 'orders', tone: 'info' as const, kind: 'orders' as const, count: followed.length, code: null, href: '#orders' }] : []),
  ]
  return {
    preset: input.preset,
    from: new Date(input.from).toISOString(),
    to: new Date(input.to).toISOString(),
    previousFrom: new Date(input.previousFrom).toISOString(),
    previousTo: new Date(input.previousTo).toISOString(),
    generatedAt: new Date(input.now).toISOString(),
    timezone: 'Asia/Riyadh',
    detailedSince: new Date(input.detailedSince).toISOString(),
    retentionDays: 30,
    followupHours: input.followupHours,
    synchronous: true,
    summary: {
      orders: input.orders.length,
      ordersChange: changeRatio(input.orders.length, input.previousOrderCount),
      succeeded: current.succeeded,
      succeededChange: changeRatio(current.succeeded, previous.succeeded),
      live: input.live.length,
      failed: current.failed,
      failedChange: changeRatio(current.failed, previous.failed),
      successRate: current.successRate,
      successRateChange: current.successRate === null || previous.successRate === null || previous.decided === 0
        ? null
        : changeRatio(current.successRate, previous.successRate),
      decided: current.decided,
      activeUsers: input.activeUsers,
      activeUsersChange: changeRatio(input.activeUsers, input.previousActiveUsers),
    },
    journey: {
      ...current,
      stages,
      failures: [...failedJobsByCode.entries()].map(([code, count]) => ({ code, count })).sort((left, right) => right.count - left.count),
      funnel: clientFunnel(input.jobs, input.orders),
      series: seriesFor(input.from, input.to, input.jobs, input.attempts, input.orders, input.registrations ?? []),
    },
    orders: {
      total: input.orders.length,
      statuses: statusCounts,
      followup: followed,
      recent: [...input.orders].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    },
    api: {
      calls: input.attempts.length,
      failedCalls: providerFailures.length,
      errorRate: input.attempts.length === 0 ? null : Number((providerFailures.length / input.attempts.length).toFixed(4)),
      avgMs: separateProviderAverage ? avgProvider : null,
      avgHiddenBecauseSameWait: avgProvider !== null && !separateProviderAverage,
      p95Ms: percentile95(providerDurations),
      failures: [...attemptReasons.entries()].map(([code, count]) => ({ code, count })).sort((left, right) => right.count - left.count),
      series: seriesFor(input.from, input.to, input.jobs, input.attempts),
    },
    live: input.live,
    alerts,
    recent: recentJobs.map((job) => ({
      id: job.id,
      companyId: job.company_id,
      companyName: input.companyNames?.get(job.company_id) ?? '',
      userName: job.user_name,
      kind: job.kind === 'compose' ? 'compose' : 'image',
      orderId: job.order_id,
      designId: job.design_id,
      requestedAt: new Date(job.requested_at).toISOString(),
      startedAt: job.started_at ? new Date(job.started_at).toISOString() : null,
      finishedAt: job.finished_at ? new Date(job.finished_at).toISOString() : null,
      httpStatus: job.http_status,
      status: job.status,
      providerDurationMs: job.provider_duration_ms,
      generationDurationMs: job.generation_duration_ms,
      providerAttempts: job.provider_attempts,
      failureCode: job.failure_code,
      backgroundStage: job.background_stage,
      occasionKey: job.design_id ? input.occasionByDesign?.get(job.design_id) ?? null : null,
      previewUrl: job.status === 'succeeded' && job.preview_mime ? `/api/observability/generations/${job.id}/preview` : null,
    })),
    board: activityBoard({
      from: input.from,
      to: input.to,
      previousFrom: input.previousFrom,
      previousTo: input.previousTo,
      companiesTotal: input.companiesTotal ?? input.registrations?.length ?? 0,
      registrations: input.registrations ?? [],
      jobs: input.jobs,
      previousJobs: input.previousJobs,
      orders: input.orders,
      previousOrders: input.previousOrders ?? [],
      occasionByDesign: input.occasionByDesign,
    }),
  }
}
