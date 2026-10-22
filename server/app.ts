import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { z } from 'zod'
import { mkdirSync } from 'node:fs'
import { SESSION_COOKIE, loginUser, requireRole, userFromRequest } from './auth.ts'
import { readOriginal, removeOriginal, saveOriginal } from './lib/files.ts'
import type { AppConfig } from './config.ts'
import { providerStatus } from './config.ts'
import { AppError, MissingProviderError } from './lib/errors.ts'
import { GeminiImageClient } from './platform/gemini.ts'
import type { ImageGenerator, ImageSize } from './lib/imageGeneration.ts'
import { SUPPORTED_EXTENSIONS, isSupportedFilename } from './lib/extract.ts'
import { answerFromChunks, ingestBuffer, retrieveForCompany } from './rag.ts'
import type { KnowledgeStore } from './store.ts'
import type { EmbeddingProvider, LlmProvider, SessionUser } from './types.ts'
import { registerPlatformRoutes } from './platform/routes.ts'
import { LocalObjectStorage } from './platform/storage.ts'
import type { PlatformStore } from './platform/store.ts'
import {
  attachMetricCompany,
  freshMetricContext,
  metricCompany,
  metricContext,
  noteMetric,
} from './observability/context.ts'
import { featureForRoute, METRIC_WINDOWS, MetricsStore, type MetricsRecorder } from './observability/metrics.ts'

const loginSchema = z.object({
  email: z.string().optional().default(''),
  password: z.string().optional().default(''),
})

const askSchema = z
  .object({
    question: z.string().trim().min(4).max(2000),
  })
  .transform((body) => ({ question: body.question }))

const designImageSchema = z.object({
  description: z.string().trim().min(8).max(1200),
  productName: z.string().trim().min(1).max(100),
  eventTitle: z.string().trim().max(100).default(''),
  layout: z.enum(['portrait', 'square', 'landscape']),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).length(2),
})

type Deps = {
  config: AppConfig
  store: KnowledgeStore
  embeddings: EmbeddingProvider
  llm: LlmProvider
  images?: ImageGenerator
  platform: PlatformStore
  storage: LocalObjectStorage
  metrics?: MetricsRecorder
}

