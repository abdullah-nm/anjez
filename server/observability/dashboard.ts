import { groupCity } from '../../shared/cities.ts'
import { isCompletedOrderStatus } from '../../shared/orderFlow.ts'
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

export function riyadhDate(ms: number) {
  const shifted = new Date(ms + RIYADH_OFFSET_MS)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${month}-${day}`
}

export function riyadhDays(from: number, to: number) {
  const first = riyadhDayStart(from)
  const last = riyadhDayStart(to)
  const days: { start: number, end: number, day: string, partial: boolean }[] = []
  for (let cursor = first; cursor <= last; cursor += DAY_MS) {
    const dayEnd = cursor + DAY_MS
    const start = Math.max(cursor, from)
    const end = Math.min(dayEnd - 1, to)
    if (start > end) continue
    days.push({ start, end, day: riyadhDate(cursor + 60_000), partial: to < dayEnd - 1 })
  }
  return days
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
  company_id?: string
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
  deliveryCity?: string | null
  designId: string | null
  createdAt: string
  occasionKey?: string | null
}

export type DashboardFocus = {
  companyId?: string | null
  /** Undefined means the city filter is off. An empty string selects «غير محدد». */
  cityKey?: string
  /** Undefined means the occasion filter is off. Null selects «غير محدد». */
  occasionKey?: string | null
}

export function applyDashboardFocus<Live extends { id: string }>(input: {
  focus: DashboardFocus
  orders: PrintOrderRow[]
  previousOrders: PrintOrderRow[]
  jobs: GenerationWindowRow[]
  previousJobs: GenerationWindowRow[]
  attempts: AttemptRow[]
  live: Live[]
  occasionByDesign?: Map<string, string | null>
}) {
  const companyId = input.focus.companyId?.trim() || null
  const hasCity = input.focus.cityKey !== undefined
  const cityKey = hasCity ? input.focus.cityKey : undefined
  const hasOccasion = input.focus.occasionKey !== undefined
  const occasionKey = hasOccasion ? input.focus.occasionKey ?? null : undefined
  const orderOk = (order: PrintOrderRow) => {
    if (companyId && order.companyId !== companyId) return false
    if (hasCity && groupCity(order.deliveryCity).key !== cityKey) return false
    if (hasOccasion && (order.occasionKey ?? null) !== occasionKey) return false
    return true
  }
  const jobOccasion = (job: GenerationWindowRow) => (
    job.design_id ? input.occasionByDesign?.get(job.design_id) ?? null : null
  )
  const jobOk = (job: GenerationWindowRow) => {
    if (companyId && job.company_id !== companyId) return false
    if (hasOccasion && jobOccasion(job) !== occasionKey) return false
    return true
  }
  const orders = input.orders.filter(orderOk)
  const previousOrders = input.previousOrders.filter(orderOk)
  const jobs = input.jobs.filter(jobOk)
  const previousJobs = input.previousJobs.filter(jobOk)
  const jobIds = new Set(jobs.map((job) => job.id))
  const generationScoped = Boolean(companyId || hasOccasion)
  const attempts = generationScoped
    ? input.attempts.filter((attempt) => {
        if (companyId && attempt.company_id && attempt.company_id !== companyId) return false
        if (companyId && !attempt.company_id && !jobIds.has(attempt.job_id)) return false
        if (hasOccasion && !jobIds.has(attempt.job_id)) return false
        return true
      })
    : input.attempts
  const live = generationScoped ? input.live.filter((item) => jobIds.has(item.id)) : input.live
  return {
    orders,
    previousOrders,
    jobs,
    previousJobs,
    attempts,
    live,
    scope: {
      company: Boolean(companyId),
      city: hasCity,
      occasion: hasOccasion,
      citySkipsGenerations: hasCity,
      companiesTotalUnaffected: true,
    },
  }
}

export function dashboardFacets(input: {
  companies: { id: string; name: string }[]
  orders: PrintOrderRow[]
  jobs: GenerationWindowRow[]
  occasionByDesign?: Map<string, string | null>
}) {
  const cities = new Map<string, string>()
  for (const order of input.orders) {
    const city = groupCity(order.deliveryCity)
    cities.set(city.key, city.label)
  }
  const occasions = new Map<string, string>()
  const addOccasion = (key: string | null | undefined) => {
    const id = key || ''
    if (!occasions.has(id)) occasions.set(id, key ? (occasionByKey(key)?.titleAr ?? key) : 'غير محدد')
  }
  for (const order of input.orders) addOccasion(order.occasionKey ?? null)
  for (const job of input.jobs) addOccasion(job.design_id ? input.occasionByDesign?.get(job.design_id) ?? null : null)
  return {
    companies: [...input.companies].sort((left, right) => left.name.localeCompare(right.name, 'ar')),
    cities: [...cities.entries()].map(([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label, 'ar')),
    occasions: [...occasions.entries()].map(([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label, 'ar')),
  }
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

const OPEN_ORDER_STATUSES = ['محفوظ', 'قيد التجهيز', 'مسند', 'مقبول', 'مرفوض', 'قيد التنفيذ'] as const

export function isRasterPreview(mime: string | null) {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/webp'
}

export function isCancelledOrder(status: string) {
  return status === 'ملغى' || status === 'ملغاة' || status === 'cancelled'
}

function savedOrderAt(order: { status: string, createdAt: string }, start: number, end: number) {
  if (isCancelledOrder(order.status)) return false
  const at = Date.parse(order.createdAt)
  return Number.isFinite(at) && at >= start && at <= end
}

export function activityTrend(input: {
  from: number
  to: number
  jobs: { status: string, requested_at: number }[]
  orders: { status: string, createdAt: string }[]
}) {
  return riyadhDays(input.from, input.to).map((day) => ({
    day: day.day,
    succeeded: input.jobs.filter((job) => job.status === 'succeeded' && job.requested_at >= day.start && job.requested_at <= day.end).length,
    orders: input.orders.filter((order) => savedOrderAt(order, day.start, day.end)).length,
    partial: day.partial,
  }))
}

export function orderTrend(input: {
  from: number
  to: number
  previousFrom: number
  previousTo: number
  orders: { status: string, createdAt: string }[]
  previousOrders: { status: string, createdAt: string }[]
}) {
  const current = riyadhDays(input.from, input.to)
  const previousEnd = input.previousTo > input.previousFrom ? input.previousTo - 1 : input.previousTo
  const previous = riyadhDays(input.previousFrom, previousEnd)
  return current.map((day, index) => ({
    day: day.day,
    orders: input.orders.filter((order) => savedOrderAt(order, day.start, day.end)).length,
    partial: day.partial,
    previousOrders: previous[index]
      ? input.previousOrders.filter((order) => savedOrderAt(order, previous[index].start, previous[index].end)).length
      : null,
    previousDay: previous[index]?.day ?? null,
  }))
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
  companyNames?: Map<string, string>
}) {
  const inWindow = (at: number) => at >= input.previousFrom && at < input.previousTo
  const inCurrent = (at: number) => at >= input.from && at <= input.to
  const companiesNew = input.registrations.filter((at) => Number.isFinite(at) && inCurrent(at)).length
  const previousCompaniesNew = input.registrations.filter((at) => Number.isFinite(at) && inWindow(at)).length
  const images = input.jobs.filter((job) => job.status === 'succeeded' && isRasterPreview(job.preview_mime)).length
  const previousImages = input.previousJobs.filter((job) => job.status === 'succeeded' && isRasterPreview(job.preview_mime)).length
  const succeededJobs = input.jobs.filter((job) => job.status === 'succeeded')
  const companiesThatGenerated = new Set(input.jobs.map((job) => job.company_id).filter(Boolean))
  const completed = input.orders.filter((order) => isCompletedOrderStatus(order.status))
  const previousCompleted = input.previousOrders.filter((order) => isCompletedOrderStatus(order.status))
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
  const savedOrders = input.orders.filter((order) => !isCancelledOrder(order.status))
  const previousSaved = input.previousOrders.filter((order) => !isCancelledOrder(order.status))
  const products = new Map<string, { orders: number, quantity: number }>()
  for (const order of savedOrders) {
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
  for (const order of savedOrders) bump(order.occasionKey === undefined ? occasionFor(order.designId, undefined) : order.occasionKey, 'orders')
  const companyActivity = new Map<string, { name: string, generations: number, orders: number }>()
  const touchCompany = (companyId: string | undefined, name: string | undefined) => {
    if (!companyId) return null
    const current = companyActivity.get(companyId) ?? { name: input.companyNames?.get(companyId) || name || companyId, generations: 0, orders: 0 }
    if (name && current.name === companyId) current.name = name
    companyActivity.set(companyId, current)
    return current
  }
  for (const job of succeededJobs) {
    const row = touchCompany(job.company_id, undefined)
    if (row) row.generations += 1
  }
  for (const order of savedOrders) {
    const row = touchCompany(order.companyId, order.companyName)
    if (row) row.orders += 1
  }
  const rankedCompanies = [...companyActivity.entries()].map(([companyId, value]) => ({
    companyId,
    name: value.name,
    orders: value.orders,
  })).filter((row) => row.orders > 0).sort((left, right) => right.orders - left.orders || left.name.localeCompare(right.name, 'ar'))
  const leadingOrders = rankedCompanies[0]?.orders ?? 0
  const leaders = rankedCompanies.filter((row) => row.orders === leadingOrders)
  const cityCounts = new Map<string, { label: string, orders: number }>()
  for (const order of savedOrders) {
    const city = groupCity(order.deliveryCity)
    const current = cityCounts.get(city.key) ?? { label: city.label, orders: 0 }
    current.orders += 1
    cityCounts.set(city.key, current)
  }
  const covered = riyadhDays(input.from, input.to)
  const previousSucceeded = input.previousJobs.filter((job) => job.status === 'succeeded').length
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
    generationsChange: changeRatio(succeededJobs.length, previousSucceeded),
    savedRequests: savedOrders.length,
    savedRequestsChange: changeRatio(savedOrders.length, previousSaved.length),
    calendarDays: covered.length,
    averageDailyOrders: covered.length ? Number((savedOrders.length / covered.length).toFixed(2)) : null,
    periodPartial: covered.some((day) => day.partial),
    leaders,
    leadersTied: leaders.length > 1,
    cities: [...cityCounts.entries()].map(([key, value]) => ({
      key,
      label: value.label,
      orders: value.orders,
      ratio: savedOrders.length ? Number((value.orders / savedOrders.length).toFixed(4)) : 0,
    })).sort((left, right) => right.orders - left.orders || left.label.localeCompare(right.label, 'ar')),
    trend: activityTrend({ from: input.from, to: input.to, jobs: input.jobs, orders: input.orders }),
    orderTrend: orderTrend({
      from: input.from,
      to: input.to,
      previousFrom: input.previousFrom,
      previousTo: input.previousTo,
      orders: input.orders,
      previousOrders: input.previousOrders,
    }),
    companyActivity: [...companyActivity.entries()].map(([companyId, value]) => ({ companyId, ...value })),
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

const FAILURE_LABEL: Record<string, string> = {
  QUOTA: 'تجاوز حصة المزود',
  TIMEOUT: 'انتهت مهلة التوليد',
  INVALID_OUTPUT: 'النتيجة غير صالحة للعرض',
  IMAGE_RATE_LIMITED: 'تجاوز حد الصور',
  COMPOSE_RATE_LIMIT: 'تجاوز حد التوليد',
  FAILED: 'فشل التوليد',
  INVALID: 'طلب غير صالح لدى المزود',
}

export function failureLabel(code: string | null | undefined) {
  if (!code) return 'فشل التوليد'
  return FAILURE_LABEL[code] || 'فشل التوليد'
}

const SAME_CLOCK_MS = 250

type PerformanceJob = {
  id: string
  company_id: string
  status: string
  requested_at: number
  finished_at?: number | null
  api_duration_ms: number | null
  generation_duration_ms: number | null
  failure_code: string | null
  http_status?: number | null
}

export function generationPerformance(input: {
  from: number
  to: number
  jobs: PerformanceJob[]
  attempts: { job_id: string, failure_code: string | null }[]
}) {
  const succeeded = input.jobs.filter((job) => job.status === 'succeeded')
  const failed = input.jobs.filter((job) => job.status === 'failed')
  const timedOut = input.jobs.filter((job) => job.status === 'timeout')
  const inProgress = input.jobs.filter((job) => job.status === 'queued' || job.status === 'running')
  const finished = input.jobs.filter((job) => job.status !== 'queued' && job.status !== 'running')
  const decided = succeeded.length + failed.length + timedOut.length
  const apiSamples = finished.map((job) => job.api_duration_ms).filter((value): value is number => value !== null)
  const generationSamples = succeeded.map((job) => job.generation_duration_ms).filter((value): value is number => value !== null)
  const paired = input.jobs.filter((job) => job.api_duration_ms !== null && job.generation_duration_ms !== null)
  const sameMeasurement = paired.length > 0 && paired.every((job) => Math.abs((job.api_duration_ms ?? 0) - (job.generation_duration_ms ?? 0)) <= SAME_CLOCK_MS)
  const reasons = new Map<string, number>()
  for (const job of [...failed, ...timedOut]) {
    const code = job.failure_code || (job.status === 'timeout' ? 'TIMEOUT' : 'FAILED')
    reasons.set(code, (reasons.get(code) || 0) + 1)
  }
  const outcomes = [
    { status: 'succeeded', label: 'ناجحة', count: succeeded.length },
    { status: 'failed', label: 'فاشلة', count: failed.length },
    { status: 'timeout', label: 'مهلة', count: timedOut.length },
  ].filter((item) => item.count > 0)
  return {
    started: input.jobs.length,
    succeeded: succeeded.length,
    failed: failed.length,
    timedOut: timedOut.length,
    inProgress: inProgress.length,
    decided,
    successRate: decided === 0 ? null : Number((succeeded.length / decided).toFixed(4)),
    avgApiMs: average(apiSamples),
    p95ApiMs: percentile95(apiSamples),
    avgGenerationMs: average(generationSamples),
    sameMeasurement,
    providerCalls: input.attempts.length,
    failures: [...reasons.entries()].map(([code, count]) => ({ code, label: failureLabel(code), count })).sort((left, right) => right.count - left.count),
    responseTrend: riyadhDays(input.from, input.to).flatMap((day) => {
      const samples = finished.filter((job) => job.api_duration_ms !== null && job.requested_at >= day.start && job.requested_at <= day.end).map((job) => job.api_duration_ms as number)
      if (!samples.length) return []
      return [{ day: day.day, avgMs: average(samples), partial: day.partial }]
    }),
    outcomes,
  }
}

export type AttentionItem = {
  id: string
  kind: 'order' | 'generation' | 'provider'
  companyId: string | null
  companyName: string
  subject: string
  reason: string
  reasonCode: string
  reasonVars: Record<string, string | number>
  at: string
}

export function adminAttention(input: {
  now: number
  orders: PrintOrderRow[]
  jobs: PerformanceJob[]
  attempts: { job_id: string, company_id?: string, at: number, failure_code: string | null }[]
  companyNames?: Map<string, string>
  failedDesignIds: Set<string>
}) {
  const nameOf = (companyId: string | null | undefined, fallback?: string) => {
    if (companyId && input.companyNames?.get(companyId)) return input.companyNames.get(companyId) as string
    return fallback || '—'
  }
  const orders = input.orders.flatMap((order) => {
    const reason = orderNeedsFollowUp(order, { now: input.now, failedDesignIds: input.failedDesignIds })
    if (!reason) return []
    const pastDelivery = Boolean(order.deliveryDate && order.deliveryDate < riyadhDate(input.now))
    const item: AttentionItem = {
      id: order.id,
      kind: 'order',
      companyId: order.companyId ?? null,
      companyName: nameOf(order.companyId, order.companyName),
      subject: order.id,
      reason,
      reasonCode: pastDelivery ? 'DELIVERY_PASSED' : 'GENERATION_FAILED',
      reasonVars: pastDelivery ? { date: String(order.deliveryDate) } : {},
      at: order.createdAt,
    }
    return [item]
  })
  const generations = input.jobs.filter((job) => job.status === 'failed' || job.status === 'timeout').map((job) => ({
    id: job.id,
    kind: 'generation' as const,
    companyId: job.company_id,
    companyName: nameOf(job.company_id),
    subject: job.id,
    reason: failureLabel(job.failure_code || (job.status === 'timeout' ? 'TIMEOUT' : 'FAILED')),
    reasonCode: job.failure_code || (job.status === 'timeout' ? 'TIMEOUT' : 'FAILED'),
    reasonVars: {},
    at: new Date(job.finished_at ?? job.requested_at).toISOString(),
  }))
  const providerGroups = new Map<string, { attempts: number, jobs: Set<string>, companies: Set<string>, latest: number }>()
  for (const attempt of input.attempts) {
    if (!attempt.failure_code) continue
    const current = providerGroups.get(attempt.failure_code) ?? { attempts: 0, jobs: new Set<string>(), companies: new Set<string>(), latest: 0 }
    current.attempts += 1
    current.jobs.add(attempt.job_id)
    if (attempt.company_id) current.companies.add(attempt.company_id)
    current.latest = Math.max(current.latest, attempt.at)
    providerGroups.set(attempt.failure_code, current)
  }
  const providers = [...providerGroups.entries()].flatMap(([code, group]) => {
    if (group.attempts < 2) return []
    const companies = [...group.companies]
    const label = failureLabel(code)
    const calls = group.attempts === 1 ? 'استدعاء واحد' : `${group.attempts} استدعاءات`
    const operations = group.jobs.size === 1 ? 'عملية واحدة' : `${group.jobs.size} عمليات`
    const item: AttentionItem = {
      id: `provider-${code}`,
      kind: 'provider',
      companyId: companies.length === 1 ? companies[0] : null,
      companyName: companies.length === 1 ? nameOf(companies[0]) : 'عدة شركات',
      subject: label,
      reason: `${label} في ${calls} على ${operations}`,
      reasonCode: 'PROVIDER_REPEAT',
      reasonVars: { failure: code, calls: group.attempts, jobs: group.jobs.size },
      at: new Date(group.latest).toISOString(),
    }
    return [item]
  })
  return [...orders, ...generations, ...providers].sort((left, right) => right.at.localeCompare(left.at))
}

export function orderNeedsFollowUp(order: PrintOrderRow, input: { now: number, failedDesignIds: Set<string> }) {
  if (isCancelledOrder(order.status) || isCompletedOrderStatus(order.status)) return null
  if (order.designId && input.failedDesignIds.has(order.designId)) {
    return 'التوليد المرتبط بهذا الطلب فشل أو انتهت مهلته'
  }
  const today = riyadhDate(input.now)
  if (order.deliveryDate && order.deliveryDate < today) return `تجاوز تاريخ التسليم المطلوب ${order.deliveryDate}`
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
    const reason = orderNeedsFollowUp(order, { now: input.now, failedDesignIds })
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
      companyNames: input.companyNames,
    }),
    performance: generationPerformance({ from: input.from, to: input.to, jobs: input.jobs, attempts: input.attempts }),
    attention: adminAttention({
      now: input.now,
      orders: input.orders,
      jobs: input.jobs,
      attempts: input.attempts,
      companyNames: input.companyNames,
      failedDesignIds,
    }),
  }
}
