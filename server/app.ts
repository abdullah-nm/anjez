import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { z } from 'zod'
import { mkdirSync } from 'node:fs'
import { SESSION_COOKIE, loginUser, registerCompany, registerProvider, requireRole, userFromRequest } from './auth.ts'
import { parseProvider, registerFulfillmentRoutes } from './platform/fulfillment.ts'
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
import { runWithAttemptSink } from './observability/attempts.ts'
import { applyDashboardFocus, buildDashboard, dashboardFacets, parseDashboardRange, type DashboardPreset } from './observability/dashboard.ts'
import { featureForRoute, GENERATION_TIMEOUT_MS, isDisplayableImage, METRIC_WINDOWS, MetricsStore, type GenerationStatus, type MetricsRecorder } from './observability/metrics.ts'

const loginSchema = z.object({
  email: z.string().optional().default(''),
  password: z.string().optional().default(''),
})

const registerSchema = z.object({
  companyName: z.string().optional().default(''),
  email: z.string().optional().default(''),
  password: z.string().optional().default(''),
  confirm: z.string().optional().default(''),
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
  const generations = 'openGeneration' in metrics ? metrics as MetricsStore : null
  const activeGenerations = new Set<string>()
  app.use((req, res, next) => {
    const started = process.hrtime.bigint()
    const ctx = freshMetricContext()
    metricContext.run(ctx, () => {
      res.on('finish', () => {
        try {
          if (req.path.startsWith('/api/observability/')) return
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
    requireUser: requireCompanyUser,
    store: deps.store,
    metrics: generations,
    activeGenerations,
  })
  registerFulfillmentRoutes(app, {
    platform: deps.platform,
    store: deps.store,
    requireUser,
  })

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rag: providerStatus(deps.config),
      supportedFiles: SUPPORTED_EXTENSIONS,
    })
  })

  app.post('/api/register', async (req, res, next) => {
    try {
      if (req.body && typeof req.body === 'object' && 'role' in req.body) {
        throw new AppError('إنشاء الحساب ينشئ حساب شركة فقط، ولا يمنح صلاحية الأدمن.', 400, 'ROLE_FORBIDDEN')
      }
      const body = registerSchema.parse(req.body ?? {})
      const result = await registerCompany(deps.store, body, deps.config.sessionSecret, deps.config.sessionTtlMs)
      res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions(deps.config.sessionTtlMs))
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
      res.status(201).json({ user: publicUser(result.user), rag: providerStatus(deps.config) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/register/provider', async (req, res, next) => {
    try {
      if (req.body && typeof req.body === 'object' && 'role' in req.body) {
        throw new AppError('إنشاء الحساب لا يمنح صلاحية الأدمن.', 400, 'ROLE_FORBIDDEN')
      }
      const body = z.object({
        kind: z.enum(['shop', 'individual']),
        displayName: z.string(),
        city: z.string(),
        phone: z.string(),
        services: z.array(z.string()),
        email: z.string(),
        password: z.string(),
        confirm: z.string(),
      }).parse(req.body ?? {})
      const profileInput = parseProvider(body)
      const created = await registerProvider(deps.store, body, deps.config.sessionSecret, deps.config.sessionTtlMs)
      try {
        deps.platform.saveProvider({
          userId: created.userId,
          kind: profileInput.kind,
          displayName: profileInput.displayName,
          city: profileInput.city,
          phone: profileInput.phone,
          services: profileInput.services,
          createdAt: new Date().toISOString(),
        })
      } catch (error) {
        await deps.store.deleteUser(created.userId)
        throw error
      }
      res.cookie(SESSION_COOKIE, created.session.token, sessionCookieOptions(deps.config.sessionTtlMs))
      res.status(201).json({ user: publicUser(created.session.user), rag: providerStatus(deps.config) })
    } catch (error) {
      next(error)
    }
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
      res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions(deps.config.sessionTtlMs))
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
      if (user) await deps.store.bumpSessionEpoch(user.id)
      res.clearCookie(SESSION_COOKIE, { path: '/', sameSite: 'lax', httpOnly: true, secure: false })
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
    const started = Date.now()
    let jobId: string | null = null
    let generationStarted: number | null = null
    let settled = false
    const settle = (
      status: 'succeeded' | 'failed' | 'timeout',
      httpStatus: number,
      failureCode: string | null,
      preview: { mime: string, bytes: Buffer } | null,
    ) => {
      if (settled || !jobId || !generations) return
      settled = true
      activeGenerations.delete(jobId)
      try {
        generations.finishGeneration({
          id: jobId,
          status,
          httpStatus,
          apiDurationMs: Date.now() - started,
          generationDurationMs: generationStarted === null ? null : Date.now() - generationStarted,
          failureCode,
          preview,
        })
      } catch (error) {
        console.error(`generation record skipped: ${error instanceof Error ? error.name : 'error'}`)
      }
    }
    try {
      const user = await requireCompanyUser(req)
      noteMetric(res, { feature: 'design.image' })
      const body = designImageSchema.parse(req.body ?? {})
      try {
        jobId = generations?.openGeneration({ companyId: user.companyId, userName: user.name, userId: user.id, now: started }) ?? null
      } catch (error) {
        console.error(`generation record skipped: ${error instanceof Error ? error.name : 'error'}`)
      }
      if (jobId) activeGenerations.add(jobId)
      const now = Date.now()
      const recent = (imageRequests.get(user.id) ?? []).filter((time) => now - time < 10 * 60 * 1000)
      if (recent.length >= 3) {
        settle('failed', 429, 'IMAGE_RATE_LIMITED', null)
        throw new AppError('وصلت للحد التجريبي: 3 صور كل 10 دقائق. حاول لاحقاً.', 429, 'IMAGE_RATE_LIMITED')
      }
      imageRequests.set(user.id, [...recent, now])
      if (jobId) {
        try {
          generations?.markGenerationRunning(jobId)
        } catch (error) {
          console.error(`generation record skipped: ${error instanceof Error ? error.name : 'error'}`)
        }
      }
      generationStarted = Date.now()

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
        const imageDataUrl = await runWithAttemptSink((attempt) => {
          if (!jobId || !generations) return
          try {
            generations.recordProviderAttempt({
              jobId,
              companyId: user.companyId,
              model: attempt.model,
              httpStatus: attempt.httpStatus,
              durationMs: attempt.durationMs,
              failureCode: attempt.failureCode,
            })
          } catch (recordError) {
            console.error(`generation record skipped: ${recordError instanceof Error ? recordError.name : 'error'}`)
          }
        }, () => images.generate({ prompt, size }))
        const preview = previewFromDataUrl(imageDataUrl)
        if (!preview) {
          settle('failed', 422, 'INVALID_OUTPUT', null)
          noteMetric(res, { feature: 'design.image', generateOk: false, errorClass: 'INVALID_OUTPUT' })
          throw new AppError('اكتمل الرد دون صورة صالحة للعرض.', 422, 'INVALID_OUTPUT')
        }
        if (Date.now() - generationStarted >= GENERATION_TIMEOUT_MS) {
          settle('timeout', 504, 'TIMEOUT', null)
          throw new AppError('انتهت مهلة التوليد قبل اعتماد الصورة.', 504, 'IMAGE_TIMEOUT')
        }
        settle('succeeded', 200, null, preview)
        noteMetric(res, { feature: 'design.image', generateOk: true })
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
        const code = error instanceof AppError ? error.code : 'IMAGE_GENERATION_UNAVAILABLE'
        const httpStatus = error instanceof AppError ? error.status : 503
        const elapsed = generationStarted === null ? 0 : Date.now() - generationStarted
        const timedOut = code === 'IMAGE_TIMEOUT' || httpStatus === 504 || elapsed >= GENERATION_TIMEOUT_MS
        settle(
          timedOut ? 'timeout' : 'failed',
          timedOut ? 504 : httpStatus,
          timedOut ? 'TIMEOUT' : generationFailureCode(error),
          null,
        )
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
            errorCode: code,
          },
        })
        throw error
      }
    } catch (error) {
      if (jobId) activeGenerations.delete(jobId)
      next(error)
    }
  })

  app.get('/api/knowledge/documents', async (req, res, next) => {
    try {
      const user = await requireCompanyUser(req)
      const documents = await deps.store.listDocuments(user.companyId)
      res.json({ documents })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/knowledge/documents', upload.single('file'), async (req, res, next) => {
    try {
      const user = await requireCompanyUser(req)
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
      const user = await requireCompanyUser(req)
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
      const user = await requireCompanyUser(req)
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
      const user = await requireCompanyUser(req)
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
      const user = await requireCompanyUser(req)
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

  app.get('/api/observability/generations', async (req, res, next) => {
    try {
      const user = await requireCompanyUser(req)
      if (user.role !== 'admin') {
        throw new AppError('صلاحية غير كافية لعرض مراقبة التوليد.', 403, 'FORBIDDEN')
      }
      const rawWindow = req.query.window
      const rawStatus = req.query.status
      if ((rawWindow !== undefined && typeof rawWindow !== 'string') || (rawStatus !== undefined && typeof rawStatus !== 'string')) {
        throw new AppError('معاملات التصفية غير صالحة.', 400, 'INVALID_FILTER')
      }
      const parsedWindow = z.enum(METRIC_WINDOWS).safeParse(rawWindow ?? '24h')
      const parsedStatus = z.enum(['all', 'queued', 'running', 'succeeded', 'failed', 'timeout']).safeParse(rawStatus ?? 'all')
      if (!parsedWindow.success || !parsedStatus.success) {
        throw new AppError('معاملات التصفية غير صالحة.', 400, 'INVALID_FILTER')
      }
      if (!generations) {
        res.json(emptyGenerationReport(parsedWindow.data))
        return
      }
      const report = generations.generationReport({
        companyId: user.companyId,
        window: parsedWindow.data,
        status: parsedStatus.data as GenerationStatus | 'all',
        activeIds: [...activeGenerations],
      })
      res.json(report)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/observability/generations/:id/preview', async (req, res, next) => {
    try {
      const user = await requireCompanyUser(req)
      if (user.role !== 'admin') {
        throw new AppError('صلاحية غير كافية لمعاينة نتيجة التوليد.', 403, 'FORBIDDEN')
      }
      const id = routeParam(req.params.id)
      const file = generations?.readGenerationPreviewForAdmin(id)
      if (!file) throw new AppError('لا توجد معاينة لهذه العملية.', 404, 'NOT_FOUND')
      res.setHeader('Content-Type', file.mime)
      res.setHeader('Cache-Control', 'private, max-age=60')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.send(file.bytes)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/observability/companies/:companyId', async (req, res, next) => {
    try {
      const user = await requireCompanyUser(req)
      if (user.role !== 'admin') throw new AppError('صلاحية غير كافية لعرض شركات المنصة.', 403, 'FORBIDDEN')
      const companyId = companyParam(req.params.companyId)
      const companies = await deps.store.listPlatformCompanies()
      const company = companies.find((item) => item.id === companyId)
      if (!company) throw new AppError('الشركة غير موجودة.', 404, 'NOT_FOUND')
      const orderTotals = deps.platform.orderCountsAll()
      const designTotals = deps.platform.designCounts()
      const generationTotals = generations?.generationCountsAll()
      const orders = deps.platform.listPrintOrders(companyId, '1970-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z').map((order) => ({
        id: order.id,
        userName: order.user_name,
        productId: order.product_id,
        status: order.status,
        quantity: order.quantity,
        deliveryDate: order.delivery_date,
        deliveryCity: order.delivery_city,
        designId: order.design_id,
        createdAt: order.created_at,
      }))
      const window = generations?.generationWindow(companyId, 0, Date.now() + 60_000, [...activeGenerations]) ?? { jobs: [], attempts: [], live: [] }
      const designs = deps.platform.listDesigns(companyId).map((design) => ({
        id: design.id,
        productId: design.productId,
        status: design.status,
        createdAt: design.createdAt,
      }))
      res.setHeader('Cache-Control', 'private, no-store')
      res.json({
        company: {
          id: company.id,
          name: company.name,
          email: company.email,
          createdAt: company.createdAt,
          status: accountStatusLabel(company.status),
          orders: orderTotals.get(company.id) ?? 0,
          designs: designTotals.get(company.id) ?? 0,
          generations: generationTotals?.get(company.id)?.total ?? 0,
          succeeded: generationTotals?.get(company.id)?.succeeded ?? 0,
        },
        orders,
        designs,
        generations: window.jobs
          .slice()
          .sort((left, right) => right.requested_at - left.requested_at)
          .map((job) => ({
            id: job.id,
            companyId: job.company_id,
            companyName: company.name,
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
            previewUrl: job.status === 'succeeded' && job.preview_mime ? `/api/observability/generations/${job.id}/preview` : null,
          })),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/observability/dashboard', async (req, res, next) => {
    try {
      const user = await requireCompanyUser(req)
      if (user.role !== 'admin') throw new AppError('صلاحية غير كافية لعرض لوحة المراقبة.', 403, 'FORBIDDEN')
      const presetRaw = typeof req.query.preset === 'string' ? req.query.preset : '7d'
      const fromRaw = typeof req.query.from === 'string' ? req.query.from : undefined
      const toRaw = typeof req.query.to === 'string' ? req.query.to : undefined
      const statusRaw = typeof req.query.status === 'string' ? req.query.status : 'all'
      const preset = z.enum(['today', '7d', '30d', 'custom']).safeParse(presetRaw)
      const status = z.enum(['all', 'queued', 'running', 'succeeded', 'failed', 'timeout']).safeParse(statusRaw)
      if (!preset.success || !status.success || (req.query.from !== undefined && fromRaw === undefined) || (req.query.to !== undefined && toRaw === undefined)) {
        throw new AppError('معاملات التصفية غير صالحة.', 400, 'INVALID_FILTER')
      }
      let range: ReturnType<typeof parseDashboardRange>
      try {
        range = parseDashboardRange({ preset: preset.data as DashboardPreset, from: fromRaw, to: toRaw })
      } catch {
        throw new AppError('الفترة المخصصة غير صالحة. اختر تاريخين ضمن 31 يومًا بتوقيت الرياض.', 400, 'INVALID_RANGE')
      }
      const companies = [...await deps.store.listPlatformCompanies()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      const names = new Map(companies.map((company) => [company.id, company.name]))
      const orderTotals = deps.platform.orderCountsAll()
      const designTotals = deps.platform.designCounts()
      const generationTotals = generations?.generationCountsAll() ?? new Map<string, { total: number, succeeded: number }>()
      const current = generations?.generationWindowAll(range.from, range.to, [...activeGenerations]) ?? { jobs: [], attempts: [], live: [] }
      const previous = generations?.generationWindowAll(range.previousFrom, Math.max(range.previousFrom, range.previousTo - 1), [...activeGenerations]) ?? { jobs: [], attempts: [], live: [] }
      const fromIso = new Date(range.from).toISOString()
      const toIso = new Date(range.to).toISOString()
      const previousFromIso = new Date(range.previousFrom).toISOString()
      const previousToIso = new Date(range.previousTo).toISOString()
      const mapOrder = (order: ReturnType<PlatformStore['listPrintOrdersBetween']>[number]) => ({
        id: order.id,
        companyId: order.company_id,
        companyName: names.get(order.company_id) ?? '',
        userId: order.user_id,
        userName: order.user_name,
        productId: order.product_id,
        status: order.status,
        quantity: order.quantity,
        deliveryDate: order.delivery_date,
        deliveryCity: order.delivery_city,
        designId: order.design_id,
        createdAt: order.created_at,
      })
      const currentOrders = deps.platform.listPrintOrdersBetween(fromIso, toIso).map(mapOrder)
      const previousOrders = deps.platform.listPrintOrdersBetween(previousFromIso, previousToIso)
        .filter((order) => order.created_at < previousToIso)
        .map(mapOrder)
      const designIds = [
        ...current.jobs.map((job) => job.design_id),
        ...previous.jobs.map((job) => job.design_id),
        ...currentOrders.map((order) => order.designId),
        ...previousOrders.map((order) => order.designId),
      ].flatMap((id) => id ? [id] : [])
      const links = deps.platform.designLinks(designIds)
      const eventKeys = new Map(deps.platform.eventOccasionKeys(links.flatMap((link) => link.eventId ? [link.eventId] : [])).map((row) => [row.id, row.occasionKey]))
      const occasionByDesign = new Map(links.map((link) => [link.id, occasionKeyFromEvent(link.eventId, eventKeys)]))
      const withOccasion = <T extends { designId: string | null }>(order: T) => ({
        ...order,
        occasionKey: order.designId ? occasionByDesign.get(order.designId) ?? null : null,
      })
      const orders = currentOrders.map(withOccasion)
      const previousWithOccasion = previousOrders.map(withOccasion)
      const companyRaw = typeof req.query.company === 'string' ? req.query.company.trim() : ''
      if (companyRaw && !/^company_[A-Za-z0-9_-]{1,80}$/.test(companyRaw)) {
        throw new AppError('معرّف الشركة غير صالح.', 400, 'INVALID_FILTER')
      }
      const cityQuery = typeof req.query.city === 'string' ? req.query.city : undefined
      const occasionQuery = typeof req.query.occasion === 'string' ? req.query.occasion : undefined
      const focus = {
        companyId: companyRaw || null,
        cityKey: cityQuery === undefined ? undefined : (cityQuery === '__blank__' ? '' : cityQuery.slice(0, 80)),
        occasionKey: occasionQuery === undefined ? undefined : (occasionQuery === '__blank__' ? null : occasionQuery.slice(0, 80)),
      }
      const focused = applyDashboardFocus({
        focus,
        orders,
        previousOrders: previousWithOccasion,
        jobs: current.jobs,
        previousJobs: previous.jobs,
        attempts: current.attempts,
        live: current.live,
        occasionByDesign,
      })
      const facets = dashboardFacets({
        companies: companies.map((company) => ({ id: company.id, name: company.name })),
        orders: focus.companyId ? orders.filter((order) => order.companyId === focus.companyId) : orders,
        jobs: focus.companyId ? current.jobs.filter((job) => job.company_id === focus.companyId) : current.jobs,
        occasionByDesign,
      })
      const focusActive = Boolean(focus.companyId) || focus.cityKey !== undefined || focus.occasionKey !== undefined
      const report = buildDashboard({
        preset: preset.data,
        from: range.from,
        to: range.to,
        previousFrom: range.previousFrom,
        previousTo: range.previousTo,
        now: Date.now(),
        detailedSince: generations?.detailedSince() ?? Date.now(),
        followupHours: deps.config.orderFollowupHours,
        jobs: focused.jobs,
        previousJobs: focused.previousJobs,
        attempts: focused.attempts,
        live: focused.live,
        orders: focused.orders,
        previousOrderCount: focusActive
          ? focused.previousOrders.length
          : deps.platform.countPrintOrdersBetween(new Date(range.previousFrom).toISOString(), new Date(range.previousTo).toISOString()),
        activeUsers: (await deps.store.activeActorIdsAll(fromIso, toIso)).length,
        previousActiveUsers: (await deps.store.activeActorIdsAll(new Date(range.previousFrom).toISOString(), new Date(Math.max(range.previousFrom, range.previousTo - 1)).toISOString())).length,
        status: status.data,
        registrations: companies.map((company) => Date.parse(company.createdAt)),
        companyNames: names,
        previousOrders: focused.previousOrders,
        occasionByDesign,
        companiesTotal: companies.length,
      })
      const newInPeriod = companies.filter((company) => {
        const at = Date.parse(company.createdAt)
        return at >= range.from && at <= range.to
      }).length
      res.setHeader('Cache-Control', 'private, no-store')
      res.json({
        ...report,
        focus: focused.scope,
        facets,
        companies: {
          total: companies.length,
          newInPeriod,
          rows: companies.map((company) => ({
            id: company.id,
            name: company.name,
            email: company.email,
            createdAt: company.createdAt,
            status: accountStatusLabel(company.status),
            orders: orderTotals.get(company.id) ?? 0,
            designs: designTotals.get(company.id) ?? 0,
            generations: generationTotals.get(company.id)?.total ?? 0,
            succeeded: generationTotals.get(company.id)?.succeeded ?? 0,
          })),
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

  async function requireCompanyUser(req: express.Request): Promise<SessionUser> {
    const user = await requireUser(req)
    if (user.role === 'provider') throw new AppError('هذا المسار خاص بحساب الشركة.', 403, 'FORBIDDEN')
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

function generationFailureCode(error: unknown) {
  const geminiClass = metricContext.getStore()?.geminiClass
  if (error instanceof AppError) {
    if (error.code === 'IMAGE_RATE_LIMITED') return 'IMAGE_RATE_LIMITED'
    if (error.code === 'INVALID_OUTPUT') return 'INVALID_OUTPUT'
    if (error.code === 'IMAGE_TIMEOUT' || error.status === 504 || error.status === 408) return 'TIMEOUT'
    if (error.status === 429 || geminiClass === 'quota') return 'QUOTA'
    if (geminiClass === 'not_configured') return 'NOT_CONFIGURED'
    if (geminiClass === 'auth' || error.status === 401 || error.status === 403) return 'AUTH'
    if (geminiClass === 'invalid' || error.status === 400) return 'INVALID'
    if (geminiClass === 'model_not_found' || error.status === 404) return 'UNAVAILABLE'
  }
  return 'IMAGE_GENERATION_UNAVAILABLE'
}

function previewFromDataUrl(value: string) {
  if (!isDisplayableImage(value)) return null
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value)
  if (!match) return null
  const mime = match[1] === 'jpg' || match[1] === 'jpeg' ? 'image/jpeg' : `image/${match[1]}`
  return { mime, bytes: Buffer.from(match[2].replace(/\s/g, ''), 'base64') }
}

function emptyGenerationReport(window: (typeof METRIC_WINDOWS)[number]) {
  const now = new Date().toISOString()
  return {
    window,
    from: now,
    to: now,
    generatedAt: now,
    timezone: 'Asia/Riyadh',
    totals: {
      total: 0,
      succeeded: 0,
      incomplete: 0,
      failed: 0,
      timedOut: 0,
      queued: 0,
      running: 0,
      successRate: null,
      avgApiMs: null,
      p95ApiMs: null,
      avgGenerationMs: null,
    },
    series: [],
    failures: [],
    recent: [],
  }
}

function routeParam(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value
  if (!id) throw new AppError('معرّف غير صالح.', 400, 'INVALID_ID')
  return id
}

function companyParam(value: string | string[] | undefined) {
  const id = routeParam(value)
  if (!/^company_[A-Za-z0-9_-]{1,80}$/.test(id)) throw new AppError('معرّف الشركة غير صالح.', 400, 'INVALID_ID')
  return id
}

function accountStatusLabel(status: string) {
  if (status === 'deleted') return 'محذوف'
  if (status === 'active') return 'نشط'
  return status
}

function occasionKeyFromEvent(eventId: string | null, keys: Map<string, string | null>) {
  if (!eventId) return null
  if (eventId.startsWith('sys:')) {
    const key = eventId.slice(4).trim()
    return key || null
  }
  const key = keys.get(eventId)?.trim()
  return key || null
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

function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: false,
    path: '/',
    maxAge,
  }
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