export function createApp(deps: Deps) {
  const app = express()
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.config.maxUploadBytes },
  })
  const images =
    deps.images ??
    { generate: ({ prompt }: { prompt: string; size: ImageSize }) =>
      new GeminiImageClient(deps.config.geminiApiKey, deps.config.geminiImageModel)
        .generatePngDataUrl(prompt) }
  const imageRequests = new Map<string, number[]>()

  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  const metrics = deps.metrics ?? new MetricsStore(deps.config.platformSqlitePath)
  app.use((req, res, next) => {
    const started = process.hrtime.bigint()
    const ctx = freshMetricContext()
    metricContext.run(ctx, () => {
      res.on('finish', () => {
        try {
          if (req.path === '/api/observability/summary') return
          const companyId = metricCompany(req)
          if (!companyId) return
          const route = requestRoute(req)
          const note = (res.locals.metricNote || {}) as {
            feature?: string
            retrieveOk?: boolean | null
            generateOk?: boolean | null
            indexOk?: boolean | null
            insufficient?: boolean | null
            backgroundKind?: string | null
            errorClass?: string | null
          }
          const status = res.statusCode
          const errorClass = safeErrorClass(note.errorClass) || safeErrorClass(res.locals.errorClass) || classFromStatus(status)
          metrics.record({
            companyId,
            method: req.method,
            route,
            feature: note.feature || featureForRoute(req.method, route),
            status,
            durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
            errorClass,
            geminiClass: safeGeminiClass(res.locals.geminiClass) || ctx.geminiClass || null,
            retrieveOk: note.retrieveOk ?? null,
            generateOk: note.generateOk ?? null,
            indexOk: note.indexOk ?? null,
            insufficient: note.insufficient ?? null,
            backgroundKind: note.backgroundKind ?? null,
            promptTokens: ctx.usageSamples > 0 ? ctx.promptTokens : null,
            outputTokens: ctx.usageSamples > 0 ? ctx.outputTokens : null,
            usageSamples: ctx.usageSamples,
            usageMissing: ctx.usageMissing,
          })
        } catch (error) {
          console.error(`metric record skipped: ${error instanceof Error ? error.name : 'error'}`)
        }
      })
      next()
    })
  })

  registerPlatformRoutes(app, {
    config: deps.config,
    platform: deps.platform,
    storage: deps.storage,
    llm: deps.llm,
    images,
    requireUser,
  })

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rag: providerStatus(deps.config),
      supportedFiles: SUPPORTED_EXTENSIONS,
    })
  })

  app.post('/api/login', async (req, res, next) => {
    try {
      const body = loginSchema.parse(req.body)
      const result = await loginUser(
        deps.store,
        body.email,
        body.password,
        deps.config.sessionSecret,
        deps.config.sessionTtlMs,
      )
      res.cookie(SESSION_COOKIE, result.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: deps.config.sessionTtlMs,
      })
      attachMetricCompany(req, result.user.companyId)
      await deps.store.audit({
        actorUserId: result.user.id,
        companyId: result.user.companyId,
        action: 'auth.login',
        targetType: 'user',
        targetId: result.user.id,
        ip: req.ip ?? null,
        result: 'ok',
      })
      res.json({ user: publicUser(result.user), rag: providerStatus(deps.config) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/logout', async (req, res, next) => {
    try {
      const user = await userFromRequest(deps.store, req, deps.config.sessionSecret)
      if (user) attachMetricCompany(req, user.companyId)
      res.clearCookie(SESSION_COOKIE)
      if (user) {
        await deps.store.audit({
          actorUserId: user.id,
          companyId: user.companyId,
          action: 'auth.logout',
          targetType: 'user',
          targetId: user.id,
          ip: req.ip ?? null,
          result: 'ok',
        })
      }
      res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/session', async (req, res, next) => {
    try {
      const user = await userFromRequest(deps.store, req, deps.config.sessionSecret)
      if (user) attachMetricCompany(req, user.companyId)
      res.json({ user: user ? publicUser(user) : null, rag: providerStatus(deps.config) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/design/generate', async (req, res, next) => {
    try {
      const user = await requireUser(req)
      noteMetric(res, { feature: 'design.image' })
      const body = designImageSchema.parse(req.body ?? {})
      const now = Date.now()
      const recent = (imageRequests.get(user.id) ?? []).filter((time) => now - time < 10 * 60 * 1000)
      if (recent.length >= 3) {
        throw new AppError('وصلت للحد التجريبي: 3 صور كل 10 دقائق. حاول لاحقاً.', 429, 'IMAGE_RATE_LIMITED')
      }
      imageRequests.set(user.id, [...recent, now])

      const size: ImageSize =
        body.layout === 'portrait'
          ? '1024x1536'
          : body.layout === 'landscape'
            ? '1536x1024'
            : '1024x1024'
      const prompt = [
        'Create polished, print-ready background artwork for a Saudi business. Follow the visual direction below.',
        `Company: ${user.companyName}.`,
        `Printed product: ${body.productName}. Event: ${body.eventTitle || 'general company campaign'}.`,
        `Brand palette: ${body.palette.join(' and ')}.`,
        `Visual direction: ${body.description}`,
        'Do not render text, letters, numerals, logos, signatures, or watermarks. Keep the main subject clear of the text-safe area; editable Arabic copy will be overlaid by the app.',
      ].join('\n')

      try {
        const imageDataUrl = await images.generate({ prompt, size })
        await deps.store.audit({
          actorUserId: user.id,
          companyId: user.companyId,
          action: 'design.image.generate',
          targetType: 'design',
          targetId: null,
          ip: req.ip ?? null,
          result: 'ok',
          extra: { promptChars: body.description.length, layout: body.layout },
        })
        res.json({ imageDataUrl, companyId: user.companyId })
      } catch (error) {
        await deps.store.audit({
          actorUserId: user.id,
          companyId: user.companyId,
          action: 'design.image.generate',
          targetType: 'design',
          targetId: null,
          ip: req.ip ?? null,
          result: 'error',
          extra: {
            promptChars: body.description.length,
            layout: body.layout,
            errorCode: error instanceof AppError ? error.code : 'IMAGE_GENERATION_UNAVAILABLE',
          },
        })
        throw error
      }
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/knowledge/documents', async (req, res, next) => {
    try {
      const user = await requireUser(req)
      const documents = await deps.store.listDocuments(user.companyId)
      res.json({ documents })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/knowledge/documents', upload.single('file'), async (req, res, next) => {
    try {
      const user = await requireUser(req)
      requireRole(user, 'admin')
      noteMetric(res, { feature: 'knowledge.index' })
      const file = req.file
      if (!file) throw new AppError('لم يُرفق ملف.', 400, 'FILE_REQUIRED')
      if (!isSupportedFilename(file.originalname)) {
        await deps.store.audit({
          actorUserId: user.id,
          companyId: user.companyId,
          action: 'document.upload_rejected',
          targetType: 'document',
          targetId: null,
          ip: req.ip ?? null,
          result: 'denied',
          extra: { filenameExt: file.originalname.split('.').pop() || '', bytes: file.size },
        })
        throw new AppError(
          `نوع الملف غير مدعوم. المسموح: ${SUPPORTED_EXTENSIONS.join(', ')}`,
          400,
          'unsupported',
        )
      }
      mkdirSync(deps.config.uploadRoot, { recursive: true })
      const document = await ingestBuffer({
        store: deps.store,
        embeddings: deps.embeddings,
        user,
        filename: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
        config: deps.config,
      })
      if (document) {
        saveOriginal(
          deps.config.uploadRoot,
          user.companyId,
          document.id,
          file.originalname,
          file.buffer,
        )
      }
      noteMetric(res, {
        feature: 'knowledge.index',
        indexOk: document?.status === 'ready',
        errorClass: document?.status === 'ready' ? null : document?.errorCode ?? null,
      })
      await deps.store.audit({
        actorUserId: user.id,
        companyId: user.companyId,
        action: 'document.upload',
        targetType: 'document',
        targetId: document?.id ?? null,
        ip: req.ip ?? null,
        result: document?.status === 'ready' ? 'ok' : 'error',
        extra: { status: document?.status ?? 'error', bytes: file.size },
      })
      res.status(knowledgeWriteStatus(document, 201)).json({ document })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/knowledge/documents/:id/reindex', async (req, res, next) => {
    try {
      const user = await requireUser(req)
      requireRole(user, 'admin')
      noteMetric(res, { feature: 'knowledge.index' })
      const documentId = routeParam(req.params.id)
      const current = await deps.store.getDocument(user.companyId, documentId)
      if (!current) throw new AppError('المستند غير موجود ضمن شركتك.', 404, 'NOT_FOUND')
      const buffer = readOriginal(
        deps.config.uploadRoot,
        user.companyId,
        current.id,
        current.filename,
      )
      if (!buffer) {
        throw new AppError('الملف الأصلي غير موجود لإعادة الفهرسة. ارفع المستند من جديد.', 409, 'ORIGINAL_MISSING')
      }
      const document = await ingestBuffer({
        store: deps.store,
        embeddings: deps.embeddings,
        user,
        filename: current.filename,
        mimeType: current.mimeType,
        buffer,
        config: deps.config,
        documentId: current.id,
      })
      noteMetric(res, {
        feature: 'knowledge.index',
        indexOk: document?.status === 'ready',
        errorClass: document?.status === 'ready' ? null : document?.errorCode ?? null,
      })
      await deps.store.audit({
        actorUserId: user.id,
        companyId: user.companyId,
        action: 'document.reindex',
        targetType: 'document',
        targetId: current.id,
        ip: req.ip ?? null,
        result: document?.status === 'ready' ? 'ok' : 'error',
        extra: { status: document?.status ?? 'error' },
      })
      res.status(knowledgeWriteStatus(document, 200)).json({ document })
      return
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/knowledge/documents/:id', async (req, res, next) => {
    try {
      const user = await requireUser(req)
      requireRole(user, 'admin')
      const documentId = routeParam(req.params.id)
      const deleted = await deps.store.softDeleteDocument(
        user.companyId,
        documentId,
        new Date().toISOString(),
      )
      await deps.store.audit({
        actorUserId: user.id,
        companyId: user.companyId,
        action: 'document.delete',
        targetType: 'document',
        targetId: documentId,
        ip: req.ip ?? null,
        result: deleted ? 'ok' : 'denied',
      })
      if (!deleted) throw new AppError('المستند غير موجود ضمن شركتك.', 404, 'NOT_FOUND')
      removeOriginal(deps.config.uploadRoot, user.companyId, documentId)
      res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/knowledge/ask', async (req, res, next) => {
    try {
      const user = await requireUser(req)
      noteMetric(res, { feature: 'knowledge.ask' })
      const body = askSchema.parse(req.body ?? {})

      let chunks
      try {
        chunks = await retrieveForCompany({
          store: deps.store,
          embeddings: deps.embeddings,
          companyId: user.companyId,
          question: body.question,
          minSimilarity: deps.config.minSimilarity,
        })
      } catch (error) {
        noteMetric(res, {
          feature: 'knowledge.ask',
          retrieveOk: false,
          generateOk: null,
          errorClass: error instanceof AppError ? error.code : 'EMBED_FAILED',
        })
        await deps.store.audit({
          actorUserId: user.id,
          companyId: user.companyId,
          action: 'knowledge.ask',
          targetType: 'query',
          targetId: null,
          ip: req.ip ?? null,
          result: 'error',
          extra: { errorCode: error instanceof AppError ? error.code : 'EMBED_FAILED' },
        })
        throw error
      }

      let answer: string
      let insufficient: boolean
      try {
        const generated = await answerFromChunks({
          llm: deps.llm,
          question: body.question,
          chunks,
        })
        answer = generated.answer
        insufficient = generated.insufficient
      } catch (error) {
        if (chunks.length === 0) {
          answer = 'لا تتوفر معلومة كافية في معرفة الشركة.'
          insufficient = true
          noteMetric(res, { feature: 'knowledge.ask', retrieveOk: true, generateOk: null, insufficient: true })
        } else if (error instanceof MissingProviderError) {
          noteMetric(res, {
            feature: 'knowledge.ask',
            retrieveOk: true,
            generateOk: false,
            errorClass: error.code,
          })
          await deps.store.audit({
            actorUserId: user.id,
            companyId: user.companyId,
            action: 'knowledge.ask',
            targetType: 'query',
            targetId: null,
            ip: req.ip ?? null,
            result: 'error',
            extra: { errorCode: error.code, sourceCount: chunks.length },
          })
          res.status(503).json({
            error: error.message,
            code: error.code,
            answer:
              'تم استرجاع مصادر من معرفة شركتك، لكن مزود اللغة غير متاح حالياً. لا إجابة مولَّدة.',
            insufficient: true,
            sources: publicSources(chunks),
          })
          return
        } else {
          throw error
        }
      }

      noteMetric(res, {
        feature: 'knowledge.ask',
        retrieveOk: true,
        generateOk: chunks.length > 0 ? true : null,
        insufficient,
      })
      await deps.store.audit({
        actorUserId: user.id,
        companyId: user.companyId,
        action: 'knowledge.ask',
        targetType: 'query',
        targetId: null,
        ip: req.ip ?? null,
        result: 'ok',
        extra: {
          questionChars: body.question.length,
          sourceCount: chunks.length,
          insufficient,
        },
      })

      res.json({
        answer,
        insufficient,
        sources: publicSources(chunks),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/observability/summary', async (req, res, next) => {
    try {
      const user = await requireUser(req)
      if (user.role !== 'admin') {
        throw new AppError('صلاحية غير كافية لعرض مراقبة النظام.', 403, 'FORBIDDEN')
      }
      const rawWindow = req.query.window
      if (rawWindow !== undefined && typeof rawWindow !== 'string') {
        throw new AppError('الفترة الزمنية غير مدعومة. استخدم 1h أو 24h أو 7d أو 14d.', 400, 'INVALID_WINDOW')
      }
      const parsedWindow = z.enum(METRIC_WINDOWS).safeParse(rawWindow ?? '24h')
      if (!parsedWindow.success) {
        throw new AppError('الفترة الزمنية غير مدعومة. استخدم 1h أو 24h أو 7d أو 14d.', 400, 'INVALID_WINDOW')
      }
      const knowledgeOk = await deps.store.ping()
      const platformOk = deps.platform.ping()
      const metricsOk = metrics.ping()
      const providers = providerStatus(deps.config)
      const summary = metrics.summary({ companyId: user.companyId, window: parsedWindow.data })
      res.json({
        ...summary,
        health: {
          server: { status: 'ok' as const, source: 'هذا الرد صادر من عملية الخادم الحالية.' },
          gemini: {
            configured: providers.geminiConfigured,
            textModel: providers.geminiTextModel,
            embeddingModel: providers.geminiEmbeddingModel,
            imageModel: providers.imageModel,
            embeddingsConfigured: providers.embeddingsConfigured,
            llmConfigured: providers.llmConfigured,
            liveProbe: false,
            source: 'إعداد الخادم فقط. لا يُرسل طلب إلى Gemini عند فتح المراقبة.',
          },
          database: {
            knowledge: knowledgeOk ? 'ok' as const : 'error' as const,
            platform: platformOk && metricsOk ? 'ok' as const : 'error' as const,
            vectorBackend: providers.vectorBackend,
            source: 'SELECT 1 على قاعدة المعرفة وقاعدة المنصة.',
          },
        },
      })
    } catch (error) {
      next(error)
    }
  })

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next
    if (error instanceof z.ZodError) {
      res.locals.errorClass = 'INVALID_BODY'
      res.status(400).json({ error: 'طلب غير صالح.', code: 'INVALID_BODY' })
      return
    }
    if (error instanceof AppError) {
      res.locals.errorClass = error.code
      res.status(error.status).json({ error: error.message, code: error.code })
      return
    }
    if (typeof error === 'object' && error && 'code' in error && (error as { code: string }).code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'حجم الملف أكبر من الحد المسموح.', code: 'FILE_TOO_LARGE' })
      return
    }
    res.status(500).json({ error: 'خطأ غير متوقع في الخادم.', code: 'INTERNAL' })
  })

  async function requireUser(req: express.Request): Promise<SessionUser> {
    const user = await userFromRequest(deps.store, req, deps.config.sessionSecret)
    if (!user) throw new AppError('يلزم تسجيل الدخول.', 401, 'UNAUTHENTICATED')
    attachMetricCompany(req, user.companyId)
    return user
  }

  return app
}

function requestRoute(req: express.Request) {
  const pattern = req.route && typeof req.route.path === 'string' ? req.route.path : req.path
  const path = pattern.startsWith('/') ? pattern : `${req.baseUrl}${pattern}`
  return path.split('?')[0] || req.path
}

function classFromStatus(status: number) {
  if (status < 400) return null
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 503) return 'UNAVAILABLE'
  if (status >= 500) return 'INTERNAL'
  return 'INVALID'
}

function safeErrorClass(value: unknown) {
  return typeof value === 'string' && /^[A-Z0-9_]{1,48}$/.test(value) ? value : null
}

function safeGeminiClass(value: unknown) {
  const allowed = new Set(['quota', 'auth', 'model_not_found', 'unavailable', 'invalid', 'not_configured', 'unknown'])
  return typeof value === 'string' && allowed.has(value) ? value : null
}

function routeParam(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value
  if (!id) throw new AppError('معرّف غير صالح.', 400, 'INVALID_ID')
  return id
}

function knowledgeWriteStatus(
  document: { status: string; errorCode: string | null } | null,
  successStatus: number,
) {
  if (!document) return 500
  if (document.status === 'ready') return successStatus
  if (document.status === 'unsupported') return 400
  if (document.errorCode === 'EMBEDDINGS_UNAVAILABLE' || document.errorCode === 'LLM_UNAVAILABLE') {
    return 503
  }
  return 422
}

function publicSources(
  chunks: {
    documentId: string
    filename: string
    chunkIndex: number
    content: string
    similarity: number
  }[],
) {
  return chunks.map((chunk) => ({
    documentId: chunk.documentId,
    filename: chunk.filename,
    chunkIndex: chunk.chunkIndex,
    excerpt: chunk.content.slice(0, 280),
    similarity: Number(chunk.similarity.toFixed(4)),
  }))
}

function publicUser(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    companyId: user.companyId,
    companyName: user.companyName,
    role: user.role,
  }
}
