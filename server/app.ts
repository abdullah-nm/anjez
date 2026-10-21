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

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
      res.json({ user: user ? publicUser(user) : null, rag: providerStatus(deps.config) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/design/generate', async (req, res, next) => {
    try {
      const user = await requireUser(req)
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
        } else if (error instanceof MissingProviderError) {
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

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'طلب غير صالح.', code: 'INVALID_BODY' })
      return
    }
    if (error instanceof AppError) {
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
    return user
  }

  return app
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
