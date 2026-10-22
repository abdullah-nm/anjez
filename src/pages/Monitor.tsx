import { useEffect, useState } from 'react'
import { useAuth } from '../auth'

type WindowId = '1h' | '24h' | '7d' | '14d'

type Summary = {
  window: WindowId
  from: string
  to: string
  retentionDays: number
  sources: {
    requests: string
    latency: string
    gemini: string
    tokens: string
    health: string
  }
  health: {
    server: { status: 'ok'; source: string }
    gemini: {
      configured: boolean
      textModel: string
      embeddingModel: string
      imageModel: string
      embeddingsConfigured: boolean
      llmConfigured: boolean
      liveProbe: boolean
      source: string
    }
    database: {
      knowledge: 'ok' | 'error'
      platform: 'ok' | 'error'
      vectorBackend: string
      source: string
    }
  }
  requests: { total: number; ok: number; failed: number; errorRate: number | null; p95Ms: number | null }
  previous: { from: string; to: string; total: number; ok: number; failed: number; errorRate: number | null; p95Ms: number | null }
  routes: { method: string; route: string; ok: number; failed: number; p95Ms: number | null }[]
  routesOmitted: number
  indexing: { attempts: number; ready: number; failed: number }
  retrieval: { attempts: number; ok: number; failed: number; empty: number }
  generation: { attempts: number; ok: number; failed: number; insufficient: number }
  preview: { attempts: number; ok: number; failed: number }
  compose: { attempts: number; saved: number; failed: number; bitmapBackgrounds: number; templateOnly: number }
  image: { attempts: number; ok: number; failed: number }
  gemini: { geminiClass: string; count: number }[]
  tokens: {
    available: boolean
    promptTokens: number | null
    outputTokens: number | null
    samples: number
    missingUsage: number
    cost: null
    costNote: string
  }
  errors: {
    at: string
    method: string
    route: string
    feature: string
    status: number
    errorClass: string | null
    geminiClass: string | null
    durationMs: number
  }[]
  errorsOmitted: number
}

const windows: { id: WindowId; label: string }[] = [
  { id: '1h', label: 'ساعة' },
  { id: '24h', label: '24 ساعة' },
  { id: '7d', label: '7 أيام' },
  { id: '14d', label: '14 يوماً' },
]

const geminiLabel: Record<string, string> = {
  quota: 'تجاوز الحصة',
  auth: 'رفض المصادقة',
  model_not_found: 'النموذج غير متاح',
  unavailable: 'المزود غير متاح',
  invalid: 'طلب غير مقبول',
  not_configured: 'المفتاح غير مضبوط',
  unknown: 'سبب غير مصنّف',
}

const featureLabel: Record<string, string> = {
  'knowledge.index': 'فهرسة المعرفة',
  'knowledge.ask': 'سؤال المعرفة',
  'design.preview': 'معاينة القالب',
  'design.compose': 'حفظ التصميم',
  'design.image': 'توليد صورة',
  http: 'طلب آخر',
}

