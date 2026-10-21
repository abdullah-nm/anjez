import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { saveOriginal } from '../lib/files.ts'
import { ingestBuffer } from '../rag.ts'
import { seedAccounts } from '../seed.ts'
import { SqliteStore } from '../store.ts'
import { HashingEmbeddingProvider, ScriptedLlm } from './hashingEmbeddings.ts'
import type { SessionUser } from '../types.ts'
import type { ImageGenerator } from '../lib/imageGeneration.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '../fixtures')

function testEnv(dir: string) {
  return loadConfig({
    SQLITE_PATH: join(dir, 'test.sqlite'),
    UPLOAD_ROOT: join(dir, 'uploads'),
    SESSION_SECRET: 'test-secret-isolation',
    RAG_MIN_SIMILARITY: '0.05',
    DOCUMENT_RETENTION_DAYS: '365',
    VECTOR_BACKEND: 'sqlite',
  })
}

async function boot(images?: ImageGenerator) {
  const dir = mkdtempSync(join(tmpdir(), 'anjz-rag-'))
  const config = testEnv(dir)
  const store = new SqliteStore(config.sqlitePath)
  await seedAccounts(store)
  const embeddings = new HashingEmbeddingProvider()
  const llm = new ScriptedLlm()
  const sara = (await store.getUserById('user_sara')) as SessionUser
  const fahd = (await store.getUserById('user_fahd')) as SessionUser
  const nebrasDoc = await ingestBuffer({
    store,
    embeddings,
    user: sara,
    filename: 'nebras-print-policy.md',
    mimeType: 'text/markdown',
    buffer: readFileSync(join(fixtures, 'nebras-print-policy.md')),
    config,
  })
  const qimamDoc = await ingestBuffer({
    store,
    embeddings,
    user: fahd,
    filename: 'qimam-print-policy.md',
    mimeType: 'text/markdown',
    buffer: readFileSync(join(fixtures, 'qimam-print-policy.md')),
    config,
  })
  saveOriginal(
    config.uploadRoot,
    sara.companyId,
    nebrasDoc!.id,
    'nebras-print-policy.md',
    readFileSync(join(fixtures, 'nebras-print-policy.md')),
  )
  saveOriginal(
    config.uploadRoot,
    fahd.companyId,
    qimamDoc!.id,
    'qimam-print-policy.md',
    readFileSync(join(fixtures, 'qimam-print-policy.md')),
  )
  const app = createApp({ config, store, embeddings, llm, images })
  return { app, store, nebrasDoc, qimamDoc }
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app)
    .post('/api/login')
    .send({ email, password: 'AnjzDemo!26' })
    .expect(200)
  const cookie = response.headers['set-cookie']
  expect(cookie).toBeTruthy()
  return Array.isArray(cookie) ? cookie : [cookie as string]
}

