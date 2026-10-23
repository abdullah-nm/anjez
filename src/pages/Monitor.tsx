import { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { countAxisEnd, countAxisTicks } from '../../shared/chartScale.ts'
import { productById } from '../data'
import { useAuth } from '../auth'

type Preset = 'today' | '7d' | '30d' | 'custom'
type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout'

const STATUS_COLOR: Record<string, string> = {
  محفوظ: '#1d4ed8',
  'قيد التجهيز': '#d97706',
  مستلم: '#0f766e',
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

const presets: { id: Preset; label: string }[] = [
  { id: 'today', label: 'اليوم' },
  { id: '7d', label: 'آخر 7 أيام' },
  { id: '30d', label: 'آخر 30 يومًا' },
  { id: 'custom', label: 'فترة مخصصة' },
]

function formatNumber(value: number) {
  return new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(value)
}
function formatWhen(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00+03:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', month: 'short', day: 'numeric' }).format(date)
}
function formatMs(value: number | null) {
  if (value === null) return 'غير متاح'
  return value >= 1000 ? `${formatNumber(value / 1000)} ث` : `${formatNumber(value)} مللي ث`
}
function statusColor(status: string) {
  return STATUS_COLOR[status] || '#64748b'
}
function productName(id: string) {
  return productById(id)?.name || id
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
function sortNamed<T>(rows: T[], mode: SortMode, valueOf: (row: T) => number, nameOf: (row: T) => string) {
  const copy = [...rows]
  if (mode === 'name') return copy.sort((left, right) => nameOf(left).localeCompare(nameOf(right), 'ar') || valueOf(right) - valueOf(left))
  if (mode === 'asc') return copy.sort((left, right) => valueOf(left) - valueOf(right) || nameOf(left).localeCompare(nameOf(right), 'ar'))
  return copy.sort((left, right) => valueOf(right) - valueOf(left) || nameOf(left).localeCompare(nameOf(right), 'ar'))
}
function barChartHeight(count: number) {
  const rows = Math.max(count, 1)
  return Math.min(440, Math.max(112, rows * 44 + 36))
}
function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id
}
function CountLabel({ horizontal, x = 0, y = 0, width = 0, height = 0, value, viewBox }: { horizontal?: boolean; x?: number; y?: number; width?: number; height?: number; value?: number | string; viewBox?: { x?: number; y?: number; width?: number; height?: number } }) {
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
function citySlices(rows: CityRow[], total: number): CitySlice[] {
  const sorted = [...rows].filter((row) => row.orders > 0)
  const share = (orders: number) => (total ? Number((orders / total).toFixed(4)) : 0)
  if (sorted.length <= 5) return sorted.map((row) => ({ ...row, ratio: share(row.orders) }))
  const head = sorted.slice(0, 5)
  const tail = sorted.slice(5)
  const orders = tail.reduce((sum, row) => sum + row.orders, 0)
  return [
    ...head.map((row) => ({ ...row, ratio: share(row.orders) })),
    { key: '__other__', label: 'مدن أخرى', orders, ratio: share(orders), members: tail },
  ]
}
function Delta({ value }: { value: number | null }) {
  if (value === null) return null
  const amount = formatNumber(Math.abs(value * 100))
  return <p className={value >= 0 ? 'dash-delta up' : 'dash-delta down'}>{value >= 0 ? `أعلى ${amount}٪` : `أقل ${amount}٪`} عن الفترة السابقة</p>
}

export function Monitor() {
  const { user, loading } = useAuth()
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
      setError('هذه الصفحة لمديري الشركات فقط.')
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
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        if (seq !== loadSeq.current) return
        if (!response.ok) throw new Error(payload.error || 'تعذر تحميل لوحة المتابعة.')
        setReport(payload as Report)
        setError('')
        setStale(false)
      } catch (loadError) {
        if (controller.signal.aborted || seq !== loadSeq.current) return
        setStale(hadReport)
        setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل لوحة المتابعة.')
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
        const payload = (await response.json().catch(() => ({}))) as { error?: string; company?: { id: string } }
        if (!response.ok) throw new Error(payload.error || 'تعذر تحميل تفاصيل الشركة.')
        if (cancelled || payload.company?.id !== companyId) return
        setDetail(payload as CompanyDetail)
        setDetailError('')
      } catch (loadError) {
        if (!cancelled) setDetailError(loadError instanceof Error ? loadError.message : 'تعذر تحميل تفاصيل الشركة.')
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
    label: formatWhen(point.day),
  })), [board])
  const slices = useMemo(() => citySlices(board?.cities ?? [], board?.savedRequests ?? 0), [board])
  const leadOrders = board?.cities[0]?.orders ?? 0
  const occasionData = useMemo(() => {
    const rows = [...(board?.occasions ?? [])].map((item) => ({ ...item, value: occasionMode === 'orders' ? item.orders : item.generations }))
    const active = rows.filter((item) => item.value > 0)
    const total = active.reduce((sum, item) => sum + item.value, 0)
    return sortNamed(active, occasionSort, (item) => item.value, (item) => item.label).map((item) => ({ ...item, share: total ? item.value / total : 0 }))
  }, [board, occasionMode, occasionSort])
  const companyData = useMemo(() => {
    const rows = (board?.companyActivity ?? []).map((row) => ({ ...row, name: companyName(row.companyId, row.name) }))
      .filter((row) => row.orders > 0)
    const ranked = sortNamed(rows, companySort, (row) => row.orders, (row) => row.name)
    if (companySort === 'name') return ranked.slice(0, 8)
    const edge = ranked[4]?.orders
    return ranked.filter((row, index) => index < 5 || (edge !== undefined && row.orders === edge))
  }, [board, companies, companySort])
  const responseTrend = useMemo(() => (performance?.responseTrend ?? []).map((point) => ({ ...point, label: formatWhen(point.day) })), [performance])
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
    const named = sortNamed(slices.filter((item) => item.key !== '__other__'), citySort, (item) => item.orders, (item) => item.label)
    return [...named, ...other]
  }, [slices, citySort])
  const waiting = preset === 'custom' && (!from || !to)
  const orderPeak = axisEnd(trend.reduce((max, point) => Math.max(max, point.orders, point.previousOrders ?? 0), 0))
  const attention = report?.attention ?? []
  const visibleAttention = showAttention ? attention : attention.slice(0, 6)
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

  if (loading || (user && pending && !report && !error)) return <p className="dash-loading">جارٍ تحميل لوحة المتابعة…</p>
  if (!user || user.role !== 'admin') return <p className="notice err">{error || 'هذه الصفحة لمديري الشركات فقط.'}</p>

  return (
    <div className="dash">
      <header className="dash-top">
        <h1>متابعة المنصة</h1>
        <div className="dash-periods" role="group" aria-label="الفترة الزمنية">
          {presets.map((item) => (
            <button key={item.id} type="button" className={item.id === preset ? 'on' : ''} onClick={() => setPreset(item.id)}>{item.label}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="dash-dates">
            <label>من<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>إلى<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          </div>
        )}
      </header>
      <p className="dash-updated">
        {report ? `آخر تحديث ${new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.generatedAt))}` : 'لم تُحمّل البيانات'}
        {report ? ` · ${formatWhen(report.from)} – ${formatWhen(report.to)} · الرياض` : ''}
        {refreshing ? ' · جارٍ التحديث' : ''}
        {stale ? ' · انقطع التحديث، والأرقام آخر نسخة ناجحة' : ''}
      </p>
      <div className="dash-filters">
        <label>
          الشركة
          <input value={companyQuery} onChange={(event) => setCompanyQuery(event.target.value)} placeholder="ابحث بالاسم" aria-label="بحث عن شركة" />
          <select value={companyId ?? ''} onChange={(event) => { if (!event.target.value) { setCompanyId(null); setDetail(null); return } openCompany(event.target.value) }} aria-label="الشركة">
            <option value="">كل الشركات</option>
            {facetCompanies.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label>
          مدينة التسليم
          <select value={cityKey === null ? '' : (cityKey || '__blank__')} onChange={(event) => setCityKey(event.target.value === '' ? null : event.target.value === '__blank__' ? '' : event.target.value)} aria-label="مدينة التسليم">
            <option value="">كل المدن</option>
            {(report?.facets?.cities ?? []).map((row) => <option key={row.key || '__blank__'} value={row.key || '__blank__'}>{row.label}</option>)}
          </select>
        </label>
        <label>
          المناسبة
          <select value={occasionKey === undefined ? '' : occasionKey ?? '__blank__'} onChange={(event) => setOccasionKey(event.target.value === '' ? undefined : event.target.value === '__blank__' ? null : event.target.value)} aria-label="المناسبة">
            <option value="">كل المناسبات</option>
            {(report?.facets?.occasions ?? []).map((row) => <option key={row.key || '__blank__'} value={row.key || '__blank__'}>{row.label}</option>)}
          </select>
        </label>
        <button type="button" className="text-link" onClick={resetFilters}>إعادة تعيين الفلاتر</button>
      </div>
      {(companyId || cityKey !== null || occasionKey !== undefined) && (
        <p className="dash-note">
          {companyId ? 'فلتر الشركة يغيّر نشاط هذه الشركة. ' : ''}
          {cityKey !== null ? 'فلتر مدينة التسليم يغيّر طلبات الطباعة والكميات ورسوم التسليم، ولا يستبعد عمليات التوليد التي بلا عنوان تسليم. ' : ''}
          {occasionKey !== undefined ? 'فلتر المناسبة يقتصر على السجلات المرتبطة بها. ' : ''}
          إجمالي الشركات المسجّلة يبقى لكل المنصة.
        </p>
      )}
      {error && <div className="notice err" role="alert"><p>{error} تعذّر الجلب لا يُعرض كصفر.</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>إعادة المحاولة</button></div>}
      {waiting && <div className="dash-card dash-empty"><strong>اختر بداية الفترة ونهايتها</strong><p>الحد 31 يومًا. لن تُعرض أرقام قبل اكتمال التاريخين.</p></div>}
      {report && !report.board && !waiting && <div className="notice err">تعذر قراءة ملخص اللوحة، ولن يُعرض كصفر.</div>}
      {report?.board && !waiting && (
        <>
          <section className="dash-kpis" aria-label="مؤشرات">
            <Kpi icon="building" label="الشركات المسجّلة" value={formatNumber(report.board.companiesTotal)} hint="كل الشركات المسجّلة في المنصة. الرقم الصغير هو الجديدة خلال الفترة. هذا الإجمالي لا يتأثر بفلتر الشركة أو المدينة أو المناسبة." extra={`${formatNumber(report.board.companiesNew)} جديدة خلال الفترة`} delta={report.board.companiesNewChange} />
            <Kpi icon="order" label="طلبات مراجعة محفوظة" value={formatNumber(report.board.savedRequests)} hint="طلبات طباعة حُفظت للمراجعة خلال الفترة. المسودات والملغاة غير محسوبة. لا توجد حالة تأكيد طباعة منفصلة عن الحفظ." delta={report.board.savedRequestsChange} />
            <QuantityCard products={report.board.products} />
            <Kpi icon="order" label="متوسط الطلبات اليومي" value={report.board.averageDailyOrders === null ? '—' : formatNumber(report.board.averageDailyOrders)} hint="طلبات المراجعة المحفوظة مقسومة على أيام الفترة التقويمية بتوقيت الرياض، بما فيها الأيام بلا طلبات." extra={report.board.periodPartial ? `على ${formatNumber(report.board.calendarDays)} أيام · اليوم غير مكتمل` : `على ${formatNumber(report.board.calendarDays)} أيام`} delta={null} />
            <LeaderCard leaders={report.board.leaders} tied={report.board.leadersTied} onOpen={openCompany} />
          </section>

          <section className="dash-split">
            <article className="dash-card">
              <div className="dash-card-head">
                <h2 title="طلبات المراجعة المحفوظة غير الملغاة لكل يوم بتوقيت الرياض. ليست طلبات مؤكدة للطباعة.">الطلبات المحفوظة يوميًا</h2>
                <div className="dash-toggle">
                  <button type="button" className={compare ? 'on' : ''} aria-pressed={compare} onClick={() => setCompare((value) => !value)}>الفترة السابقة</button>
                </div>
              </div>
              {trend.length === 0 ? <Empty title="لا أيام في هذه الفترة" text="يظهر الخط بعد تحديد فترة صالحة." /> : (
                <div className="dash-chart line">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                      <CartesianGrid stroke="#e7eef6" vertical={false} />
                      <XAxis dataKey="label" padding={{ left: 20, right: 20 }} tick={{ fontSize: 11, fill: '#5c6d86' }} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis allowDecimals={false} allowDataOverflow width={36} padding={{ top: 18, bottom: 16 }} domain={[0, orderPeak]} ticks={axisTicks(orderPeak)} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                      <Tooltip content={<OrderTip compare={compare} />} />
                      <Line type="linear" dataKey="orders" name="هذه الفترة" stroke={ORDERS} strokeWidth={2} dot={{ r: 4, fill: ORDERS, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                      {compare && <Line type="linear" dataKey="previousOrders" name="الفترة السابقة" stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls={false} />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {trend.some((point) => point.partial) && <p className="dash-note">اليوم الجاري ما زال مفتوحًا، ورقمه غير مكتمل.</p>}
            </article>
            <article className="dash-card">
              <h2 title="حسب مدينة التسليم المحفوظة في الطلب، لا حسب مقر الشركة. ما بلا مدينة يُحسب «غير محدد» من غير تخمين.">طلبات الطباعة حسب مدينة التسليم</h2>
              <div className="city-body">
              {slices.length === 0 ? <Empty title="لا طلبات محفوظة" text="يظهر التوزيع عندما يُحفظ طلب مراجعة في الفترة." /> : slices.length === 1 ? (
                <button type="button" className="dash-summary" onClick={() => pickCity(slices[0].key)}>
                  <strong>{slices[0].label}</strong>
                  <span>{formatNumber(slices[0].orders)} طلب · {formatNumber(slices[0].ratio * 100)}٪</span>
                  <span>{slices[0].key ? 'المدينة الوحيدة في الطلبات المحفوظة' : 'لا مدينة محفوظة لهذه الطلبات'}</span>
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
                    <div className="donut-center"><strong>{formatNumber(report.board.savedRequests)}</strong><span>طلب</span></div>
                  </div>
                  <ul className="donut-key">
                    {cityView.map((item, index) => (
                      <li key={item.key || item.label}>
                        <button type="button" className={item.key !== '__other__' && item.orders === leadOrders ? 'lead' : ''} title={`${item.label} · ${formatNumber(item.orders)} · ${formatNumber(item.ratio * 100)}٪`} onClick={() => item.key === '__other__' ? setShowOtherCities((value) => !value) : pickCity(item.key)}>
                          <i style={{ background: sliceColor(item.key || item.label, index) }} />
                          <span>{item.label}{item.key !== '__other__' && item.orders === leadOrders ? ' · الأكثر طلبًا' : ''}</span>
                          <strong>{formatNumber(item.orders)}</strong>
                          <em>{formatNumber(item.ratio * 100)}٪</em>
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
              {slices.length > 1 && <div className="dash-card-foot"><SortSelect label="ترتيب المدن" value={citySort} onChange={setCitySort} /><button type="button" className="text-link" onClick={() => setShowAllCities((value) => !value)}>{showAllCities ? 'إخفاء ترتيب المدن' : 'ترتيب كل المدن'}</button></div>}
              {showAllCities && slices.length > 1 && (
                <RankChart
                  data={sortNamed(board?.cities ?? [], citySort, (row) => row.orders, (row) => row.label) as unknown as Record<string, unknown>[]}
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
                <h2>المناسبات الأكثر استخدامًا</h2>
                <div className="dash-toggle">
                  <button type="button" className={occasionMode === 'generations' ? 'on' : ''} aria-pressed={occasionMode === 'generations'} onClick={() => setOccasionMode('generations')}>توليد ناجح</button>
                  <button type="button" className={occasionMode === 'orders' ? 'on' : ''} aria-pressed={occasionMode === 'orders'} onClick={() => setOccasionMode('orders')}>طلبات محفوظة</button>
                  <SortSelect label="ترتيب المناسبات" value={occasionSort} onChange={setOccasionSort} />
                </div>
              </div>
              {occasionData.length === 0 ? <Empty title="لا مناسبات مرتبطة" text="ما بلا مناسبة محفوظة لا يُستنتج من النص." /> : (
                <RankChart
                  data={occasionData as unknown as Record<string, unknown>[]}
                  categoryKey="label"
                  valueKey="value"
                  fill={occasionMode === 'orders' ? ORDERS : GENERATION}
                  unit={occasionMode === 'orders' ? 'طلب' : 'عملية'}
                  end={occasionBarEnd}
                  onPick={(row) => { if ('key' in row) setOccasionKey((row.key as string | null) ?? null) }}
                />
              )}
            </article>
            <article className="dash-card">
              <div className="dash-card-head">
                <h2 title="الترتيب بعدد الطلبات المحفوظة، لا بكمية النسخ ولا بمحاولات التوليد.">أكثر الشركات طلبًا</h2>
                <SortSelect label="ترتيب الشركات" value={companySort} onChange={setCompanySort} />
              </div>
              {companyData.length === 0 ? <Empty title="لا طلبات شركات" text="يظهر الترتيب عندما تُحفظ طلبات مراجعة." /> : (
                <RankChart
                  data={companyData as unknown as Record<string, unknown>[]}
                  categoryKey="name"
                  valueKey="orders"
                  fill={ORDERS}
                  unit="طلب"
                  end={orderBarEnd}
                  onPick={(row) => { if (row.companyId) openCompany(String(row.companyId)) }}
                />
              )}
            </article>
          </section>

          <section className="dash-card" id="generation">
            <h2>أداء التوليد</h2>
            {report.focus?.citySkipsGenerations && <p className="dash-note">فلتر مدينة التسليم لا يغيّر هذا القسم، لأن عمليات التوليد لا تحمل عنوان تسليم.</p>}
            {report.focus?.company && <p className="dash-note">الأرقام هنا لنشاط الشركة المحددة.</p>}
            {report.focus?.occasion && <p className="dash-note">الأرقام هنا للعمليات المرتبطة بالمناسبة المحددة.</p>}
            {!performance ? <div className="notice err">تعذر قراءة أداء التوليد، ولن يُعرض كصفر.</div> : (
              <>
                <div className="dash-metrics">
                  <Metric label="عمليات بدأت" value={formatNumber(performance.started)} hint="كل عملية توليد تُحسب مرة واحدة. إعادة استدعاء المزود ليست عملية جديدة." />
                  <Metric label="ناجحة" value={formatNumber(performance.succeeded)} hint="اكتملت بنتيجة صالحة. نجاح HTTP وحده لا يكفي." />
                  <Metric label="فاشلة" value={formatNumber(performance.failed)} hint="عمليات انتهت بالفشل، لا محاولات المزود داخلها." />
                  <Metric label="جارية" value={formatNumber(performance.inProgress)} hint="عمليات ما زالت في الانتظار أو التنفيذ. لا تدخل في نسبة النجاح، والمهلة المنتهية تُعرض مع الفشل لا هنا." extra={performance.timedOut ? `مهلة منتهية ${formatNumber(performance.timedOut)}` : undefined} />
                  <Metric label="نسبة النجاح" value={performance.successRate === null ? 'غير متاح' : `${formatNumber(performance.successRate * 100)}٪`} hint="الناجحة مقسومة على العمليات المنتهية فقط. الجارية غير داخلة، واستجابة HTTP 200 ليست نجاح توليد." />
                  <Metric label="استدعاءات المزود" value={formatNumber(performance.providerCalls)} hint="محاولات داخل العمليات، وليست عمليات توليد إضافية." />
                </div>
                <div className="dash-metrics">
                  <Metric label="متوسط زمن استجابة API" value={formatMs(performance.avgApiMs)} hint="من بداية العملية حتى تسجيل الرد، للعمليات المنتهية." extra={`P95 ${formatMs(performance.p95ApiMs)}`} />
                  {performance.sameMeasurement && performance.avgGenerationMs === performance.avgApiMs ? null : (
                    <Metric label="متوسط اكتمال التوليد الناجح" value={formatMs(performance.avgGenerationMs)} hint={performance.sameMeasurement ? 'نفس الساعة المسجّلة لزمن الاستجابة، محسوبة على العمليات الناجحة فقط.' : 'مدة العمليات التي أنتجت نتيجة صالحة فقط.'} />
                  )}
                </div>
                {performance.sameMeasurement && <p className="dash-note">{performance.avgGenerationMs === performance.avgApiMs ? 'زمن الاستجابة ومدة اكتمال التوليد متطابقان في التنفيذ الحالي، ولذلك يُعرضان كقياس واحد.' : 'زمن الاستجابة ومدة الاكتمال يُسجَّلان بنفس الساعة. يختلف الرقمان لأن متوسط الاكتمال يقتصر على العمليات الناجحة.'}</p>}
                <div className="dash-pair">
                  <article>
                    <h2>{performance.sameMeasurement ? 'زمن الاستجابة ومدة الاكتمال' : 'زمن استجابة API'}</h2>
                    {responseTrend.length === 0 ? <Empty title="لا مدد مسجّلة" text="الأيام بلا عملية منتهية لا تُرسم بصفر." /> : (
                      <div className="dash-chart">
                        <ResponsiveContainer width="100%" height={220}>
                          <LineChart data={responseTrend} margin={{ top: 16, right: 20, left: 8, bottom: 8 }}>
                            <CartesianGrid stroke="#e7eef6" vertical={false} />
                            <XAxis dataKey="label" padding={{ left: 16, right: 16 }} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                            <YAxis width={46} padding={{ top: 16, bottom: 12 }} allowDecimals={false} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                            <Tooltip content={<LatencyTip />} />
                            <Line type="linear" dataKey="avgMs" name="متوسط مللي ث" stroke={GENERATION} strokeWidth={2} dot={false} connectNulls={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </article>
                  <article>
                    <h2>نجاح وفشل التوليد</h2>
                    {performance.outcomes.length === 0 ? <Empty title="لا عمليات منتهية" text="الجارية لا تُرسم هنا." /> : performance.outcomes.length === 1 ? (
                      <div className="dash-summary"><strong>{performance.outcomes[0].label}</strong><span>{formatNumber(performance.outcomes[0].count)} عملية · الحالة الوحيدة المنتهية</span></div>
                    ) : (
                      <div className="dash-chart">
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={performance.outcomes} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke="#e7eef6" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#10203a' }} />
                            <YAxis allowDecimals={false} allowDataOverflow width={32} domain={[0, countAxisEnd(Math.max(...performance.outcomes.map((item) => item.count)))]} ticks={countAxisTicks(countAxisEnd(Math.max(...performance.outcomes.map((item) => item.count))))} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                            <Tooltip content={<RankTip unit="عملية" />} />
                            <Bar dataKey="count" name="عمليات" radius={[6, 6, 0, 0]} maxBarSize={56} isAnimationActive={false} label={<CountLabel />}>
                              {performance.outcomes.map((item) => <Cell key={item.status} fill={item.status === 'succeeded' ? GENERATION : item.status === 'timeout' ? '#94a3b8' : FAILED} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </article>
                </div>
                {performance.failures.length === 0 ? <p className="dash-note">لا أسباب فشل مسجّلة في هذه الفترة.</p> : (
                  <ul className="dash-follow">
                    {performance.failures.map((item) => (
                      <li key={item.code}>
                        <button type="button" onClick={() => setFailureCode((current) => current === item.code ? null : item.code)}>
                          <strong>{item.label}</strong>
                          <span>{formatNumber(item.count)} عمليات</span>
                        </button>
                        {failureCode === item.code && (
                          failedJobs.length === 0 ? <p className="dash-note">لا تفاصيل إضافية لهذه العمليات.</p> : (
                            <ul className="dash-sub">
                              {failedJobs.slice(0, 6).map((job) => (
                                <li key={job.id}>
                                  <button type="button" className="text-link" onClick={() => job.companyId && openCompany(job.companyId)}>{job.companyName || companyName(job.companyId)} · {job.id} · {formatWhen(job.requestedAt)}</button>
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
              <h2>ما يحتاج تدخلًا</h2>
              {attention.length === 0 ? <Empty title="لا متابعة مفتوحة" text="تظهر الطلبات المتجاوزة لتاريخ التسليم، والتوليد الفاشل أو المنتهي مهلته، وأخطاء المزود المتكررة." /> : (
                <ul className="dash-follow">
                  {visibleAttention.map((item) => (
                    <li key={`${item.kind}-${item.id}`} className="follow-row">
                      <button type="button" onClick={() => item.companyId && openCompany(item.companyId)}>
                        <strong>{item.companyName}</strong>
                        <span>{item.kind === 'order' ? 'طلب' : item.kind === 'generation' ? 'توليد' : 'مزود'} · {item.reason}</span>
                      </button>
                      {item.subject.length > 16 ? <ShortId id={item.subject} /> : <span className="follow-id">{item.subject}</span>}
                      <time>{formatWhen(item.at)}</time>
                    </li>
                  ))}
                </ul>
              )}
              {attention.length > 6 && <button type="button" className="text-link" onClick={() => setShowAttention((value) => !value)}>{showAttention ? 'عرض المختصر' : `عرض الكل (${formatNumber(attention.length)})`}</button>}
            </article>
            <article className="dash-card" id="records">
              <div className="dash-card-head">
                <h2>{filtering ? 'الطلبات المطابقة' : 'أحدث الطلبات'}</h2>
                {filtering && <button type="button" className="text-link" onClick={() => { setOrderStatus('all'); setCompanyId(null); setCityKey(null); setOccasionKey(undefined) }}>إلغاء التصفية</button>}
              </div>
              <StatusSummary statuses={report.board.statuses} onPick={setOrderStatus} />
              {filteredOrders.length === 0 ? <Empty title="لا طلبات" text="التصفية لا تغيّر أرقام المؤشرات." /> : (
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <thead><tr><th>الشركة</th><th>المنتج</th><th>الكمية</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead>
                    <tbody>
                      {filteredOrders.slice(0, 8).map((order) => (
                        <tr key={order.id}>
                          <td>{order.companyName || companyName(order.companyId)}</td>
                          <td>{productName(order.productId)}</td>
                          <td>{formatNumber(order.quantity)}</td>
                          <td><span className="status-cell"><i className="status-dot" style={{ background: statusColor(order.status) }} />{order.status}</span></td>
                          <td>{formatWhen(order.createdAt)}</td>
                          <td>{order.companyId && <button type="button" onClick={() => openCompany(order.companyId!)}>التفاصيل</button>}</td>
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
                <button type="button" className="text-link" onClick={() => setCompanyId(null)}>إغلاق</button>
              </div>
              {detailError && <p className="notice err">{detailError} تعذّر الجلب لا يُعرض كصفر.</p>}
              {!detail && !detailError && <p>جارٍ تحميل التفاصيل…</p>}
              {detail?.company.id === companyId && (
                <div className="company-facts">
                  <p>{detail.company.email} · {formatWhen(detail.company.createdAt)} · {detail.company.status}</p>
                  <p>منذ التسجيل: {formatNumber(detail.company.orders)} طلبات · {formatNumber(detail.company.designs)} تصاميم · {formatNumber(detail.company.generations)} عمليات توليد</p>
                  {detail.orders.length === 0 ? <p className="dash-note">لا طلبات مسجّلة لهذه الشركة.</p> : detail.orders.map((order) => <p key={order.id}>{order.id} · {productName(order.productId)} · {order.status} · كمية {formatNumber(order.quantity)} · {formatWhen(order.createdAt)}</p>)}
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
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as SortMode)}>
      <option value="desc">الأعلى عددًا</option>
      <option value="asc">الأقل عددًا</option>
      <option value="name">الاسم</option>
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
  const peak = end ?? countAxisEnd(data.reduce((max, row) => Math.max(max, Number(row[valueKey]) || 0), 0))
  return (
    <div className="dash-chart">
      <ResponsiveContainer width="100%" height={barChartHeight(data.length)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 42, bottom: 4 }} barCategoryGap={8}>
          <XAxis type="number" reversed allowDecimals={false} allowDataOverflow domain={[0, peak]} ticks={countAxisTicks(peak)} tick={{ fontSize: 11, fill: '#5c6d86' }} />
          <YAxis type="category" dataKey={categoryKey} orientation="right" width={108} interval={0} tick={{ fontSize: 12, fill: '#10203a' }} tickFormatter={(value) => shortLabel(String(value))} />
          {cityTip ? <Tooltip content={<CityTip />} /> : <Tooltip content={<RankTip unit={unit || ''} />} />}
          <Bar dataKey={valueKey} fill={fill} radius={[6, 0, 0, 6]} maxBarSize={20} isAnimationActive={false} label={<CountLabel horizontal />} onClick={(entry) => {
            const row = (entry as { payload?: Record<string, unknown> }).payload
            if (row) onPick?.(row)
          }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
function ShortId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="id-chip"
      title={copied ? 'تم النسخ' : id}
      onClick={() => {
        void navigator.clipboard?.writeText(id).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? 'تم النسخ' : shortId(id)}
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
  const [open, setOpen] = useState(false)
  const hint = products.length > 1
    ? 'كل منتج مستقل. النظام لا يخزّن وحدة القياس، لذلك لا تُجمع الكميات عبر المنتجات. هذه كميات مطلوبة لا مطبوعة.'
    : 'كمية هذا المنتج في الطلبات المحفوظة. ليست كمية مطبوعة، ولا تُجمع مع منتج آخر لأن الوحدة غير مخزّنة.'
  const listed = products.map((item) => `${productName(item.productId)} ${formatNumber(item.quantity)}`).join(' · ')
  return (
    <article className="dash-kpi" title={products.length ? `${hint} ${listed}` : 'لا كميات مسجّلة. لا يُسجَّل اكتمال الطباعة، لذلك هذه نسخ مطلوبة لا مطبوعة.'}>
      <span className="kpi-icon order" aria-hidden="true" />
      <p className="kpi-label">النسخ المطلوبة للطباعة</p>
      {products.length > 1 ? (
        <div className="kpi-value qty-inline" title={listed}>
          {products.slice(0, 2).map((item) => <span key={item.productId}>{productName(item.productId)} <b>{formatNumber(item.quantity)}</b></span>)}
        </div>
      ) : <strong className="kpi-value">{products.length === 1 ? formatNumber(products[0].quantity) : '—'}</strong>}
      <div className="kpi-foot">
        {products.length === 1 && <small>{productName(products[0].productId)}</small>}
        {products.length > 2 && <button type="button" className="text-link" onClick={() => setOpen((value) => !value)}>{open ? 'إخفاء الكميات' : 'كل الكميات'}</button>}
        {products.length === 2 && <small>كل منتج على حدة</small>}
      </div>
      {open && products.length > 1 && (
        <div className="kpi-pop" role="dialog" aria-label="الكميات حسب المنتج">
          {products.map((item) => <p key={item.productId}><span>{productName(item.productId)}</span><strong>{formatNumber(item.quantity)}</strong></p>)}
        </div>
      )}
    </article>
  )
}
function LeaderCard({ leaders, tied, onOpen }: { leaders: Leader[]; tied: boolean; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const count = leaders[0]?.orders ?? 0
  const names = leaders.map((row) => row.name).join('، ')
  return (
    <article className="dash-kpi" title={tied ? `تعادل بين ${names}. الترتيب بعدد الطلبات المحفوظة لا بالكمية ولا بالتوليد.` : 'الشركة صاحبة أكبر عدد من الطلبات المحفوظة خلال الفترة. الترتيب بعدد الطلبات لا بالكمية ولا بالتوليد.'}>
      <span className="kpi-icon building" aria-hidden="true" />
      <p className="kpi-label">الشركة الأكثر طلبًا</p>
      <strong className={leaders.length === 1 ? 'kpi-value name' : 'kpi-value'} title={leaders.length === 1 ? leaders[0].name : names || undefined}>
        {leaders.length === 0 ? '—' : tied ? 'تعادل' : leaders[0].name}
      </strong>
      <div className="kpi-foot">
        {leaders.length > 0 && <small>{formatNumber(count)} طلبات محفوظة{tied ? ` · ${formatNumber(leaders.length)} شركات` : ''}</small>}
        {leaders.length === 1 && <button type="button" className="text-link" onClick={() => onOpen(leaders[0].companyId)}>التفاصيل</button>}
        {tied && <button type="button" className="text-link" onClick={() => setOpen((value) => !value)}>{open ? 'إخفاء' : 'عرض التعادل'}</button>}
      </div>
      {open && tied && (
        <div className="kpi-pop" role="dialog" aria-label="الشركات المتعادلة">
          {leaders.map((row) => <button key={row.companyId} type="button" onClick={() => onOpen(row.companyId)}>{row.name}</button>)}
        </div>
      )}
    </article>
  )
}
function StatusSummary({ statuses, onPick }: { statuses: { status: string; count: number; ratio: number }[]; onPick: (status: string) => void }) {
  if (statuses.length === 0) return null
  if (statuses.length === 1) {
    return <button type="button" className="dash-summary" onClick={() => onPick(statuses[0].status)}><strong>{statuses[0].status}</strong><span>{formatNumber(statuses[0].count)} طلب · الحالة المسجّلة الوحيدة</span></button>
  }
  return (
    <>
      <div className="status-bar" aria-hidden="true">{statuses.map((item) => <span key={item.status} style={{ flex: item.count, background: statusColor(item.status) }} />)}</div>
      <ul className="donut-key">
        {statuses.map((item) => (
          <li key={item.status}>
            <button type="button" onClick={() => onPick(item.status)}>
              <i style={{ background: statusColor(item.status) }} />
              <span>{item.status}</span>
              <strong>{formatNumber(item.count)}</strong>
              <em>{formatNumber(item.ratio * 100)}٪</em>
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
function OrderTip({ active, payload, label, compare }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: { partial?: boolean; previousDay?: string | null } }[]; label?: string; compare: boolean }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  return (
    <div className="dash-tip">
      <p>{label}{row?.partial ? ' · غير مكتمل' : ''}</p>
      {payload.filter((item) => compare || item.name !== 'الفترة السابقة').map((item) => (
        <p key={item.name}><i style={{ background: item.color }} />{item.name}{item.name === 'الفترة السابقة' && row?.previousDay ? ` (${formatWhen(row.previousDay)})` : ''}: {item.value === undefined || item.value === null ? '—' : formatNumber(Number(item.value) || 0)}</p>
      ))}
    </div>
  )
}
function CityTip({ active, payload }: { active?: boolean; payload?: { payload?: CitySlice }[] }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return <div className="dash-tip"><p>{row.label}</p><p>{formatNumber(row.orders)} طلب · {formatNumber(row.ratio * 100)}٪</p></div>
}
function LatencyTip({ active, payload, label }: { active?: boolean; payload?: { value?: number; payload?: { partial?: boolean } }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const value = payload[0]?.value
  return <div className="dash-tip"><p>{label}{payload[0]?.payload?.partial ? ' · غير مكتمل' : ''}</p><p>{value === undefined || value === null ? 'غير متاح' : formatMs(Number(value))}</p></div>
}
function RankTip({ active, payload, unit }: { active?: boolean; payload?: { payload?: { name?: string; label?: string; value?: number; orders?: number; count?: number; share?: number } }[]; unit: string }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  const value = row.value ?? row.orders ?? row.count ?? 0
  return <div className="dash-tip"><p>{row.label || row.name}</p><p>{formatNumber(value)} {unit}{row.share !== undefined ? ` · ${formatNumber(row.share * 100)}٪` : ''}</p></div>
}
