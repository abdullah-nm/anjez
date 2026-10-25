import { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { countAxisEnd, countAxisTicks } from '../../shared/chartScale.ts'
import { useAuth } from '../auth'
import { DateField } from '../components/DateField'
import { useI18n, type MessageKey } from '../i18n'

type Preset = 'today' | '7d' | '30d' | 'custom'
type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout'

const STATUS_COLOR: Record<string, string> = {
  محفوظ: '#1d4ed8',
  'قيد التجهيز': '#d97706',
  مستلم: '#0f766e',
  مسند: '#0e7490',
  مقبول: '#1d4ed8',
  مرفوض: '#94a3b8',
  'قيد التنفيذ': '#d97706',
  مكتمل: '#0f766e',
  ملغى: '#94a3b8',
  ملغاة: '#94a3b8',
}
const GENERATION = '#0f766e'
const ORDERS = '#1e3a5f'
const FAILED = '#b45309'
const SLICE = ['#0f766e', '#1e3a5f', '#d97706', '#1d4ed8', '#0e7490', '#7c3aed']

type Operation = {
  id: string
  companyId?: string
  companyName?: string
  userName: string
  status: GenerationStatus
  requestedAt: string
  finishedAt: string | null
  generationDurationMs: number | null
  providerAttempts: number
  failureCode: string | null
  occasionKey?: string | null
  previewUrl: string | null
}
type CompanyRow = { id: string; name: string; email: string; createdAt: string; status: string; orders: number; designs: number; generations: number }
type OrderRow = {
  id: string
  companyId?: string
  companyName?: string
  productId: string
  status: string
  quantity: number
  createdAt: string
  deliveryCity?: string
  occasionKey?: string | null
}
type ProductRow = { productId: string; orders: number; quantity: number; averageQuantity: number | null }
type CityRow = { key: string; label: string; orders: number; ratio: number }
type CitySlice = CityRow & { members?: CityRow[] }
type Leader = { companyId: string; name: string; orders: number }
type Board = {
  companiesTotal: number
  companiesNew: number
  companiesNewChange: number | null
  savedRequests: number
  savedRequestsChange: number | null
  calendarDays: number
  averageDailyOrders: number | null
  periodPartial: boolean
  leaders: Leader[]
  leadersTied: boolean
  products: ProductRow[]
  cities: CityRow[]
  occasions: { key: string | null; label: string; generations: number; orders: number }[]
  orderTrend: { day: string; orders: number; partial: boolean; previousOrders: number | null; previousDay: string | null }[]
  companyActivity: { companyId: string; name: string; generations: number; orders: number }[]
  statuses: { status: string; count: number; ratio: number }[]
}
type Performance = {
  started: number
  succeeded: number
  failed: number
  timedOut: number
  inProgress: number
  successRate: number | null
  avgApiMs: number | null
  p95ApiMs: number | null
  avgGenerationMs: number | null
  sameMeasurement: boolean
  providerCalls: number
  failures: { code: string; label: string; count: number }[]
  responseTrend: { day: string; avgMs: number | null; partial: boolean }[]
  outcomes: { status: string; label: string; count: number }[]
}
type Attention = {
  id: string
  kind: 'order' | 'generation' | 'provider'
  companyId: string | null
  companyName: string
  subject: string
  reason: string
  reasonCode?: string
  reasonVars?: Record<string, string | number>
  at: string
}
type SortMode = 'desc' | 'asc' | 'name'
type Facet = { key: string; label: string }
type Report = {
  from: string
  to: string
  generatedAt: string
  companies?: { rows: CompanyRow[] }
  board?: Board
  performance?: Performance
  attention?: Attention[]
  orders: { recent: OrderRow[] }
  recent: Operation[]
  focus?: { company: boolean; city: boolean; occasion: boolean; citySkipsGenerations: boolean; companiesTotalUnaffected: boolean }
  facets?: { companies: { id: string; name: string }[]; cities: Facet[]; occasions: Facet[] }
}
type CompanyDetail = {
  company: CompanyRow
  orders: OrderRow[]
  designs: { id: string; status: string; createdAt: string }[]
  generations: Operation[]
}

const presets: Preset[] = ['today', '7d', '30d', 'custom']
const presetKey: Record<Preset, MessageKey> = { today: 'today', '7d': 'last7', '30d': 'last30', custom: 'customPeriod' }

function formatWhen(value: string, locale: 'ar' | 'en') {
  const date = new Date(value.length === 10 ? `${value}T00:00:00+03:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', { timeZone: 'Asia/Riyadh', month: 'short', day: 'numeric' }).format(date)
}
function statusColor(status: string) {
  return STATUS_COLOR[status] || '#64748b'
}
function productName(id: string, label: (id: string, fallback: string) => string) {
  return label(id, id)
}
function sliceColor(id: string, index: number) {
  if (id === '__other__') return '#94a3b8'
  let hash = 0
  for (const char of id) hash = (hash + char.charCodeAt(0)) % SLICE.length
  return SLICE[(hash + index) % SLICE.length]
}
function shortLabel(value: string) {
  return value.length > 18 ? `${value.slice(0, 17)}…` : value
}
function axisEnd(max: number) {
  return Math.max(1, Math.ceil(Number.isFinite(max) ? max : 0))
}
function axisTicks(end: number) {
  if (end <= 5) return Array.from({ length: end + 1 }, (_, index) => index)
  const step = Math.ceil(end / 4)
  const ticks: number[] = []
  for (let value = 0; value < end; value += step) ticks.push(value)
  if (ticks[ticks.length - 1] !== end) ticks.push(end)
  return ticks
}
function sortNamed<T>(rows: T[], mode: SortMode, valueOf: (row: T) => number, nameOf: (row: T) => string, locale: 'ar' | 'en') {
  const copy = [...rows]
  const tag = locale === 'ar' ? 'ar' : 'en'
  if (mode === 'name') return copy.sort((left, right) => nameOf(left).localeCompare(nameOf(right), tag) || valueOf(right) - valueOf(left))
  if (mode === 'asc') return copy.sort((left, right) => valueOf(left) - valueOf(right) || nameOf(left).localeCompare(nameOf(right), tag))
  return copy.sort((left, right) => valueOf(right) - valueOf(left) || nameOf(left).localeCompare(nameOf(right), tag))
}
function barChartHeight(count: number) {
  const rows = Math.max(count, 1)
  return Math.min(440, Math.max(112, rows * 44 + 36))
}
function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id
}
function CountLabel({ horizontal, x = 0, y = 0, width = 0, height = 0, value, viewBox }: { horizontal?: boolean; x?: number; y?: number; width?: number; height?: number; value?: number | string; viewBox?: { x?: number; y?: number; width?: number; height?: number } }) {
  const { formatNumber } = useI18n()
  if (value === undefined || value === null || value === '') return null
  const label = formatNumber(Number(value))
  const bx = Number(viewBox?.x ?? x)
  const by = Number(viewBox?.y ?? y)
  const bw = Number(viewBox?.width ?? width)
  const bh = Number(viewBox?.height ?? height)
  if (!horizontal) {
    return <text x={bx + bw / 2} y={by - 6} textAnchor="middle" fill="#10203a" fontSize={12}>{label}</text>
  }
  const tip = bx + bw
  return (
    <text x={tip + (bw < 0 ? -6 : 6)} y={by + Math.abs(bh) / 2} textAnchor={bw < 0 ? 'end' : 'start'} dominantBaseline="middle" fill="#10203a" fontSize={12}>
      {label}
    </text>
  )
}
function citySlices(rows: CityRow[], total: number, otherLabel: string): CitySlice[] {
  const sorted = [...rows].filter((row) => row.orders > 0)
  const share = (orders: number) => (total ? Number((orders / total).toFixed(4)) : 0)
  if (sorted.length <= 5) return sorted.map((row) => ({ ...row, ratio: share(row.orders) }))
  const head = sorted.slice(0, 5)
  const tail = sorted.slice(5)
  const orders = tail.reduce((sum, row) => sum + row.orders, 0)
  return [
    ...head.map((row) => ({ ...row, ratio: share(row.orders) })),
    { key: '__other__', label: otherLabel, orders, ratio: share(orders), members: tail },
  ]
}
function Delta({ value }: { value: number | null }) {
  const { t, formatNumber } = useI18n()
  if (value === null) return null
  const amount = formatNumber(Math.abs(value * 100))
  return <p className={value >= 0 ? 'dash-delta up' : 'dash-delta down'}>{value >= 0 ? t('deltaUp', { amount }) : t('deltaDown', { amount })}</p>
}

export function Monitor() {
  const { user, loading } = useAuth()
  const { t, statusLabel, locale, formatNumber, formatDateTime, formatPercent, formatDuration, cityLabel, occasionLabel, failureLabel, productLabel, errorText, countText } = useI18n()
  const [preset, setPreset] = useState<Preset>('7d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [stale, setStale] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [compare, setCompare] = useState(true)
  const [occasionMode, setOccasionMode] = useState<'generations' | 'orders'>('orders')
  const [orderStatus, setOrderStatus] = useState('all')
  const [occasionKey, setOccasionKey] = useState<string | null | undefined>(undefined)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [cityKey, setCityKey] = useState<string | null>(null)
  const [showAllCities, setShowAllCities] = useState(false)
  const [showOtherCities, setShowOtherCities] = useState(false)
  const [failureCode, setFailureCode] = useState<string | null>(null)
  const [companyQuery, setCompanyQuery] = useState('')
  const [companySort, setCompanySort] = useState<SortMode>('desc')
  const [occasionSort, setOccasionSort] = useState<SortMode>('desc')
  const [citySort, setCitySort] = useState<SortMode>('desc')
  const loadSeq = useRef(0)
  const [showAttention, setShowAttention] = useState(false)
  const [detail, setDetail] = useState<CompanyDetail | null>(null)
  const [detailError, setDetailError] = useState('')

  useEffect(() => {
    if (!user || user.role !== 'admin') return
    const tick = () => setAttempt((value) => value + 1)
    const timer = window.setInterval(tick, 15_000)
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    if (user.role !== 'admin') {
      setPending(false)
      setError('adminOnly')
      return
    }
    if (preset === 'custom' && (!from || !to)) {
      setPending(false)
      return
    }
    const seq = ++loadSeq.current
    const controller = new AbortController()
    const hadReport = Boolean(report)
    if (!report) setPending(true)
    else setRefreshing(true)
    const params = new URLSearchParams({ preset })
    if (preset === 'custom') {
      params.set('from', from)
      params.set('to', to)
    }
    if (companyId) params.set('company', companyId)
    if (cityKey !== null) params.set('city', cityKey === '' ? '__blank__' : cityKey)
    if (occasionKey !== undefined) params.set('occasion', occasionKey === null ? '__blank__' : occasionKey)
    void (async () => {
      try {
        const response = await fetch(`/api/observability/dashboard?${params}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
        const payload = (await response.json().catch(() => ({}))) as { error?: string, code?: string }
        if (seq !== loadSeq.current) return
        if (!response.ok) throw new Error(payload.code || 'loadMonitorFailed')
        setReport(payload as Report)
        setError('')
        setStale(false)
      } catch (loadError) {
        if (controller.signal.aborted || seq !== loadSeq.current) return
        setStale(hadReport)
        setError(loadError instanceof Error && loadError.message ? loadError.message : 'loadMonitorFailed')
      } finally {
        if (seq === loadSeq.current) {
          setPending(false)
          setRefreshing(false)
        }
      }
    })()
    return () => controller.abort()
  }, [user, preset, from, to, attempt, companyId, cityKey, occasionKey])

  useEffect(() => {
    if (!user || user.role !== 'admin' || !companyId) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/observability/companies/${encodeURIComponent(companyId)}`, { credentials: 'include', cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as { error?: string, code?: string, company?: { id: string } }
        if (!response.ok) throw new Error(payload.code || 'loadCompanyFailed')
        if (cancelled || payload.company?.id !== companyId) return
        setDetail(payload as CompanyDetail)
        setDetailError('')
      } catch (loadError) {
        if (!cancelled) setDetailError(loadError instanceof Error && loadError.message ? loadError.message : 'loadCompanyFailed')
      }
    })()
    return () => { cancelled = true }
  }, [user, companyId, attempt])

  const board = report?.board
  const performance = report?.performance
  const companies = report?.companies?.rows ?? []
  const companyName = (id?: string | null, fallback?: string) => companies.find((row) => row.id === id)?.name || fallback || '—'
  const trend = useMemo(() => (board?.orderTrend ?? []).map((point) => ({
    ...point,
    label: formatWhen(point.day, locale),
  })), [board, locale])
  const slices = useMemo(() => citySlices((board?.cities ?? []).map((row) => ({ ...row, label: row.key ? cityLabel(row.label) : t('unspecified') })), board?.savedRequests ?? 0, t('otherCities')), [board, locale])
  const leadOrders = board?.cities[0]?.orders ?? 0
  const occasionData = useMemo(() => {
    const rows = [...(board?.occasions ?? [])].map((item) => ({
      ...item,
      label: item.key ? occasionLabel(item.key, item.label) : t('unspecified'),
      value: occasionMode === 'orders' ? item.orders : item.generations,
    }))
    const active = rows.filter((item) => item.value > 0)
    const total = active.reduce((sum, item) => sum + item.value, 0)
    return sortNamed(active, occasionSort, (item) => item.value, (item) => item.label, locale).map((item) => ({ ...item, share: total ? item.value / total : 0 }))
  }, [board, occasionMode, occasionSort, locale])
  const companyData = useMemo(() => {
    const rows = (board?.companyActivity ?? []).map((row) => ({ ...row, name: companyName(row.companyId, row.name) }))
      .filter((row) => row.orders > 0)
    const ranked = sortNamed(rows, companySort, (row) => row.orders, (row) => row.name, locale)
    if (companySort === 'name') return ranked.slice(0, 8)
    const edge = ranked[4]?.orders
    return ranked.filter((row, index) => index < 5 || (edge !== undefined && row.orders === edge))
  }, [board, companies, companySort, locale])
  const responseTrend = useMemo(() => (performance?.responseTrend ?? []).map((point) => ({ ...point, label: formatWhen(point.day, locale) })), [performance, locale])
  const filteredOrders = (report?.orders.recent ?? []).filter((order) => orderStatus === 'all' || order.status === orderStatus)
  const filtering = orderStatus !== 'all' || Boolean(companyId) || cityKey !== null || occasionKey !== undefined
  const orderBarEnd = countAxisEnd(Math.max(
    0,
    ...(board?.companyActivity ?? []).map((row) => row.orders),
    ...(board?.cities ?? []).map((row) => row.orders),
    ...(occasionMode === 'orders' ? (board?.occasions ?? []).map((row) => row.orders) : [0]),
  ))
  const occasionBarEnd = occasionMode === 'orders'
    ? orderBarEnd
    : countAxisEnd(Math.max(0, ...(board?.occasions ?? []).map((row) => row.generations)))
  const cityView = useMemo(() => {
    const other = slices.filter((item) => item.key === '__other__')
    const named = sortNamed(slices.filter((item) => item.key !== '__other__'), citySort, (item) => item.orders, (item) => item.label, locale)
    return [...named, ...other]
  }, [slices, citySort, locale])
  const waiting = preset === 'custom' && (!from || !to)
  const orderPeak = axisEnd(trend.reduce((max, point) => Math.max(max, point.orders, point.previousOrders ?? 0), 0))
  const attention = report?.attention ?? []
  const visibleAttention = showAttention ? attention : attention.slice(0, 6)
  const explain = (code: string) => {
    const direct: MessageKey[] = ['adminOnly', 'loadMonitorFailed', 'loadCompanyFailed']
    if (direct.includes(code as MessageKey)) return t(code as MessageKey)
    return errorText(code, t('loadMonitorFailed'))
  }
  const outcomeLabel = (status: string) => status === 'succeeded' ? t('outcomeSucceeded') : status === 'timeout' ? t('outcomeTimeout') : t('outcomeFailed')
  const attentionReason = (item: Attention) => {
    if (item.reasonCode === 'DELIVERY_PASSED') return t('deliveryPassed', { date: String(item.reasonVars?.date || '') })
    if (item.reasonCode === 'GENERATION_FAILED') return t('generationFailedReason')
    if (item.reasonCode === 'PROVIDER_REPEAT') return t('providerRepeat', { label: failureLabel(String(item.reasonVars?.failure || '')), calls: formatNumber(Number(item.reasonVars?.calls) || 0), jobs: formatNumber(Number(item.reasonVars?.jobs) || 0) })
    if (item.reasonCode) return failureLabel(item.reasonCode)
    return item.reason
  }
  const companyDisplay = (name: string) => name === 'عدة شركات' ? t('severalCompanies') : name
  const failedJobs = (report?.recent ?? []).filter((job) => (job.status === 'failed' || job.status === 'timeout') && job.failureCode === failureCode)
  const openCompany = (id: string) => {
    setCompanyId(id)
    setDetail((current) => current?.company.id === id ? current : null)
  }
  const pickCity = (key: string) => setCityKey((current) => current === key ? null : key)
  const resetFilters = () => {
    setPreset('7d')
    setFrom('')
    setTo('')
    setCompanyId(null)
    setCityKey(null)
    setOccasionKey(undefined)
    setOrderStatus('all')
    setCompanyQuery('')
    setCompanySort('desc')
    setOccasionSort('desc')
    setCitySort('desc')
    setDetail(null)
  }
  const facetCompanies = (report?.facets?.companies ?? companies.map((row) => ({ id: row.id, name: row.name })))
    .filter((row) => !companyQuery.trim() || row.name.includes(companyQuery.trim()))

  if (loading || (user && pending && !report && !error)) return <p className="dash-loading">{t('monitorLoading')}</p>
  if (!user || user.role !== 'admin') return <p className="notice err">{error || t('adminOnly')}</p>

  return (
    <div className="dash">
      <header className="dash-top">
        <h1>{t('platformFollow')}</h1>
        <div className="dash-periods" role="group" aria-label={t('period')}>
          {presets.map((item) => (
            <button key={item} type="button" className={item === preset ? 'on' : ''} onClick={() => setPreset(item)}>{t(presetKey[item])}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="dash-dates">
            <label>{t('from')}<DateField value={from} onChange={setFrom} /></label>
            <label>{t('to')}<DateField value={to} onChange={setTo} /></label>
          </div>
        )}
      </header>
      <p className="dash-updated">
        {report ? `${t('updated')} ${formatDateTime(report.generatedAt)}` : t('dataNotLoaded')}
        {report ? ` · ${formatWhen(report.from, locale)} – ${formatWhen(report.to, locale)}` : ''}
        {refreshing ? ` · ${t('refreshing')}` : ''}
        {stale ? ` · ${t('staleData')}` : ''}
      </p>
      <div className="dash-filters">
        <label>
          {t('companyFilter')}
          <input value={companyQuery} onChange={(event) => setCompanyQuery(event.target.value)} placeholder={t('searchCompany')} aria-label={t('searchCompany')} />
          <select value={companyId ?? ''} onChange={(event) => { if (!event.target.value) { setCompanyId(null); setDetail(null); return } openCompany(event.target.value) }} aria-label={t('company')}>
            <option value="">{t('allCompanies')}</option>
            {facetCompanies.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          {t('deliveryCity')}
          <select value={cityKey === null ? '' : (cityKey || '__blank__')} onChange={(event) => setCityKey(event.target.value === '' ? null : event.target.value === '__blank__' ? '' : event.target.value)} aria-label={t('deliveryCity')}>
            <option value="">{t('allCities')}</option>
            {(report?.facets?.cities ?? []).map((row) => <option key={row.key || '__blank__'} value={row.key || '__blank__'}>{row.key ? cityLabel(row.label) : t('unspecified')}</option>)}
          </select>
        </label>
        <label>
          {t('occasion')}
          <select value={occasionKey === undefined ? '' : occasionKey ?? '__blank__'} onChange={(event) => setOccasionKey(event.target.value === '' ? undefined : event.target.value === '__blank__' ? null : event.target.value)} aria-label={t('occasion')}>
            <option value="">{t('allOccasions')}</option>
            {(report?.facets?.occasions ?? []).map((row) => <option key={row.key || '__blank__'} value={row.key || '__blank__'}>{row.key ? occasionLabel(row.key, row.label) : t('unspecified')}</option>)}
          </select>
        </label>
        <button type="button" className="text-link" onClick={resetFilters}>{t('resetFilters')}</button>
      </div>
      {(companyId || cityKey !== null || occasionKey !== undefined) && (
        <p className="dash-note">
          {companyId ? `${t('companyScope')} ` : ''}
          {cityKey !== null ? `${t('cityScope')} ` : ''}
          {occasionKey !== undefined ? `${t('occasionScope')} ` : ''}
          {t('companiesStayGlobal')}
        </p>
      )}
      {error && <div className="notice err" role="alert"><p>{explain(error)} {t('fetchNotZero')}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>{t('retry')}</button></div>}
      {waiting && <div className="dash-card dash-empty"><strong>{t('pickRange')}</strong><p>{t('rangeLimit')}</p></div>}
      {report && !report.board && !waiting && <div className="notice err">{t('boardUnreadable')}</div>}
      {report?.board && !waiting && (
        <>
          <section className="dash-kpis" aria-label={t('indicators')}>
            <Kpi icon="building" label={t('registeredCompanies')} value={formatNumber(report.board.companiesTotal)} hint={t('companiesHint')} extra={countText('newInPeriod', report.board.companiesNew)} delta={report.board.companiesNewChange} />
            <Kpi icon="order" label={t('savedRequests')} value={formatNumber(report.board.savedRequests)} hint={t('savedHint')} delta={report.board.savedRequestsChange} />
            <QuantityCard products={report.board.products} />
            <Kpi icon="order" label={t('dailyAverage')} value={report.board.averageDailyOrders === null ? '—' : formatNumber(report.board.averageDailyOrders)} hint={t('averageHint')} extra={report.board.periodPartial ? `${t('overDays', { count: formatNumber(report.board.calendarDays) })} · ${t('todayPartial')}` : t('overDays', { count: formatNumber(report.board.calendarDays) })} delta={null} />
            <LeaderCard leaders={report.board.leaders} tied={report.board.leadersTied} onOpen={openCompany} />
          </section>

          <section className="dash-split">
            <article className="dash-card">
              <div className="dash-card-head">
                <h2 title={t('dailyOrdersTitle')}>{t('dailyOrders')}</h2>
                <div className="dash-toggle">
                  <button type="button" className={compare ? 'on' : ''} aria-pressed={compare} onClick={() => setCompare((value) => !value)}>{t('previousPeriod')}</button>
                </div>
              </div>
              {trend.length === 0 ? <Empty title={t('noDays')} text={t('lineAfterRange')} /> : (
                <div className="dash-chart line">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                      <CartesianGrid stroke="#e7eef6" vertical={false} />
                      <XAxis dataKey="label" padding={{ left: 20, right: 20 }} tick={{ fontSize: 11, fill: '#5c6d86' }} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis allowDecimals={false} allowDataOverflow width={36} padding={{ top: 18, bottom: 16 }} domain={[0, orderPeak]} ticks={axisTicks(orderPeak)} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                      <Tooltip content={<OrderTip compare={compare} />} />
                      <Line type="linear" dataKey="orders" name={t('thisPeriod')} stroke={ORDERS} strokeWidth={2} dot={{ r: 4, fill: ORDERS, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                      {compare && <Line type="linear" dataKey="previousOrders" name={t('previousPeriod')} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls={false} />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {trend.some((point) => point.partial) && <p className="dash-note">{t('todayStillOpen')}</p>}
            </article>
            <article className="dash-card">
              <h2 title={t('citiesChartTitle')}>{t('citiesChart')}</h2>
              <div className="city-body">
              {slices.length === 0 ? <Empty title={t('noSavedOrders')} text={t('distributionWhenSaved')} /> : slices.length === 1 ? (
                <button type="button" className="dash-summary" onClick={() => pickCity(slices[0].key)}>
                  <strong>{slices[0].label}</strong>
                  <span>{formatNumber(slices[0].orders)} {t('orderUnit')} · {formatPercent(slices[0].ratio)}</span>
                  <span>{slices[0].key ? t('onlyCity') : t('noCitySaved')}</span>
                </button>
              ) : (
                <div className="dash-donut">
                  <div className="dash-chart donut-chart">
                    <ResponsiveContainer width="100%" height={210}>
                      <PieChart>
                        <Pie data={slices} dataKey="orders" nameKey="label" innerRadius={58} outerRadius={80} paddingAngle={2} stroke="#fff" onClick={(entry) => {
                          const row = (entry as { payload?: CitySlice }).payload
                          if (!row) return
                          if (row.key === '__other__') setShowOtherCities((value) => !value)
                          else pickCity(row.key)
                        }}>
                          {slices.map((item, index) => <Cell key={item.key || item.label} fill={sliceColor(item.key || item.label, index)} stroke={item.key !== '__other__' && item.orders === leadOrders ? '#0f766e' : '#fff'} strokeWidth={item.key !== '__other__' && item.orders === leadOrders ? 3 : 1} />)}
                        </Pie>
                        <Tooltip content={<CityTip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="donut-center"><strong>{formatNumber(report.board.savedRequests)}</strong><span>{t('orderUnit')}</span></div>
                  </div>
                  <ul className="donut-key">
                    {cityView.map((item, index) => (
                      <li key={item.key || item.label}>
                        <button type="button" className={item.key !== '__other__' && item.orders === leadOrders ? 'lead' : ''} title={`${item.label} · ${formatNumber(item.orders)} · ${formatPercent(item.ratio)}`} onClick={() => item.key === '__other__' ? setShowOtherCities((value) => !value) : pickCity(item.key)}>
                          <i style={{ background: sliceColor(item.key || item.label, index) }} />
                          <span>{item.label}{item.key !== '__other__' && item.orders === leadOrders ? ` · ${t('mostRequested')}` : ''}</span>
                          <strong>{formatNumber(item.orders)}</strong>
                          <em>{formatPercent(item.ratio)}</em>
                        </button>
                        {item.key === '__other__' && showOtherCities && (
                          <ul className="dash-sub">
                            {item.members?.map((member) => <li key={member.key}><button type="button" className="text-link" onClick={() => pickCity(member.key)}>{member.label} · {formatNumber(member.orders)}</button></li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              </div>
              {slices.length > 1 && <div className="dash-card-foot"><SortSelect label={t('sortCities')} value={citySort} onChange={setCitySort} /><button type="button" className="text-link" onClick={() => setShowAllCities((value) => !value)}>{showAllCities ? t('hideCityRank') : t('allCityRank')}</button></div>}
              {showAllCities && slices.length > 1 && (
                <RankChart
                  data={sortNamed((board?.cities ?? []).map((row) => ({ ...row, label: row.key ? cityLabel(row.label) : t('unspecified') })), citySort, (row) => row.orders, (row) => row.label, locale) as unknown as Record<string, unknown>[]}
                  categoryKey="label"
                  valueKey="orders"
                  fill={ORDERS}
                  end={orderBarEnd}
                  cityTip
                  onPick={(row) => { if (typeof row.key === 'string') pickCity(row.key) }}
                />
              )}
            </article>
          </section>

          <section className="dash-pair">
            <article className="dash-card">
              <div className="dash-card-head">
                <h2>{t('topOccasions')}</h2>
                <div className="dash-toggle">
                  <button type="button" className={occasionMode === 'generations' ? 'on' : ''} aria-pressed={occasionMode === 'generations'} onClick={() => setOccasionMode('generations')}>{t('successfulGeneration')}</button>
                  <button type="button" className={occasionMode === 'orders' ? 'on' : ''} aria-pressed={occasionMode === 'orders'} onClick={() => setOccasionMode('orders')}>{t('savedOrdersToggle')}</button>
                  <SortSelect label={t('sortOccasions')} value={occasionSort} onChange={setOccasionSort} />
                </div>
              </div>
              {occasionData.length === 0 ? <Empty title={t('noLinkedOccasions')} text={t('noInferredOccasion')} /> : (
                <RankChart
                  data={occasionData as unknown as Record<string, unknown>[]}
                  categoryKey="label"
                  valueKey="value"
                  fill={occasionMode === 'orders' ? ORDERS : GENERATION}
                  unit={occasionMode === 'orders' ? t('orderUnit') : t('operation')}
                  end={occasionBarEnd}
                  onPick={(row) => { if ('key' in row) setOccasionKey((row.key as string | null) ?? null) }}
                />
              )}
            </article>
            <article className="dash-card">
              <div className="dash-card-head">
                <h2 title={t('topCompaniesTitle')}>{t('topCompanies')}</h2>
                <SortSelect label={t('sortCompanies')} value={companySort} onChange={setCompanySort} />
              </div>
              {companyData.length === 0 ? <Empty title={t('noCompanyOrders')} text={t('rankWhenSaved')} /> : (
                <RankChart
                  data={companyData as unknown as Record<string, unknown>[]}
                  categoryKey="name"
                  valueKey="orders"
                  fill={ORDERS}
                  unit={t('orderUnit')}
                  end={orderBarEnd}
                  onPick={(row) => { if (row.companyId) openCompany(String(row.companyId)) }}
                />
              )}
            </article>
          </section>

          <section className="dash-card" id="generation">
            <h2>{t('generationPerformance')}</h2>
            {report.focus?.citySkipsGenerations && <p className="dash-note">{t('citySkipsGeneration')}</p>}
            {report.focus?.company && <p className="dash-note">{t('numbersForCompany')}</p>}
            {report.focus?.occasion && <p className="dash-note">{t('numbersForOccasion')}</p>}
            {!performance ? <div className="notice err">{t('performanceUnreadable')}</div> : (
              <>
                <div className="dash-metrics">
                  <Metric label={t('jobsStarted')} value={formatNumber(performance.started)} hint={t('jobsStartedHint')} />
                  <Metric label={t('succeeded')} value={formatNumber(performance.succeeded)} hint={t('succeededHint')} />
                  <Metric label={t('failed')} value={formatNumber(performance.failed)} hint={t('failedHint')} />
                  <Metric label={t('inProgress')} value={formatNumber(performance.inProgress)} hint={t('inProgressHint')} extra={performance.timedOut ? t('timedOutExtra', { count: formatNumber(performance.timedOut) }) : undefined} />
                  <Metric label={t('successRate')} value={performance.successRate === null ? t('unavailable') : formatPercent(performance.successRate)} hint={t('successRateHint')} />
                  <Metric label={t('providerCalls')} value={formatNumber(performance.providerCalls)} hint={t('providerCallsHint')} />
                </div>
                <div className="dash-metrics">
                  <Metric label={t('avgApi')} value={formatDuration(performance.avgApiMs)} hint={t('avgApiHint')} extra={`P95 ${formatDuration(performance.p95ApiMs)}`} />
                  {performance.sameMeasurement && performance.avgGenerationMs === performance.avgApiMs ? null : (
                    <Metric label={t('avgComplete')} value={formatDuration(performance.avgGenerationMs)} hint={t('avgComplete')} />
                  )}
                </div>
                {performance.sameMeasurement && <p className="dash-note">{performance.avgGenerationMs === performance.avgApiMs ? t('sameClock') : t('sameClockDifferent')}</p>}
                <div className="dash-pair">
                  <article>
                    <h2>{performance.sameMeasurement ? t('responseAndComplete') : t('apiResponseTime')}</h2>
                    {responseTrend.length === 0 ? <Empty title={t('noDurations')} text={t('zeroDaysOmitted')} /> : (
                      <div className="dash-chart">
                        <ResponsiveContainer width="100%" height={220}>
                          <LineChart data={responseTrend} margin={{ top: 16, right: 20, left: 8, bottom: 8 }}>
                            <CartesianGrid stroke="#e7eef6" vertical={false} />
                            <XAxis dataKey="label" padding={{ left: 16, right: 16 }} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                            <YAxis width={46} padding={{ top: 16, bottom: 12 }} allowDecimals={false} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                            <Tooltip content={<LatencyTip />} />
                            <Line type="linear" dataKey="avgMs" name={t('avgMs')} stroke={GENERATION} strokeWidth={2} dot={false} connectNulls={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </article>
                  <article>
                    <h2>{t('successAndFailure')}</h2>
                    {performance.outcomes.length === 0 ? <Empty title={t('noFinished')} text={t('runningNotDrawn')} /> : performance.outcomes.length === 1 ? (
                      <div className="dash-summary"><strong>{outcomeLabel(performance.outcomes[0].status)}</strong><span>{formatNumber(performance.outcomes[0].count)} {t('operation')} · {t('onlyFinishedState')}</span></div>
                    ) : (
                      <div className="dash-chart">
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={performance.outcomes} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke="#e7eef6" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#10203a' }} />
                            <YAxis allowDecimals={false} allowDataOverflow width={32} domain={[0, countAxisEnd(Math.max(...performance.outcomes.map((item) => item.count)))]} ticks={countAxisTicks(countAxisEnd(Math.max(...performance.outcomes.map((item) => item.count))))} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                            <Tooltip content={<RankTip unit={t('operation')} />} />
                            <Bar dataKey="count" name={t('operations')} radius={[6, 6, 0, 0]} maxBarSize={56} isAnimationActive={false} label={<CountLabel />}>
                              {performance.outcomes.map((item) => <Cell key={item.status} fill={item.status === 'succeeded' ? GENERATION : item.status === 'timeout' ? '#94a3b8' : FAILED} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </article>
                </div>
                {performance.failures.length === 0 ? <p className="dash-note">{t('noFailureReasons')}</p> : (
                  <ul className="dash-follow">
                    {performance.failures.map((item) => (
                      <li key={item.code}>
                        <button type="button" onClick={() => setFailureCode((current) => current === item.code ? null : item.code)}>
                          <strong>{failureLabel(item.code)}</strong>
                          <span>{formatNumber(item.count)} {t('operations')}</span>
                        </button>
                        {failureCode === item.code && (
                          failedJobs.length === 0 ? <p className="dash-note">{t('noFailureReasons')}</p> : (
                            <ul className="dash-sub">
                              {failedJobs.slice(0, 6).map((job) => (
                                <li key={job.id}>
                                  <button type="button" className="text-link" onClick={() => job.companyId && openCompany(job.companyId)}>{job.companyName || companyName(job.companyId)} · {job.id} · {formatWhen(job.requestedAt, locale)}</button>
                                </li>
                              ))}
                            </ul>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="dash-pair loose">
            <article className="dash-card">
              <h2>{t('needsAttention')}</h2>
              {attention.length === 0 ? <Empty title={t('noFollowUp')} text={t('followUpText')} /> : (
                <ul className="dash-follow">
                  {visibleAttention.map((item) => (
                    <li key={`${item.kind}-${item.id}`} className="follow-row">
                      <button type="button" onClick={() => item.companyId && openCompany(item.companyId)}>
                        <strong>{companyDisplay(item.companyName)}</strong>
                        <span>{item.kind === 'order' ? t('attentionOrder') : item.kind === 'generation' ? t('attentionGeneration') : t('attentionProvider')} · {attentionReason(item)}</span>
                      </button>
                      {item.kind === 'provider' ? <span className="follow-id">{failureLabel(String(item.reasonVars?.failure || item.reasonCode || ''))}</span> : item.subject.length > 16 ? <ShortId id={item.subject} /> : <span className="follow-id">{item.subject}</span>}
                      <time>{formatWhen(item.at, locale)}</time>
                    </li>
                  ))}
                </ul>
              )}
              {attention.length > 6 && <button type="button" className="text-link" onClick={() => setShowAttention((value) => !value)}>{showAttention ? t('showLess') : t('showAll', { count: formatNumber(attention.length) })}</button>}
            </article>
            <article className="dash-card" id="records">
              <div className="dash-card-head">
                <h2>{filtering ? t('matchingOrders') : t('latestOrders')}</h2>
                {filtering && <button type="button" className="text-link" onClick={() => { setOrderStatus('all'); setCompanyId(null); setCityKey(null); setOccasionKey(undefined) }}>{t('clearFilter')}</button>}
              </div>
              <StatusSummary statuses={report.board.statuses} onPick={setOrderStatus} />
              {filteredOrders.length === 0 ? <Empty title={t('noOrdersFilter')} text={t('filterDoesNotChangeKpis')} /> : (
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <thead><tr><th>{t('company')}</th><th>{t('productColumn')}</th><th>{t('quantityColumn')}</th><th>{t('statusColumn')}</th><th>{t('dateColumn')}</th><th></th></tr></thead>
                    <tbody>
                      {filteredOrders.slice(0, 8).map((order) => (
                        <tr key={order.id}>
                          <td>{order.companyName || companyName(order.companyId)}</td>
                          <td>{productName(order.productId, productLabel)}</td>
                          <td>{formatNumber(order.quantity)}</td>
                          <td><span className="status-cell"><i className="status-dot" style={{ background: statusColor(order.status) }} />{statusLabel(order.status)}</span></td>
                          <td>{formatWhen(order.createdAt, locale)}</td>
                          <td>{order.companyId && <button type="button" onClick={() => openCompany(order.companyId!)}>{t('details')}</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </section>

          {companyId && (
            <section className="dash-card" id="company-detail">
              <div className="dash-card-head">
                <h2>{detail?.company.name || companyName(companyId)}</h2>
                <button type="button" className="text-link" onClick={() => setCompanyId(null)}>{t('close')}</button>
              </div>
              {detailError && <p className="notice err">{explain(detailError)} {t('fetchNotZero')}</p>}
              {!detail && !detailError && <p>{t('loadingDetails')}</p>}
              {detail?.company.id === companyId && (
                <div className="company-facts">
                  <p>{detail.company.email} · {formatWhen(detail.company.createdAt, locale)} · {detail.company.status}</p>
                  <p>{t('sinceRegistration', { orders: formatNumber(detail.company.orders), designs: formatNumber(detail.company.designs), generations: formatNumber(detail.company.generations) })}</p>
                  {detail.orders.length === 0 ? <p className="dash-note">{t('noOrders')}</p> : detail.orders.map((order) => <p key={order.id}>{order.id} · {productName(order.productId, productLabel)} · {statusLabel(order.status)} · {t('quantity')} {formatNumber(order.quantity)} · {formatWhen(order.createdAt, locale)}</p>)}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function SortSelect({ label, value, onChange }: { label: string; value: SortMode; onChange: (value: SortMode) => void }) {
  const { t } = useI18n()
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as SortMode)}>
      <option value="desc">{t('highest')}</option>
      <option value="asc">{t('lowest')}</option>
      <option value="name">{t('byName')}</option>
    </select>
  )
}
function RankChart({ data, categoryKey, valueKey, fill, unit, cityTip, end, onPick }: {
  data: Record<string, unknown>[]
  categoryKey: string
  valueKey: string
  fill: string
  unit?: string
  cityTip?: boolean
  end?: number
  onPick?: (row: Record<string, unknown>) => void
}) {
  const { locale } = useI18n()
  const peak = end ?? countAxisEnd(data.reduce((max, row) => Math.max(max, Number(row[valueKey]) || 0), 0))
  const rtl = locale === 'ar'
  return (
    <div className="dash-chart">
      <ResponsiveContainer width="100%" height={barChartHeight(data.length)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: rtl ? 8 : 42, left: rtl ? 42 : 8, bottom: 4 }} barCategoryGap={8}>
          <XAxis type="number" reversed={rtl} allowDecimals={false} allowDataOverflow domain={[0, peak]} ticks={countAxisTicks(peak)} tick={{ fontSize: 11, fill: '#5c6d86' }} />
          <YAxis type="category" dataKey={categoryKey} orientation={rtl ? 'right' : 'left'} width={108} interval={0} tick={{ fontSize: 12, fill: '#10203a' }} tickFormatter={(value) => shortLabel(String(value))} />
          {cityTip ? <Tooltip content={<CityTip />} /> : <Tooltip content={<RankTip unit={unit || ''} />} />}
          <Bar dataKey={valueKey} fill={fill} radius={rtl ? [6, 0, 0, 6] : [0, 6, 6, 0]} maxBarSize={20} isAnimationActive={false} label={<CountLabel horizontal />} onClick={(entry) => {
            const row = (entry as { payload?: Record<string, unknown> }).payload
            if (row) onPick?.(row)
          }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
function ShortId({ id }: { id: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="id-chip"
      title={copied ? t('copied') : id}
      onClick={() => {
        void navigator.clipboard?.writeText(id).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? t('copied') : shortId(id)}
    </button>
  )
}
function Kpi({ icon, label, value, hint, extra, delta }: { icon: string; label: string; value: string; hint: string; extra?: string; delta: number | null }) {
  return (
    <article className="dash-kpi" title={hint}>
      <span className={`kpi-icon ${icon}`} aria-hidden="true" />
      <p className="kpi-label">{label}</p>
      <strong className="kpi-value">{value}</strong>
      <div className="kpi-foot">
        {extra && <small title={extra}>{extra}</small>}
        <Delta value={delta} />
      </div>
    </article>
  )
}
function Metric({ label, value, hint, extra }: { label: string; value: string; hint: string; extra?: string }) {
  return <article className="dash-metric-card" title={hint}><span>{label}</span><strong>{value}</strong>{extra && <span>{extra}</span>}</article>
}
function QuantityCard({ products }: { products: ProductRow[] }) {
  const { t, formatNumber, productLabel } = useI18n()
  const [open, setOpen] = useState(false)
  const hint = products.length > 1 ? t('copiesHintMany') : t('copiesHintOne')
  const listed = products.map((item) => `${productName(item.productId, productLabel)} ${formatNumber(item.quantity)}`).join(' · ')
  return (
    <article className="dash-kpi" title={products.length ? `${hint} ${listed}` : t('noQuantities')}>
      <span className="kpi-icon order" aria-hidden="true" />
      <p className="kpi-label">{t('copiesRequested')}</p>
      {products.length > 1 ? (
        <div className="kpi-value qty-inline" title={listed}>
          {products.slice(0, 2).map((item) => <span key={item.productId}>{productName(item.productId, productLabel)} <b>{formatNumber(item.quantity)}</b></span>)}
        </div>
      ) : <strong className="kpi-value">{products.length === 1 ? formatNumber(products[0].quantity) : '—'}</strong>}
      <div className="kpi-foot">
        {products.length === 1 && <small>{productName(products[0].productId, productLabel)}</small>}
        {products.length > 2 && <button type="button" className="text-link" onClick={() => setOpen((value) => !value)}>{open ? t('hideQuantities') : t('allQuantities')}</button>}
        {products.length === 2 && <small>{t('eachProduct')}</small>}
      </div>
      {open && products.length > 1 && (
        <div className="kpi-pop" role="dialog" aria-label={t('quantitiesByProduct')}>
          {products.map((item) => <p key={item.productId}><span>{productName(item.productId, productLabel)}</span><strong>{formatNumber(item.quantity)}</strong></p>)}
        </div>
      )}
    </article>
  )
}
function LeaderCard({ leaders, tied, onOpen }: { leaders: Leader[]; tied: boolean; onOpen: (id: string) => void }) {
  const { t, formatNumber } = useI18n()
  const [open, setOpen] = useState(false)
  const count = leaders[0]?.orders ?? 0
  const names = leaders.map((row) => row.name).join(' · ')
  return (
    <article className="dash-kpi" title={tied ? t('tieTitle', { names }) : t('topCompanyTitle')}>
      <span className="kpi-icon building" aria-hidden="true" />
      <p className="kpi-label">{t('topCompany')}</p>
      <strong className={leaders.length === 1 ? 'kpi-value name' : 'kpi-value'} title={leaders.length === 1 ? leaders[0].name : names || undefined}>
        {leaders.length === 0 ? '—' : tied ? t('tie') : leaders[0].name}
      </strong>
      <div className="kpi-foot">
        {leaders.length > 0 && <small>{t('savedOrdersCount', { count: formatNumber(count) })}{tied ? ` · ${t('tiedCompanies', { count: formatNumber(leaders.length) })}` : ''}</small>}
        {leaders.length === 1 && <button type="button" className="text-link" onClick={() => onOpen(leaders[0].companyId)}>{t('details')}</button>}
        {tied && <button type="button" className="text-link" onClick={() => setOpen((value) => !value)}>{open ? t('hideTie') : t('showTie')}</button>}
      </div>
      {open && tied && (
        <div className="kpi-pop" role="dialog" aria-label={t('tiedCompaniesLabel')}>
          {leaders.map((row) => <button key={row.companyId} type="button" onClick={() => onOpen(row.companyId)}>{row.name}</button>)}
        </div>
      )}
    </article>
  )
}
function StatusSummary({ statuses, onPick }: { statuses: { status: string; count: number; ratio: number }[]; onPick: (status: string) => void }) {
  const { statusLabel, formatNumber, formatPercent } = useI18n()
  if (statuses.length === 0) return null
  if (statuses.length === 1) {
    return <button type="button" className="dash-summary" onClick={() => onPick(statuses[0].status)}><strong>{statusLabel(statuses[0].status)}</strong><span>{formatNumber(statuses[0].count)}</span></button>
  }
  return (
    <>
      <div className="status-bar" aria-hidden="true">{statuses.map((item) => <span key={item.status} style={{ flex: item.count, background: statusColor(item.status) }} />)}</div>
      <ul className="donut-key">
        {statuses.map((item) => (
          <li key={item.status}>
            <button type="button" onClick={() => onPick(item.status)}>
              <i style={{ background: statusColor(item.status) }} />
              <span>{statusLabel(item.status)}</span>
              <strong>{formatNumber(item.count)}</strong>
              <em>{formatPercent(item.ratio)}</em>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
function Empty({ title, text }: { title: string; text: string }) {
  return <div className="dash-empty"><strong>{title}</strong><p>{text}</p></div>
}
function OrderTip({ active, payload, label, compare }: { active?: boolean; payload?: { name?: string; dataKey?: string; value?: number; color?: string; payload?: { partial?: boolean; previousDay?: string | null } }[]; label?: string; compare: boolean }) {
  const { t, formatNumber, locale } = useI18n()
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  return (
    <div className="dash-tip">
      <p>{label}{row?.partial ? ` · ${t('partialMark')}` : ''}</p>
      {payload.filter((item) => compare || item.dataKey !== 'previousOrders').map((item) => (
        <p key={item.name}><i style={{ background: item.color }} />{item.name}{item.dataKey === 'previousOrders' && row?.previousDay ? ` (${formatWhen(row.previousDay, locale)})` : ''}: {item.value === undefined || item.value === null ? '—' : formatNumber(Number(item.value) || 0)}</p>
      ))}
    </div>
  )
}
function CityTip({ active, payload }: { active?: boolean; payload?: { payload?: CitySlice }[] }) {
  const { t, formatNumber, formatPercent } = useI18n()
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return <div className="dash-tip"><p>{row.label}</p><p>{formatNumber(row.orders)} {t('orderUnit')} · {formatPercent(row.ratio)}</p></div>
}
function LatencyTip({ active, payload, label }: { active?: boolean; payload?: { value?: number; payload?: { partial?: boolean } }[]; label?: string }) {
  const { t, formatDuration } = useI18n()
  if (!active || !payload?.length) return null
  const value = payload[0]?.value
  return <div className="dash-tip"><p>{label}{payload[0]?.payload?.partial ? ` · ${t('partialMark')}` : ''}</p><p>{value === undefined || value === null ? t('unavailable') : formatDuration(Number(value))}</p></div>
}
function RankTip({ active, payload, unit }: { active?: boolean; payload?: { payload?: { name?: string; label?: string; value?: number; orders?: number; count?: number; share?: number } }[]; unit: string }) {
  const { formatNumber, formatPercent } = useI18n()
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  const value = row.value ?? row.orders ?? row.count ?? 0
  return <div className="dash-tip"><p>{row.label || row.name}</p><p>{formatNumber(value)} {unit}{row.share !== undefined ? ` · ${formatPercent(row.share)}` : ''}</p></div>
}