describe('company-isolated RAG', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.()
  })

  it('indexes both companies but never returns the other tenant sources', async () => {
    const { app, store } = await boot()
    cleanups.push(() => store.close())

    const nebrasCookie = await login(app, 'sara@nebras.sa')
    const qimamCookie = await login(app, 'fahd@qimam.sa')

    const nebrasAsk = await request(app)
      .post('/api/knowledge/ask')
      .set('Cookie', nebrasCookie)
      .send({
        question: 'ما هو QIMAM_SECRET_CODE_BETA وسقف ميزانية قمم؟',
        company_id: 'company_qimam',
      })
      .expect(200)

    expect(JSON.stringify(nebrasAsk.body.sources)).not.toContain('qimam-print-policy.md')
    expect(JSON.stringify(nebrasAsk.body.sources)).not.toContain('QIMAM_SECRET_CODE_BETA')
    expect(JSON.stringify(nebrasAsk.body.sources)).not.toContain('company_qimam')

    const nebrasOwn = await request(app)
      .post('/api/knowledge/ask')
      .set('Cookie', nebrasCookie)
      .send({ question: 'ما رمز المعرفة الداخلي لنبراس وخصم الطباعة؟' })
      .expect(200)

    expect(nebrasOwn.body.sources.some((row: { filename: string }) => row.filename.includes('nebras'))).toBe(true)
    expect(JSON.stringify(nebrasOwn.body.sources)).not.toContain('qimam-print-policy.md')
    expect(JSON.stringify(nebrasOwn.body)).toContain('NEBRAS_SECRET_CODE_ALPHA')

    const qimamAsk = await request(app)
      .post('/api/knowledge/ask')
      .set('Cookie', qimamCookie)
      .send({
        question: 'ما هو NEBRAS_SECRET_CODE_ALPHA وخصم نبراس؟',
        companyId: 'company_nebras',
      })
      .expect(200)

    expect(JSON.stringify(qimamAsk.body)).not.toContain('NEBRAS_SECRET_CODE_ALPHA')
    expect(JSON.stringify(qimamAsk.body.sources)).not.toContain('nebras-print-policy.md')
  })

  it('blocks cross-company delete and document listing', async () => {
    const { app, store, qimamDoc } = await boot()
    cleanups.push(() => store.close())
    const nebrasCookie = await login(app, 'sara@nebras.sa')

    await request(app)
      .delete(`/api/knowledge/documents/${qimamDoc!.id}`)
      .set('Cookie', nebrasCookie)
      .expect(404)

    const listed = await request(app)
      .get('/api/knowledge/documents')
      .set('Cookie', nebrasCookie)
      .expect(200)

    expect(listed.body.documents.every((doc: { companyId: string }) => doc.companyId === 'company_nebras')).toBe(true)
    expect(listed.body.documents.some((doc: { filename: string }) => doc.filename.includes('qimam'))).toBe(false)
  })

  it('rejects unauthenticated knowledge access', async () => {
    const { app, store } = await boot()
    cleanups.push(() => store.close())
    await request(app).get('/api/knowledge/documents').expect(401)
    await request(app).post('/api/knowledge/ask').send({ question: 'ما سياسة الطباعة؟' }).expect(401)
  })

  it('generates design artwork from the authenticated company session', async () => {
    let receivedPrompt = ''
    const images: ImageGenerator = {
      generate: async ({ prompt }) => {
        receivedPrompt = prompt
        return 'data:image/webp;base64,dGVzdA=='
      },
    }
    const { app, store } = await boot(images)
    cleanups.push(() => store.close())
    const cookie = await login(app, 'sara@nebras.sa')

    const response = await request(app)
      .post('/api/design/generate')
      .set('Cookie', cookie)
      .send({
        description: 'دعوة فاخرة بنقوش هندسية ومساحة للنص',
        productName: 'بطاقات دعوة',
        eventTitle: 'منتدى القيادة',
        layout: 'portrait',
        palette: ['#142433', '#b8893d'],
        company_id: 'company_qimam',
      })
      .expect(200)

    expect(response.body.imageDataUrl).toBe('data:image/webp;base64,dGVzdA==')
    expect(receivedPrompt).toContain('نبراس للضيافة')
    expect(receivedPrompt).not.toContain('قمم')
    expect(receivedPrompt).toContain('Do not render text')
  })

  it('requires a company session and reports a missing image key clearly', async () => {
    const { app, store } = await boot()
    cleanups.push(() => store.close())

    await request(app)
      .post('/api/design/generate')
      .send({ description: 'تصميم فخم', productName: 'دعوة', layout: 'portrait', palette: ['#142433', '#b8893d'] })
      .expect(401)

    const cookie = await login(app, 'sara@nebras.sa')
    const response = await request(app)
      .post('/api/design/generate')
      .set('Cookie', cookie)
      .send({ description: 'تصميم دعوة فخم بنقوش هندسية', productName: 'دعوة', layout: 'portrait', palette: ['#142433', '#b8893d'] })
      .expect(503)

    expect(response.body.code).toBe('IMAGE_GENERATION_UNAVAILABLE')
  })

  it('reports missing AI keys without pretending RAG succeeded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anjz-rag-'))
    const config = testEnv(dir)
    const store = new SqliteStore(config.sqlitePath)
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const { OpenAICompatibleEmbeddings, OpenAICompatibleLlm } = await import('../lib/embeddings.ts')
    const app = createApp({
      config,
      store,
      embeddings: new OpenAICompatibleEmbeddings(config.embedding),
      llm: new OpenAICompatibleLlm(config.llm),
    })
    const health = await request(app).get('/api/health').expect(200)
    expect(health.body.rag.embeddingsConfigured).toBe(false)
    expect(health.body.rag.llmConfigured).toBe(false)
    expect(health.body.rag.imageConfigured).toBe(false)

    const cookie = await login(app, 'sara@nebras.sa')
    const asked = await request(app)
      .post('/api/knowledge/ask')
      .set('Cookie', cookie)
      .send({ question: 'ما سياسة الطباعة في نبراس؟' })
      .expect(503)
    expect(asked.body.code).toBe('EMBEDDINGS_UNAVAILABLE')
  })

  it('ignores company_id on upload and blocks cross-company reindex', async () => {
    const { app, store, qimamDoc } = await boot()
    cleanups.push(() => store.close())
    const nebrasCookie = await login(app, 'sara@nebras.sa')

    await request(app)
      .post(`/api/knowledge/documents/${qimamDoc!.id}/reindex`)
      .set('Cookie', nebrasCookie)
      .expect(404)

    const uploaded = await request(app)
      .post('/api/knowledge/documents')
      .set('Cookie', nebrasCookie)
      .field('company_id', 'company_qimam')
      .attach('file', join(fixtures, 'nebras-print-policy.md'))
      .expect(201)

    expect(uploaded.body.document.companyId).toBe('company_nebras')
    expect(uploaded.body.document.status).toBe('ready')

    const listed = await request(app)
      .get('/api/knowledge/documents')
      .set('Cookie', nebrasCookie)
      .expect(200)
    expect(listed.body.documents.every((doc: { companyId: string }) => doc.companyId === 'company_nebras')).toBe(true)
  })

  it('lets a member ask but not upload or delete', async () => {
    const { app, store, nebrasDoc } = await boot()
    cleanups.push(() => store.close())
    const memberCookie = await login(app, 'lina@nebras.sa')

    await request(app)
      .post('/api/knowledge/documents')
      .set('Cookie', memberCookie)
      .attach('file', join(fixtures, 'nebras-print-policy.md'))
      .expect(403)

    await request(app)
      .delete(`/api/knowledge/documents/${nebrasDoc!.id}`)
      .set('Cookie', memberCookie)
      .expect(403)

    const asked = await request(app)
      .post('/api/knowledge/ask')
      .set('Cookie', memberCookie)
      .send({ question: 'ما سياسة بطاقات الدعوة في نبراس؟' })
      .expect(200)
    expect(JSON.stringify(asked.body.sources)).not.toContain('qimam-print-policy.md')
  })

  it('rejects unsupported files and does not guess when the company has no chunks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anjz-rag-'))
    const config = testEnv(dir)
    const store = new SqliteStore(config.sqlitePath)
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const app = createApp({
      config,
      store,
      embeddings: new HashingEmbeddingProvider(),
      llm: new ScriptedLlm(),
    })
    const cookie = await login(app, 'sara@nebras.sa')

    await request(app)
      .post('/api/knowledge/documents')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('binary'), 'virus.exe')
      .expect(400)

    const asked = await request(app)
      .post('/api/knowledge/ask')
      .set('Cookie', cookie)
      .set('x-company-id', 'company_qimam')
      .send({ question: 'ما سياسة بطاقات الدعوة؟', company_id: 'company_qimam' })
      .expect(200)
    expect(asked.body.insufficient).toBe(true)
    expect(asked.body.answer).toContain('لا تتوفر معلومة كافية')
    expect(asked.body.sources).toEqual([])
  })

  it('returns 503 when LLM is missing after retrieval, with sources and no invented answer', async () => {
    const { app, store } = await bootWithLlmGap()
    cleanups.push(() => store.close())
    const cookie = await login(app, 'sara@nebras.sa')
    const asked = await request(app)
      .post('/api/knowledge/ask')
      .set('Cookie', cookie)
      .send({ question: 'ما رمز المعرفة الداخلي لنبراس؟' })
      .expect(503)
    expect(asked.body.code).toBe('LLM_UNAVAILABLE')
    expect(asked.body.sources.some((row: { filename: string }) => row.filename.includes('nebras'))).toBe(true)
    expect(asked.body.answer).not.toMatch(/تخمين|خصم الطباعة الداخلي/)
  })
})

async function bootWithLlmGap() {
  const dir = mkdtempSync(join(tmpdir(), 'anjz-rag-'))
  const config = testEnv(dir)
  const store = new SqliteStore(config.sqlitePath)
  await seedAccounts(store)
  const embeddings = new HashingEmbeddingProvider()
  const { OpenAICompatibleLlm } = await import('../lib/embeddings.ts')
  const sara = (await store.getUserById('user_sara')) as SessionUser
  await ingestBuffer({
    store,
    embeddings,
    user: sara,
    filename: 'nebras-print-policy.md',
    mimeType: 'text/markdown',
    buffer: readFileSync(join(fixtures, 'nebras-print-policy.md')),
    config,
  })
  const app = createApp({
    config,
    store,
    embeddings,
    llm: new OpenAICompatibleLlm(config.llm),
  })
  return { app, store }
}
