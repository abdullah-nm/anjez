import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'

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

const statusKey: Record<string, 'docPending' | 'docProcessing' | 'docReady' | 'docError' | 'docUnsupported'> = {
  pending: 'docPending',
  processing: 'docProcessing',
  ready: 'docReady',
  error: 'docError',
  unsupported: 'docUnsupported',
}

export function Knowledge() {
  const { user, rag, loading } = useAuth()
  const { t, errorText, formatNumber } = useI18n()
  const [fileName, setFileName] = useState('')
  const location = useLocation()
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<AskResult | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    void loadDocuments()
  }, [user])

  if (loading) return <p>{t('checkingSession')}</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  async function loadDocuments() {
    const response = await fetch('/api/knowledge/documents', { credentials: 'include' })
    const payload = await response.json()
    if (!response.ok) {
      setError(errorText(payload.code, t('loadDocsFailed')))
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
      setError(t('chooseFileFirst'))
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
    setFileName('')
    await loadDocuments()
    if (!response.ok || payload.document?.status !== 'ready') {
      setError(errorText(payload.document?.errorCode || payload.code, t('indexIncomplete')))
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
    if (!response.ok) setError(errorText(payload.code, t('reindexFailed')))
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
    if (!response.ok) setError(errorText(payload.code, t('deleteFailed')))
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
      setError(errorText(payload.code, t('askFailed')))
    }
  }

  return (
    <div className="stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">{t('knowledgeEyebrow', { company: user.companyName })}</p>
          <h1>{t('knowledgeTitle')}</h1>
          <p className="lede">{t('knowledgeFiles')}</p>
        </div>
      </section>

      {rag && !rag.embeddingsConfigured && (
        <p className="notice err">
          {t('embeddingsMissing', { missing: rag.missing.join(', ') })}
        </p>
      )}
      {rag && rag.embeddingsConfigured && !rag.llmConfigured && (
        <p className="notice">
          {t('llmMissing')}
        </p>
      )}

      <form className="card stack" onSubmit={onUpload}>
        <h2>{t('uploadDocument')}</h2>
        <label className="file-pick">
          <input className="file-native" name="file" type="file" accept=".txt,.md,.csv,.pdf,.docx,.html,.htm" onChange={(event) => setFileName(event.target.files?.[0]?.name || '')} />
          <span className="btn btn-ghost">{t('chooseFile')}</span>
          <span>{fileName || t('noFileChosen')}</span>
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {t('uploadIndex')}
        </button>
      </form>

      <section className="stack">
        <div className="section-head">
          <h2>{t('companyDocuments')}</h2>
          <button type="button" className="btn btn-ghost" onClick={() => void loadDocuments()}>
            {t('refreshStatus')}
          </button>
        </div>
        {documents.length === 0 && <p className="muted">{t('noDocuments')}</p>}
        {documents.map((doc) => (
          <article key={doc.id} className="card rec-card">
            <div>
              <h3>{doc.filename}</h3>
              <p>
                {statusKey[doc.status] ? t(statusKey[doc.status]) : doc.status}
                {doc.errorCode ? ` (${doc.errorCode})` : ''} · {formatNumber(doc.chunkCount)} {t('chunk')} · {formatNumber(Math.round(doc.byteSize / 1024))} {t('fileKb')}
              </p>
              {doc.errorCode && <p className="notice err">{errorText(doc.errorCode)}</p>}
            </div>
            <div className="hero-actions">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void reindex(doc.id)}>
                {t('reindex')}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void remove(doc.id)}>
                {t('delete')}
              </button>
            </div>
          </article>
        ))}
      </section>

      <form className="card stack" onSubmit={ask}>
        <h2>{t('askKnowledge')}</h2>
        <label className="field">
          <span>{t('question')}</span>
          <textarea rows={3} value={question} placeholder={t('questionPlaceholder')} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {t('ask')}
        </button>
      </form>

      {result && (
        <section className="card stack">
          <h2>{t('answer')}</h2>
          <p>{result.answer}</p>
          {result.insufficient && (
            <p className="muted">{t('insufficient')}</p>
          )}
          <h3>{t('sources')}</h3>
          {result.sources.length === 0 && <p className="muted">{t('noChunks')}</p>}
          {result.sources.map((source) => (
            <article key={`${source.filename}-${source.chunkIndex}`} className="compact">
              <strong>
                {source.filename} · {t('chunk')} {formatNumber(source.chunkIndex + 1)}
              </strong>
              <p className="muted">{source.excerpt}</p>
            </article>
          ))}
        </section>
      )}

      {error && <p className="notice err">{error}</p>}
      <p className="muted">
        <Link to="/home">{t('backHome')}</Link>
      </p>
    </div>
  )
}
