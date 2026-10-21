import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

type KnowledgeDocument = {
  id: string
  filename: string
  status: string
  errorCode: string | null
  errorMessage: string | null
  chunkCount: number
  createdAt: string
  byteSize: number
}

type AskResult = {
  answer: string
  insufficient: boolean
  sources: {
    filename: string
    chunkIndex: number
    excerpt: string
    similarity: number
  }[]
}

const statusLabel: Record<string, string> = {
  pending: 'بانتظار المعالجة',
  processing: 'جارٍ الفهرسة',
  ready: 'جاهز',
  error: 'فشل الفهرسة',
  unsupported: 'ملف غير مدعوم',
}

export function Knowledge() {
  const { user, rag, loading } = useAuth()
  const location = useLocation()
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState('ما سياسة بطاقات الدعوة في شركتنا؟')
  const [result, setResult] = useState<AskResult | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    void loadDocuments()
  }, [user])

  if (loading) return <p>جارٍ التحقق من الجلسة…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  async function loadDocuments() {
    const response = await fetch('/api/knowledge/documents', { credentials: 'include' })
    const payload = await response.json()
    if (!response.ok) {
      setError(payload.error || 'تعذر تحميل المستندات.')
      return
    }
    setDocuments(payload.documents)
  }

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const input = event.currentTarget.elements.namedItem('file') as HTMLInputElement
    const file = input.files?.[0]
    if (!file) {
      setError('اختر ملفاً أولاً.')
      return
    }
    const body = new FormData()
    body.append('file', file)
    setBusy(true)
    const response = await fetch('/api/knowledge/documents', {
      method: 'POST',
      credentials: 'include',
      body,
    })
    const payload = await response.json()
    setBusy(false)
    input.value = ''
    await loadDocuments()
    if (!response.ok || payload.document?.status !== 'ready') {
      setError(
        payload.document?.errorMessage ||
          payload.error ||
          'رُفع الملف لكن الفهرسة لم تكتمل.',
      )
    }
  }

  async function reindex(id: string) {
    setError(null)
    setBusy(true)
    const response = await fetch(`/api/knowledge/documents/${id}/reindex`, {
      method: 'POST',
      credentials: 'include',
    })
    const payload = await response.json()
    setBusy(false)
    if (!response.ok) setError(payload.error || 'تعذرت إعادة الفهرسة.')
    await loadDocuments()
  }

  async function remove(id: string) {
    setError(null)
    setBusy(true)
    const response = await fetch(`/api/knowledge/documents/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    const payload = await response.json()
    setBusy(false)
    if (!response.ok) setError(payload.error || 'تعذر الحذف.')
    await loadDocuments()
  }

  async function ask(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setResult(null)
    setBusy(true)
    const response = await fetch('/api/knowledge/ask', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    const payload = await response.json()
    setBusy(false)
    if (payload.sources) {
      setResult({
        answer: payload.answer,
        insufficient: Boolean(payload.insufficient),
        sources: payload.sources,
      })
    }
    if (!response.ok) {
      setError(payload.error || 'تعذر الاسترجاع.')
    }
  }

  return (
    <div className="stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">معرفة {user.companyName}</p>
          <h1>مستندات معزولة، واسترجاع دلالي داخل شركتك فقط</h1>
          <p className="lede">
            الملفات المدعومة: txt, md, csv, pdf, docx, html. المتجهات تُفلتر في
            الخادم حسب جلسة {user.email}.
          </p>
        </div>
      </section>

      {rag && !rag.embeddingsConfigured && (
        <p className="notice err">
          مزود التضمين غير مضبوط ({rag.missing.join('، ')}). الرفع ممكن لكن
          الفهرسة لن تكتمل حتى تُضاف المفاتيح. راجع README.
        </p>
      )}
      {rag && rag.embeddingsConfigured && !rag.llmConfigured && (
        <p className="notice">
          التضمين جاهز. مزود اللغة غير مضبوط: ستظهر المصادر دون إجابة مولَّدة.
        </p>
      )}

      <form className="card stack" onSubmit={onUpload}>
        <h2>رفع مستند</h2>
        <input name="file" type="file" accept=".txt,.md,.csv,.pdf,.docx,.html,.htm" />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          رفع وفهرسة
        </button>
      </form>

      <section className="stack">
        <div className="section-head">
          <h2>مستندات الشركة</h2>
          <button type="button" className="btn btn-ghost" onClick={() => void loadDocuments()}>
            تحديث الحالة
          </button>
        </div>
        {documents.length === 0 && <p className="muted">لا مستندات بعد.</p>}
        {documents.map((doc) => (
          <article key={doc.id} className="card rec-card">
            <div>
              <h3>{doc.filename}</h3>
              <p>
                {statusLabel[doc.status] || doc.status}
                {doc.errorCode ? ` (${doc.errorCode})` : ''} · {doc.chunkCount} مقطع ·{' '}
                {Math.round(doc.byteSize / 1024)} ك.ب
              </p>
              {doc.errorMessage && <p className="notice err">{doc.errorMessage}</p>}
            </div>
            <div className="hero-actions">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void reindex(doc.id)}>
                إعادة الفهرسة
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void remove(doc.id)}>
                حذف
              </button>
            </div>
          </article>
        ))}
      </section>

      <form className="card stack" onSubmit={ask}>
        <h2>اسأل معرفة الشركة</h2>
        <label className="field">
          <span>السؤال</span>
          <textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          استرجاع وإجابة
        </button>
      </form>

      {result && (
        <section className="card stack">
          <h2>الإجابة</h2>
          <p>{result.answer}</p>
          {result.insufficient && (
            <p className="muted">المصادر غير كافية أو التوليد غير متاح؛ لا تخمين.</p>
          )}
          <h3>المصادر</h3>
          {result.sources.length === 0 && <p className="muted">لا مقاطع ضمن نطاق شركتك.</p>}
          {result.sources.map((source) => (
            <article key={`${source.filename}-${source.chunkIndex}`} className="compact">
              <strong>
                {source.filename} · مقطع {source.chunkIndex + 1}
              </strong>
              <p className="muted">{source.excerpt}</p>
            </article>
          ))}
        </section>
      )}

      {error && <p className="notice err">{error}</p>}
      <p className="muted">
        <Link to="/">العودة للوحة</Link>
      </p>
    </div>
  )
}
