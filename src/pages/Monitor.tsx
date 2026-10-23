import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
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

type SeriesPoint = { at: string; succeeded: number; orders?: number }
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
type CompanyRow = {
  id: string
  name: string
  email: string
  createdAt: string
  status: string
  orders: number
  designs: number
  generations: number
}
type OrderRow = {
  id: string
  companyId?: string
  companyName?: string
  productId: string
  status: string
  quantity: number
  createdAt: string
  occasionKey?: string | null
}
type Board = {
  companiesTotal: number
  companiesNew: number
  companiesNewChange: number | null
  images: number
  imagesChange: number | null
  orders: number
  completed: number
  completedChange: number | null
  incomplete: number
  incompleteChange: number | null
  incompleteStatuses: string[]
  statuses: { status: string; count: number; ratio: number }[]
  orderDays: { day: string; statuses: { status: string; count: number }[] }[]
  products: { productId: string; orders: number; quantity: number; averageQuantity: number | null }[]
  occasions: { key: string | null; label: string; generations: number; orders: number }[]
  generationsSucceeded: number
  generationsPerCompany: number | null
  avgGenerationMs: number | null
}
type Report = {
  from: string
  to: string
  generatedAt: string
  summary: { ordersChange: number | null; successRate: number | null; decided: number }
  journey: { succeeded: number; failed: number; timedOut: number; avgGenerationMs: number | null; series: SeriesPoint[]; failures: { code: string; count: number }[] }
  orders: { recent: OrderRow[] }
  api: { calls: number; failedCalls: number; errorRate: number | null; avgMs: number | null; p95Ms: number | null; failures: { code: string; count: number }[] }
  companies?: { total: number; newInPeriod: number; rows: CompanyRow[] }
  board?: Board
  recent: Operation[]
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

const failureLabel: Record<string, string> = {
  QUOTA: 'تجاوز الحصة',
  TIMEOUT: 'انتهت المهلة',
  INVALID_OUTPUT: 'نتيجة غير صالحة',
  FAILED: 'فشل التوليد',
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 1 }).format(value)
}
function formatWhen(value: string) {
  const date = new Date(value)
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
function Delta({ value }: { value: number | null }) {
  if (value === null) return null
  const amount = formatNumber(Math.abs(value * 100))
  return <p className={value >= 0 ? 'dash-delta up' : 'dash-delta down'}>{value >= 0 ? `أعلى ${amount}٪` : `أقل ${amount}٪`} عن الفترة السابقة</p>
}

export function Monitor() {
  const { user, loading, logout } = useAuth()
  const [preset, setPreset] = useState<Preset>('7d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [stale, setStale] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [showGenerations, setShowGenerations] = useState(true)
  const [showOrders, setShowOrders] = useState(true)
  const [productMode, setProductMode] = useState<'orders' | 'quantity'>('orders')
  const [occasionMode, setOccasionMode] = useState<'generations' | 'orders'>('orders')
  const [orderStatus, setOrderStatus] = useState('all')
  const [productId, setProductId] = useState<string | null>(null)
  const [occasionKey, setOccasionKey] = useState<string | null | undefined>(undefined)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [showAllCompanies, setShowAllCompanies] = useState(false)
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
    let cancelled = false
    const hadReport = Boolean(report)
    if (!report) setPending(true)
    else setRefreshing(true)
    const params = new URLSearchParams({ preset })
    if (preset === 'custom') {
      params.set('from', from)
      params.set('to', to)
    }
    void (async () => {
      try {
        const response = await fetch(`/api/observability/dashboard?${params}`, { credentials: 'include', cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        if (!response.ok) throw new Error(payload.error || 'تعذر تحميل لوحة المتابعة.')
        if (!cancelled) {
          setReport(payload as Report)
          setError('')
          setStale(false)
        }
      } catch (loadError) {
        if (!cancelled) {
          setStale(hadReport)
          setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل لوحة المتابعة.')
        }
      } finally {
        if (!cancelled) {
          setPending(false)
          setRefreshing(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [user, preset, from, to, attempt])

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
  const companies = report?.companies?.rows ?? []
  const periodOrders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const order of report?.orders.recent ?? []) {
      if (!order.companyId) continue
      counts.set(order.companyId, (counts.get(order.companyId) || 0) + 1)
    }
    return counts
  }, [report])
  const visibleCompanies = showAllCompanies ? companies : companies.slice(0, 5)
  const areaData = (report?.journey.series ?? []).map((point) => ({ label: formatWhen(point.at), succeeded: point.succeeded, orders: point.orders || 0 }))
  const dayData = (board?.orderDays ?? []).map((day) => {
    const row: Record<string, string | number> = { day: formatWhen(`${day.day}T00:00:00+03:00`) }
    for (const status of board?.statuses ?? []) row[status.status] = 0
    for (const status of day.statuses) row[status.status] = status.count
    return row
  })
  const productData = (board?.products ?? []).map((item) => ({
    ...item,
    name: productById(item.productId)?.name || item.productId,
    value: productMode === 'orders' ? item.orders : item.quantity,
    share: productMode === 'orders' && board?.orders ? item.orders / board.orders : null,
  }))
  const occasionData = [...(board?.occasions ?? [])]
    .sort((left, right) => (occasionMode === 'orders' ? right.orders - left.orders : right.generations - left.generations))
    .map((item) => ({ ...item, value: occasionMode === 'orders' ? item.orders : item.generations }))
  const filteredOrders = (report?.orders.recent ?? []).filter((order) => {
    if (orderStatus !== 'all' && order.status !== orderStatus) return false
    if (productId && order.productId !== productId) return false
    if (companyId && order.companyId !== companyId) return false
    if (occasionKey !== undefined && (order.occasionKey ?? null) !== occasionKey) return false
    return true
  })
  const filteredJobs = (report?.recent ?? []).filter((job) => {
    if (companyId && job.companyId !== companyId) return false
    if (occasionKey !== undefined && (job.occasionKey ?? null) !== occasionKey) return false
    return true
  })
  const waiting = preset === 'custom' && (!from || !to)
  const hasActivity = Boolean(board && (board.generationsSucceeded > 0 || board.orders > 0))

  if (loading || (user && pending && !report && !error)) return <p className="dash-loading">جارٍ تحميل لوحة المتابعة…</p>
  if (!user || user.role !== 'admin') return <p className="notice err">{error || 'هذه الصفحة لمديري الشركات فقط.'}</p>

  return (
    <div className="dash">
      <header className="dash-top">
        <div>
          <strong>{user.name}</strong>
          <span>{user.companyName}</span>
        </div>
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
        <button type="button" className="dash-logout" onClick={() => void logout()}>خروج</button>
      </header>
      <p className="dash-updated">
        {report ? `آخر تحديث ${new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.generatedAt))}` : 'لم تُحمّل البيانات'}
        {report ? ` · ${formatWhen(report.from)} – ${formatWhen(report.to)} · الرياض` : ''}
        {refreshing ? ' · جارٍ التحديث' : ''}
        {stale ? ' · انقطع التحديث، والأرقام آخر نسخة ناجحة' : ''}
      </p>
      {error && <div className="notice err" role="alert"><p>{error} تعذّر الجلب لا يُعرض كصفر.</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>إعادة المحاولة</button></div>}
      {waiting && <div className="dash-card dash-empty"><strong>اختر بداية الفترة ونهايتها</strong><p>الحد 31 يومًا. لن تُعرض أرقام قبل اكتمال التاريخين.</p></div>}
      {report && !report.board && !waiting && <div className="notice err">تعذر قراءة ملخص اللوحة، ولن يُعرض كصفر.</div>}
      {report?.board && !waiting && (
        <>
          <section className="dash-kpis" aria-label="مؤشرات">
            <Kpi icon="building" label="الشركات المسجّلة" value={formatNumber(report.board.companiesTotal)} note={`إجمالي طوال الوقت · ${formatNumber(report.board.companiesNew)} جديدة خلال الفترة`} delta={report.board.companiesNewChange} />
            <Kpi icon="image" label="الصور الناتجة" value={formatNumber(report.board.images)} note="صورة نقطية من توليد ناجح. القالب SVG والمحاولة لا يُحسبان." delta={report.board.imagesChange} />
            <Kpi icon="order" label="طلبات الطباعة" value={formatNumber(report.board.orders)} note="طلب واحد لكل سجل، وليس عملية توليد." delta={report.summary.ordersChange} />
            <Kpi icon="done" label="طلبات مكتملة" value={formatNumber(report.board.completed)} note="الحالة المسجّلة: مستلم." delta={report.board.completedChange} />
            <Kpi icon="open" label="طلبات غير مكتملة" value={formatNumber(report.board.incomplete)} note="محفوظ وقيد التجهيز. الملغى خارج هذا العدد." delta={report.board.incompleteChange} />
          </section>

          <section className="dash-split">
            <article className="dash-card">
              <div className="dash-card-head">
                <h2>نشاط التوليد والطباعة</h2>
                <div className="dash-toggle">
                  <button type="button" className={showGenerations ? 'on' : ''} onClick={() => setShowGenerations((value) => !value)}>توليد ناجح</button>
                  <button type="button" className={showOrders ? 'on' : ''} onClick={() => setShowOrders((value) => !value)}>طلبات الطباعة</button>
                </div>
              </div>
              {!hasActivity ? <Empty title="لا نشاط في هذه الفترة" text="سيظهر التطور عند نجاح توليد أو تسجيل طلب." /> : (
                <div className="dash-chart">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={areaData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#e7eef6" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5c6d86' }} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis allowDecimals={false} width={36} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                      <Tooltip content={<ArabicTip unit="سجل" />} />
                      {showGenerations && <Area type="monotone" dataKey="succeeded" name="توليد ناجح" stroke={GENERATION} fill={GENERATION} fillOpacity={0.16} strokeWidth={2} />}
                      {showOrders && <Area type="monotone" dataKey="orders" name="طلبات الطباعة" stroke={ORDERS} fill={ORDERS} fillOpacity={0.1} strokeWidth={2} />}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
            <article className="dash-card">
              <h2>حالات طلبات الطباعة</h2>
              {report.board.orders === 0 ? <Empty title="لا طلبات في هذه الفترة" text="يظهر التوزيع عندما تُسجّل طلبات طباعة." /> : (
                <div className="dash-donut">
                  <div className="dash-chart donut-chart">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={report.board.statuses} dataKey="count" nameKey="status" innerRadius={62} outerRadius={84} paddingAngle={2} stroke="#fff" onClick={(entry) => {
                          const row = entry as { payload?: { status?: string } }
                          if (row.payload?.status) setOrderStatus(row.payload.status)
                        }}>
                          {report.board.statuses.map((item) => <Cell key={item.status} fill={statusColor(item.status)} />)}
                        </Pie>
                        <Tooltip content={<ArabicTip unit="طلب" />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="donut-center"><strong>{formatNumber(report.board.orders)}</strong><span>طلب</span></div>
                  </div>
                  <ul className="donut-key">
                    {report.board.statuses.map((item) => (
                      <li key={item.status}>
                        <button type="button" onClick={() => setOrderStatus(item.status)}>
                          <i style={{ background: statusColor(item.status) }} />
                          <span>{item.status}</span>
                          <strong>{formatNumber(item.count)}</strong>
                          <em>{formatNumber(item.ratio * 100)}٪</em>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          </section>

          <section className="dash-triple">
            <article className="dash-card">
              <h2>الطلبات حسب الحالة واليوم</h2>
              {dayData.length === 0 ? <Empty title="لا أيام فيها طلبات" text="الأعمدة تظهر فقط للأيام التي سُجّل فيها طلب." /> : (
                <div className="dash-chart">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={dayData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#e7eef6" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#5c6d86' }} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis allowDecimals={false} width={32} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                      <Tooltip content={<ArabicTip unit="طلب" />} />
                      {report.board.statuses.map((item) => (
                        <Bar key={item.status} dataKey={item.status} name={item.status} stackId="orders" fill={statusColor(item.status)} onClick={() => setOrderStatus(item.status)} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
            <article className="dash-card">
              <div className="dash-card-head">
                <h2>أحدث الشركات</h2>
                {companies.length > 5 && <button type="button" className="text-link" onClick={() => setShowAllCompanies((value) => !value)}>{showAllCompanies ? 'أحدث خمس' : 'القائمة الكاملة'}</button>}
              </div>
              {visibleCompanies.length === 0 ? <Empty title="لا شركات مسجّلة" text="ستظهر الشركة هنا بعد إنشاء حسابها." /> : (
                <table className="dash-table">
                  <thead><tr><th>الشركة</th><th>التسجيل</th><th>طلبات الفترة</th><th></th></tr></thead>
                  <tbody>
                    {visibleCompanies.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}<small>{row.email}</small></td>
                        <td>{formatWhen(row.createdAt)}</td>
                        <td>{formatNumber(periodOrders.get(row.id) || 0)}</td>
                        <td><button type="button" onClick={() => { setCompanyId(row.id); setDetail((current) => current?.company.id === row.id ? current : null) }}>التفاصيل</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
            <article className="dash-card">
              <div className="dash-card-head">
                <h2>الطلبات حسب المنتج</h2>
                <div className="dash-toggle">
                  <button type="button" className={productMode === 'orders' ? 'on' : ''} onClick={() => setProductMode('orders')}>عدد الطلبات</button>
                  <button type="button" className={productMode === 'quantity' ? 'on' : ''} onClick={() => setProductMode('quantity')}>الكميات</button>
                </div>
              </div>
              <p className="dash-note">{productMode === 'orders' ? 'كل عمود طلب طباعة. النسبة من طلبات الفترة.' : 'الكمية رقم مسجّل لكل منتج وحده، بلا جمع بين المنتجات لأن الوحدة تختلف.'}</p>
              {productData.length === 0 ? <Empty title="لا منتجات مطلوبة" text="يظهر التوزيع من المنتجات المسجّلة في الطلبات." /> : (
                <div className="dash-chart">
                  <ResponsiveContainer width="100%" height={Math.max(220, productData.length * 42)}>
                    <BarChart data={productData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                      <XAxis type="number" reversed allowDecimals={false} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                      <YAxis type="category" dataKey="name" orientation="right" width={108} tick={{ fontSize: 11, fill: '#10203a' }} />
                      <Tooltip content={<ProductTip mode={productMode} />} />
                      <Bar dataKey="value" name={productMode === 'orders' ? 'طلبات' : 'كمية'} fill={ORDERS} radius={[0, 6, 6, 0]} onClick={(entry) => {
                        const id = (entry as { payload?: { productId?: string } }).payload?.productId
                        if (id) setProductId(id)
                      }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <h2>المناسبات الأكثر استخدامًا</h2>
              <div className="dash-toggle">
                <button type="button" className={occasionMode === 'generations' ? 'on' : ''} onClick={() => setOccasionMode('generations')}>توليد ناجح</button>
                <button type="button" className={occasionMode === 'orders' ? 'on' : ''} onClick={() => setOccasionMode('orders')}>طلبات الطباعة</button>
              </div>
            </div>
            <p className="dash-note">التصنيف من المناسبة المحفوظة في التصميم المرتبط. ما بلا مناسبة محفوظة يظهر «غير محدد».</p>
            {occasionData.every((item) => item.value === 0) ? <Empty title="لا مناسبات مرتبطة في هذه الفترة" text="لن تُستنتج المناسبة من نص التصميم." /> : (
              <div className="dash-chart">
                <ResponsiveContainer width="100%" height={Math.max(220, occasionData.length * 40)}>
                  <BarChart data={occasionData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                    <XAxis type="number" reversed allowDecimals={false} tick={{ fontSize: 11, fill: '#5c6d86' }} />
                    <YAxis type="category" dataKey="label" orientation="right" width={120} tick={{ fontSize: 11, fill: '#10203a' }} />
                    <Tooltip content={<ArabicTip unit={occasionMode === 'orders' ? 'طلب' : 'عملية'} />} />
                    <Bar dataKey="value" name={occasionMode === 'orders' ? 'طلبات' : 'توليد ناجح'} fill={occasionMode === 'orders' ? ORDERS : GENERATION} radius={[0, 6, 6, 0]} onClick={(entry) => {
                      const row = (entry as { payload?: { key?: string | null } }).payload
                      if (row && 'key' in row) setOccasionKey(row.key ?? null)
                    }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="dash-stats" aria-label="متوسطات">
            <Stat label="متوسط التوليد الناجح لكل شركة ولّدت" value={report.board.generationsPerCompany === null ? 'غير متاح' : formatNumber(report.board.generationsPerCompany)} />
            <Stat label="متوسط مدة التوليد الناجح" value={formatMs(report.board.avgGenerationMs)} />
            <Stat label="نسبة نجاح التوليد" value={report.summary.successRate === null ? 'غير متاح' : `${formatNumber(report.summary.successRate * 100)}٪`} />
            <Stat label="عمليات التوليد الناجحة" value={formatNumber(report.board.generationsSucceeded)} />
            <div>
              <span>الكميات المطلوبة حسب المنتج</span>
              {report.board.products.length === 0 ? <strong>لا كميات</strong> : report.board.products.map((item) => (
                <strong key={item.productId}>{productById(item.productId)?.name || item.productId}: {formatNumber(item.quantity)} · متوسط {item.averageQuantity === null ? '—' : formatNumber(item.averageQuantity)}</strong>
              ))}
            </div>
          </section>

          <section className="dash-card" id="records">
            <div className="dash-card-head">
              <h2>السجلات المطابقة</h2>
              {(orderStatus !== 'all' || productId || companyId || occasionKey !== undefined) && (
                <button type="button" className="text-link" onClick={() => { setOrderStatus('all'); setProductId(null); setCompanyId(null); setOccasionKey(undefined) }}>إلغاء التصفية</button>
              )}
            </div>
            {filteredOrders.length === 0 ? <Empty title="لا طلبات مطابقة" text="التصفية لا تغيّر أرقام المؤشرات." /> : (
              <table className="dash-table">
                <thead><tr><th>الطلب</th><th>الشركة</th><th>المنتج</th><th>الحالة</th><th>الكمية</th><th>التاريخ</th></tr></thead>
                <tbody>
                  {filteredOrders.slice(0, 8).map((order) => (
                    <tr key={order.id}>
                      <td>{order.id}</td>
                      <td>{order.companyName || '—'}</td>
                      <td>{productById(order.productId)?.name || order.productId}</td>
                      <td><i className="status-dot" style={{ background: statusColor(order.status) }} />{order.status}</td>
                      <td>{formatNumber(order.quantity)}</td>
                      <td>{formatWhen(order.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {occasionKey !== undefined && (
              filteredJobs.length === 0 ? <p className="dash-note">لا عمليات توليد مرتبطة بهذه المناسبة.</p> : (
                <ul className="dash-jobs">
                  {filteredJobs.slice(0, 6).map((job) => <li key={job.id}>{job.companyName || job.userName} · {job.status === 'succeeded' ? 'تم التوليد' : job.status} · {formatWhen(job.requestedAt)}{job.providerAttempts > 1 ? ` · ${formatNumber(job.providerAttempts)} محاولات` : ''}</li>)}
                </ul>
              )
            )}
          </section>

          {companyId && (
            <section className="dash-card" id="company-detail">
              <div className="dash-card-head">
                <h2>{detail?.company.name || companies.find((item) => item.id === companyId)?.name || 'الشركة'}</h2>
                <button type="button" className="text-link" onClick={() => setCompanyId(null)}>إغلاق</button>
              </div>
              {detailError && <p className="notice err">{detailError} تعذّر الجلب لا يُعرض كصفر.</p>}
              {!detail && !detailError && <p>جارٍ تحميل التفاصيل…</p>}
              {detail?.company.id === companyId && (
                <div className="company-facts">
                  <p>{detail.company.email} · {formatWhen(detail.company.createdAt)} · {detail.company.status}</p>
                  <p>منذ التسجيل: {formatNumber(detail.company.orders)} طلبات · {formatNumber(detail.company.designs)} تصاميم · {formatNumber(detail.company.generations)} عمليات توليد</p>
                  {detail.orders.length === 0 ? <p className="dash-note">لا طلبات مسجّلة لهذه الشركة.</p> : detail.orders.map((order) => <p key={order.id}>{order.id} · {order.status} · {formatWhen(order.createdAt)}</p>)}
                </div>
              )}
            </section>
          )}

          <details className="dash-card dash-fold">
            <summary>أداء التوليد</summary>
            <div className="dash-fold-body">
              <p>استدعاءات المزود {formatNumber(report.api.calls)} · فشل الاستدعاء {report.api.errorRate === null ? 'غير متاح' : `${formatNumber(report.api.errorRate * 100)}٪`} · P95 {formatMs(report.api.p95Ms)} · متوسط الاستدعاء {formatMs(report.api.avgMs)}</p>
              <p>عمليات منتهية {formatNumber(report.summary.decided)} · ناجحة {formatNumber(report.journey.succeeded)} · فاشلة {formatNumber(report.journey.failed)} · مهلة {formatNumber(report.journey.timedOut)} · متوسط الاكتمال {formatMs(report.journey.avgGenerationMs)}</p>
              {report.journey.failures.length === 0 ? <p className="dash-note">لا أسباب فشل مسجّلة في هذه الفترة.</p> : (
                <ul>{report.journey.failures.map((item) => <li key={item.code}>{failureLabel[item.code] || item.code} · {formatNumber(item.count)}</li>)}</ul>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function Kpi({ icon, label, value, note, delta }: { icon: string; label: string; value: string; note: string; delta: number | null }) {
  return (
    <article className="dash-kpi">
      <span className={`kpi-icon ${icon}`} aria-hidden="true" />
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
      <Delta value={delta} />
    </article>
  )
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>
}
function Empty({ title, text }: { title: string; text: string }) {
  return <div className="dash-empty"><strong>{title}</strong><p>{text}</p></div>
}
function ArabicTip({ active, payload, unit }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; unit: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="dash-tip">
      {payload.map((item) => <p key={item.name}><i style={{ background: item.color }} />{item.name}: {formatNumber(Number(item.value) || 0)} {unit}</p>)}
    </div>
  )
}
function ProductTip({ active, payload, mode }: { active?: boolean; payload?: { payload?: { name: string; orders: number; quantity: number; share: number | null } }[]; mode: 'orders' | 'quantity' }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="dash-tip">
      <p>{row.name}</p>
      <p>{formatNumber(row.orders)} طلب{row.share !== null ? ` · ${formatNumber(row.share * 100)}٪` : ''}</p>
      {mode === 'quantity' && <p>كمية مسجّلة: {formatNumber(row.quantity)}</p>}
    </div>
  )
}