function formatWhen(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatRate(value: number | null) {
  if (value === null) return 'غير متاح'
  return `${(value * 100).toFixed(1)}٪`
}

function formatMs(value: number | null) {
  if (value === null) return 'غير متاح'
  if (value >= 1000) return `${(value / 1000).toFixed(1)} ث`
  return `${value} مللي ث`
}

function count(value: number) {
  return new Intl.NumberFormat('ar-SA').format(value)
}

export function Monitor() {
  const { user, loading } = useAuth()
  const [windowId, setWindowId] = useState<WindowId>('24h')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) return
    if (user.role !== 'admin') {
      setPending(false)
      setError('هذه الصفحة لمديري الشركة فقط.')
      setSummary(null)
      return
    }
    let cancelled = false
    setPending(true)
    setError('')
    setSummary(null)
    void (async () => {
      try {
        const response = await fetch(`/api/observability/summary?window=${windowId}`, { credentials: 'include' })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'تعذر تحميل مقاييس المراقبة.')
        if (cancelled) return
        setSummary(payload)
      } catch (loadError) {
        if (cancelled) return
        setSummary(null)
        setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل مقاييس المراقبة.')
      } finally {
        if (!cancelled) setPending(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, windowId, attempt])

  if (loading || (user && pending && !summary && !error)) return <p>جارٍ تحميل المراقبة…</p>

  const maxCompared = Math.max(summary?.requests.total || 0, summary?.previous.total || 0)

  return (
    <div className="stack monitor">
      <section className="section-head">
        <div>
          <h1>مراقبة النظام</h1>
          <p className="muted">مقاييس هذه الشركة كما سجّلها الخادم. الاحتفاظ {summary?.retentionDays ?? 14} يوماً.</p>
        </div>
        <div className="monitor-windows" role="group" aria-label="الفترة الزمنية">
          {windows.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === windowId ? 'btn btn-primary' : 'btn btn-secondary'}
              onClick={() => setWindowId(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="notice err" role="alert">
          <p>{error}</p>
          {user?.role === 'admin' && (
            <button type="button" className="btn btn-secondary" onClick={() => setAttempt((value) => value + 1)}>
              إعادة المحاولة
            </button>
          )}
        </div>
      )}

      {summary && (
        <>
          <p className="muted">
            من {formatWhen(summary.from)} إلى {formatWhen(summary.to)} بتوقيت الرياض.
          </p>
          <section className="monitor-grid">
            <article className="card monitor-card">
              <h2>الخادم</h2>
              <p className="monitor-value">{summary.health.server.status === 'ok' ? 'يستجيب' : 'لا يستجيب'}</p>
              <p className="muted">{summary.health.server.source}</p>
            </article>
            <article className="card monitor-card">
              <h2>Gemini</h2>
              <p className="monitor-value">{summary.health.gemini.configured ? 'المفتاح مضبوط' : 'المفتاح غير مضبوط'}</p>
              <p>النص: {summary.health.gemini.textModel}</p>
              <p>التضمين: {summary.health.gemini.embeddingModel}</p>
              <p>الصورة: {summary.health.gemini.imageModel}</p>
              <p className="muted">{summary.health.gemini.source}</p>
            </article>
            <article className="card monitor-card">
              <h2>قواعد البيانات</h2>
              <p>المعرفة: {summary.health.database.knowledge === 'ok' ? 'تستجيب' : 'لا تستجيب'}</p>
              <p>المنصة: {summary.health.database.platform === 'ok' ? 'تستجيب' : 'لا تستجيب'}</p>
              <p>مخزن المتجهات: {summary.health.database.vectorBackend}</p>
              <p className="muted">{summary.health.database.source}</p>
            </article>
          </section>

          {summary.requests.total === 0 ? (
            <p className="notice">لا توجد طلبات مسجّلة في هذه الفترة. تظهر الأرقام بعد استخدام المعرفة أو التصميم أو بقية الواجهة.</p>
          ) : null}

          <section className="monitor-grid">
            <article className="card monitor-card">
              <h2>الطلبات</h2>
              <p className="monitor-value">{count(summary.requests.total)}</p>
              <p>ناجحة: {count(summary.requests.ok)} · فاشلة: {count(summary.requests.failed)}</p>
              <p className="muted">{summary.sources.requests}</p>
            </article>
            <article className="card monitor-card">
              <h2>معدل الخطأ</h2>
              <p className="monitor-value">{formatRate(summary.requests.errorRate)}</p>
              <p className="muted">الفاشل مقسوماً على كل الطلبات المسجّلة في الفترة. غير متاح إذا لم يوجد طلب.</p>
            </article>
            <article className="card monitor-card">
              <h2>زمن الاستجابة p95</h2>
              <p className="monitor-value">{formatMs(summary.requests.p95Ms)}</p>
              <p className="muted">{summary.sources.latency}</p>
            </article>
          </section>

          <section className="card monitor-card">
            <h2>مقارنة بالفترة السابقة بنفس الطول</h2>
            <p className="muted">من {formatWhen(summary.previous.from)} إلى {formatWhen(summary.previous.to)}.</p>
            {summary.requests.total === 0 && summary.previous.total === 0 ? (
              <p>لا طلبات في الفترتين.</p>
            ) : (
              <div className="monitor-compare">
                <div>
                  <span>الحالية: {count(summary.requests.total)} طلب · خطأ {formatRate(summary.requests.errorRate)} · p95 {formatMs(summary.requests.p95Ms)}</span>
                  <span className="monitor-bar" style={{ width: `${maxCompared ? (summary.requests.total / maxCompared) * 100 : 0}%` }} />
                </div>
                <div>
                  <span>السابقة: {count(summary.previous.total)} طلب · خطأ {formatRate(summary.previous.errorRate)} · p95 {formatMs(summary.previous.p95Ms)}</span>
                  <span className="monitor-bar monitor-bar-past" style={{ width: `${maxCompared ? (summary.previous.total / maxCompared) * 100 : 0}%` }} />
                </div>
              </div>
            )}
            <p>فرق عدد الطلبات: {count(summary.requests.total - summary.previous.total)}</p>
          </section>

          <section className="card monitor-card">
            <h2>المعرفة والتصميم</h2>
            <ul className="monitor-list">
              <li>فهرسة المستندات: {count(summary.indexing.attempts)} محاولة، نجح {count(summary.indexing.ready)}، فشل {count(summary.indexing.failed)}</li>
              <li>استرجاع المعرفة: {count(summary.retrieval.attempts)} محاولة، نجح {count(summary.retrieval.ok)}، فشل {count(summary.retrieval.failed)}، بلا مقاطع {count(summary.retrieval.empty)}</li>
              <li>توليد الإجابة: {count(summary.generation.attempts)} محاولة، نجح {count(summary.generation.ok)}، فشل {count(summary.generation.failed)}، منها بلا معلومة كافية {count(summary.generation.insufficient)}</li>
              <li>معاينة القالب: {count(summary.preview.attempts)} محاولة، نجح {count(summary.preview.ok)}، فشل {count(summary.preview.failed)}</li>
              <li>حفظ التصميم: {count(summary.compose.attempts)} محاولة، حُفظ {count(summary.compose.saved)}، فشل {count(summary.compose.failed)}، خلفية Gemini {count(summary.compose.bitmapBackgrounds)}، قالب بلا صورة مولَّدة {count(summary.compose.templateOnly)}</li>
              <li>توليد صورة مباشر: {count(summary.image.attempts)} محاولة، نجح {count(summary.image.ok)}، فشل {count(summary.image.failed)}</li>
            </ul>
          </section>

          <section className="card monitor-card">
            <h2>Gemini</h2>
            {summary.gemini.length === 0 ? <p>لا أخطاء Gemini مصنّفة في هذه الفترة.</p> : (
              <ul className="monitor-list">
                {summary.gemini.map((item) => (
                  <li key={item.geminiClass}>{geminiLabel[item.geminiClass] || item.geminiClass}: {count(item.count)}</li>
                ))}
              </ul>
            )}
            <p className="muted">{summary.sources.gemini}</p>
            <p>
              الرموز: {summary.tokens.available
                ? `${count(summary.tokens.promptTokens || 0)} إدخال، ${count(summary.tokens.outputTokens || 0)} إخراج، من ${count(summary.tokens.samples)} رد`
                : 'غير متاحة'}
              {summary.tokens.missingUsage > 0 ? ` · ${count(summary.tokens.missingUsage)} رد بلا usageMetadata` : ''}
            </p>
            <p>التكلفة: غير متاحة. {summary.tokens.costNote}</p>
          </section>

          <section className="card monitor-card">
            <h2>المسارات</h2>
            {summary.routes.length === 0 ? <p>لا طلبات في هذه الفترة.</p> : (
              <div className="monitor-table-wrap">
                <table className="monitor-table">
                  <thead>
                    <tr>
                      <th>المسار</th>
                      <th>ناجح</th>
                      <th>فاشل</th>
                      <th>p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.routes.map((row) => (
                      <tr key={`${row.method} ${row.route}`}>
                        <td>{row.method} {row.route}</td>
                        <td>{count(row.ok)}</td>
                        <td>{count(row.failed)}</td>
                        <td>{formatMs(row.p95Ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {summary.routesOmitted > 0 && <p className="muted">أُخفي {count(summary.routesOmitted)} مساراً أقل حركة.</p>}
          </section>

          <section className="card monitor-card">
            <h2>آخر الأخطاء المصنّفة</h2>
            {summary.errors.length === 0 ? <p>لا أخطاء مسجّلة في هذه الفترة.</p> : (
              <div className="monitor-table-wrap">
                <table className="monitor-table">
                  <thead>
                    <tr>
                      <th>الوقت</th>
                      <th>الميزة</th>
                      <th>المسار</th>
                      <th>الحالة</th>
                      <th>التصنيف</th>
                      <th>Gemini</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.errors.map((row) => (
                      <tr key={`${row.at}-${row.route}-${row.status}`}>
                        <td>{formatWhen(row.at)}</td>
                        <td>{featureLabel[row.feature] || row.feature}</td>
                        <td>{row.method} {row.route}</td>
                        <td>{row.status}</td>
                        <td>{row.errorClass || '—'}</td>
                        <td>{row.geminiClass ? geminiLabel[row.geminiClass] || row.geminiClass : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {summary.errorsOmitted > 0 && <p className="muted">وهناك {count(summary.errorsOmitted)} خطأ أقدم في الفترة نفسها.</p>}
          </section>
        </>
      )}
    </div>
  )
}
