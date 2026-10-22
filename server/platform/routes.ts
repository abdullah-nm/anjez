import type { Express, Request } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { requireRole } from '../auth.ts'
import type { AppConfig } from '../config.ts'
import { newId } from '../lib/crypto.ts'
import { AppError } from '../lib/errors.ts'
import type { ImageGenerator } from '../lib/imageGeneration.ts'
import type { LlmProvider, SessionUser } from '../types.ts'
import { composeDesign, previewTemplate } from './compose.ts'
import { noteMetric } from '../observability/context.ts'
import { GeminiImageClient, GeminiTextClient } from './gemini.ts'
import { applyCalendarUpdate, isSystemEventId, publicSystemOccasion, syncSystemOccasions } from './calendarSync.ts'
import { occasionByKey, occasionCatalog, reminderOffsets, riyadhYmd, suggestedProducts } from './occasions.ts'
import { dispatchDueReminders } from './reminders.ts'
import { LocalObjectStorage, uploadToSupabase } from './storage.ts'
import type { PlatformStore } from './store.ts'
import type { BrandProfile, DateCertainty } from './types.ts'

const brandSchema = z.object({
  companyName: z.string().trim().min(2).max(80),
  industry: z.string().trim().max(80).default(''),
  description: z.string().trim().max(800).default(''),
  language: z.enum(['ar', 'en']).default('ar'),
  contactName: z.string().trim().max(80).default(''),
  email: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(40).default(''),
  city: z.string().trim().max(80).default(''),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  slogan: z.string().trim().max(120).default(''),
  tone: z.string().trim().max(40).default('فاخر'),
})

const eventSchema = z.object({
  title: z.string().trim().min(2).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  description: z.string().trim().max(1000).default(''),
  category: z.string().trim().min(2).max(40),
  audience: z.string().trim().max(200).default(''),
  status: z.enum(['planned', 'confirmed', 'done']).default('planned'),
  reminderDays: z.array(z.number().int()).default([30, 14, 7, 3, 1]),
  occasionKey: z.string().trim().max(80).nullable().optional(),
  recurring: z.boolean().default(false),
  dateCertainty: z.enum(['official', 'estimated', 'unannounced']).optional(),
  dateNote: z.string().trim().max(400).default(''),
})

const composeSchema = z.object({
  eventId: z.string().nullable().optional(),
  eventTitle: z.string().trim().max(120).default(''),
  productId: z.string().trim().min(1),
  productName: z.string().trim().min(1),
  purpose: z.string().trim().max(200).default(''),
  audience: z.string().trim().max(200).default(''),
  language: z.enum(['ar', 'en']).default('ar'),
  style: z.string().trim().max(80).default(''),
  dimensions: z.string().trim().max(40).default('square'),
  size: z.string().trim().max(40).default(''),
  instructions: z.string().trim().max(600).default(''),
  content: z.string().trim().max(800).default(''),
})

export function registerPlatformRoutes(
  app: Express,
  deps: {
    config: AppConfig
    platform: PlatformStore
    storage: LocalObjectStorage
    llm: LlmProvider
    images: ImageGenerator
    requireUser: (req: Request) => Promise<SessionUser>
  },
) {
  const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })
  const geminiText = new GeminiTextClient(deps.config.geminiApiKey, deps.config.geminiTextModel)
  const geminiImage = new GeminiImageClient(deps.config.geminiApiKey, deps.config.geminiImageModel)
  const composeHits = new Map<string, number[]>()

  app.get('/api/platform/meta', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      const calendarSync = syncSystemOccasions(deps.platform)
      dispatchDueReminders(deps.platform)
      const systemOccasions = deps.platform.listSystemOccasions().map(publicSystemOccasion)
      res.json({
        timezone: 'Asia/Riyadh',
        timezoneNote: 'Event dates are calendar days in Saudi Arabia (UTC+3).',
        occasions: systemOccasions,
        systemOccasions,
        calendarSync,
        reminderOffsets,
        unread: deps.platform.unreadCount(user.companyId, user.id),
        supabaseConfigured: Boolean(deps.config.supabaseUrl && deps.config.supabaseServiceKey),
        geminiConfigured: Boolean(deps.config.geminiApiKey),
        emailConfigured: Boolean(deps.config.smtpUrl),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/brand', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      res.json({ brand: ensureBrand(deps.platform, user) })
    } catch (error) {
      next(error)
    }
  })

  app.put('/api/brand', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      requireRole(user, 'admin')
      const body = brandSchema.parse(req.body ?? {})
      const current = ensureBrand(deps.platform, user)
      const next: BrandProfile = {
        ...current,
        ...body,
        companyId: user.companyId,
        logoPath: current.logoPath,
        logoMime: current.logoMime,
        updatedAt: new Date().toISOString(),
      }
      deps.platform.upsertBrand(next)
      res.json({ brand: next })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/brand/logo', logoUpload.single('file'), async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      requireRole(user, 'admin')
      const file = req.file
      if (!file) throw new AppError('ارفع ملف شعار.', 400, 'FILE_REQUIRED')
      const stored = deps.storage.saveLogo(user.companyId, file.mimetype, file.buffer)
      if (deps.config.supabaseUrl && deps.config.supabaseServiceKey) {
        await uploadToSupabase({
          url: deps.config.supabaseUrl,
          serviceKey: deps.config.supabaseServiceKey,
          bucket: deps.config.supabaseBucket,
          path: stored.path,
          mime: stored.mime,
          buffer: file.buffer,
        })
      }
      const brand = ensureBrand(deps.platform, user)
      brand.logoPath = stored.path
      brand.logoMime = stored.mime
      brand.updatedAt = new Date().toISOString()
      deps.platform.upsertBrand(brand)
      res.json({ brand })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/brand/logo', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      requireRole(user, 'admin')
      const brand = ensureBrand(deps.platform, user)
      if (brand.logoPath) deps.storage.remove(brand.logoPath)
      brand.logoPath = null
      brand.logoMime = null
      brand.updatedAt = new Date().toISOString()
      deps.platform.upsertBrand(brand)
      res.json({ brand })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/brand/logo', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      const brand = deps.platform.getBrand(user.companyId)
      if (!brand?.logoPath) throw new AppError('لا يوجد شعار.', 404, 'NO_LOGO')
      const logo = deps.storage.readCompanyLogo(user.companyId, brand.logoPath, brand.logoMime)
      if (!logo.ok) throw new AppError(logo.reason, 404, 'NO_LOGO')
      const stream = deps.storage.stream(brand.logoPath)
      if (!stream) throw new AppError('الملف غير موجود.', 404, 'NO_LOGO')
      res.setHeader('Content-Type', brand.logoMime || 'application/octet-stream')
      res.setHeader('Cache-Control', 'private, no-store')
      stream.pipe(res)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/events', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      const calendarSync = syncSystemOccasions(deps.platform)
      dispatchDueReminders(deps.platform)
      const hidden = new Set(occasionCatalog.map((item) => item.key))
      const events = deps.platform.listEvents(user.companyId).filter((event) => !event.occasionKey || !hidden.has(event.occasionKey))
      res.json({
        events,
        systemOccasions: deps.platform.listSystemOccasions().map(publicSystemOccasion),
        calendarSync,
        timezone: 'Asia/Riyadh',
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/events', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      requireRole(user, 'admin')
      const body = eventSchema.parse(req.body ?? {})
      const timing = eventTiming(body)
      if (body.occasionKey && occasionByKey(body.occasionKey)) {
        throw new AppError('هذه المناسبة عامة وتظهر تلقائياً في التقويم.', 409, 'SYSTEM_OCCASION')
      }
      if (body.occasionKey && deps.platform.activeOccasion(user.companyId, body.occasionKey)) {
        throw new AppError('هذه المناسبة مضافة لتقويم الشركة.', 409, 'OCCASION_EXISTS')
      }
      const now = new Date().toISOString()
      const event = {
        id: newId('evt'),
        companyId: user.companyId,
        title: body.title,
        date: timing.date,
        time: body.time ?? null,
        description: body.description,
        category: body.category,
        audience: body.audience,
        status: body.status,
        reminderDays: allowedReminders(body.reminderDays),
        occasionKey: body.occasionKey ?? null,
        recurring: body.recurring,
        dateCertainty: timing.dateCertainty,
        dateNote: timing.dateNote,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      }
      deps.platform.insertEvent(event)
      res.status(201).json({ event })
    } catch (error) {
      next(error)
    }
  })

  app.put('/api/events/:id', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      requireRole(user, 'admin')
      if (isSystemEventId(String(req.params.id))) {
        throw new AppError('مناسبات النظام لا تُعدَّل من حساب الشركة.', 403, 'SYSTEM_OCCASION')
      }
      const body = eventSchema.parse(req.body ?? {})
      const timing = eventTiming(body)
      const patch = {
        ...body,
        date: timing.date,
        time: body.time ?? null,
        reminderDays: allowedReminders(body.reminderDays),
        dateCertainty: timing.dateCertainty,
        dateNote: timing.dateNote,
      }
      if (patch.occasionKey === undefined) delete patch.occasionKey
      const event = deps.platform.updateEvent(user.companyId, String(req.params.id), patch)
      if (!event) throw new AppError('المناسبة غير موجودة ضمن شركتك.', 404, 'NOT_FOUND')
      res.json({ event })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/events/from-occasion', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      requireRole(user, 'admin')
      const key = z.object({ key: z.string().trim().min(2).max(80) }).parse(req.body ?? {}).key
      if (!occasionByKey(key)) throw new AppError('القالب غير موجود.', 404, 'NOT_FOUND')
      res.status(409).json({ error: 'هذه المناسبة عامة وتظهر تلقائياً في التقويم.', code: 'SYSTEM_OCCASION' })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/events/:id/annual-date', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      requireRole(user, 'admin')
      if (isSystemEventId(String(req.params.id))) {
        throw new AppError('مناسبات النظام لا تُعدَّل من حساب الشركة.', 403, 'SYSTEM_OCCASION')
      }
      const body = z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dateCertainty: z.enum(['official', 'estimated']),
      }).parse(req.body ?? {})
      const current = deps.platform.getEvent(user.companyId, String(req.params.id))
      if (!current) throw new AppError('المناسبة غير موجودة ضمن شركتك.', 404, 'NOT_FOUND')
      if (current.recurring) throw new AppError('هذا الموعد الميلادي يتجدد تلقائياً كل سنة.', 400, 'FIXED_DATE')
      const today = riyadhYmd()
      if (current.date && current.date < today) {
        deps.platform.updateEvent(user.companyId, current.id, { status: 'done' })
        const now = new Date().toISOString()
        const created = {
          ...current,
          id: newId('evt'),
          date: body.date,
          dateCertainty: body.dateCertainty,
          status: 'planned' as const,
          createdAt: now,
          updatedAt: now,
        }
        deps.platform.insertEvent(created)
        res.status(201).json({ event: created, previousId: current.id })
        return
      }
      const event = deps.platform.updateEvent(user.companyId, current.id, {
        date: body.date,
        dateCertainty: body.dateCertainty,
      })
      res.json({ event, previousId: null })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/events/:id', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      requireRole(user, 'admin')
      if (isSystemEventId(String(req.params.id))) {
        throw new AppError('مناسبات النظام لا تُعدَّل من حساب الشركة.', 403, 'SYSTEM_OCCASION')
      }
      const ok = deps.platform.deleteEvent(user.companyId, String(req.params.id))
      if (!ok) throw new AppError('المناسبة غير موجودة ضمن شركتك.', 404, 'NOT_FOUND')
      res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/designs', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      const eventId = typeof req.query.eventId === 'string' ? req.query.eventId : undefined
      res.json({ designs: deps.platform.listDesigns(user.companyId, eventId) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/designs/preview', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      const body = z.object({
        productName: z.string().trim().max(80).default(''),
        headline: z.string().trim().max(200).default(''),
        subhead: z.string().trim().max(200).default(''),
        body: z.string().trim().max(400).default(''),
        dimensions: z.string().trim().max(40).default('square'),
        size: z.string().trim().max(40).default(''),
      }).parse(req.body ?? {})
      const brand = ensureBrand(deps.platform, user)
      const logo = deps.storage.readCompanyLogo(user.companyId, brand.logoPath, brand.logoMime)
      const svg = previewTemplate({
        brand,
        logoHref: logo.ok ? logo.dataUrl : null,
        productName: body.productName,
        headline: body.headline,
        subhead: body.subhead,
        body: body.body,
        dimensions: body.dimensions,
        size: body.size,
      })
      noteMetric(res, { feature: 'design.preview' })
      res.json({ svg })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/designs/compose', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      const body = composeSchema.parse(req.body ?? {})
      const now = Date.now()
      const recent = (composeHits.get(user.id) ?? []).filter((time) => now - time < 10 * 60 * 1000)
      if (recent.length >= 8) throw new AppError('حد التوليد: 8 طلبات كل 10 دقائق.', 429, 'COMPOSE_RATE_LIMIT')
      composeHits.set(user.id, [...recent, now])
      const linkedEvent = sessionEvent(deps.platform, user.companyId, body.eventId)
      const brand = ensureBrand(deps.platform, user)
      const design = await composeDesign({
        platform: deps.platform,
        storage: deps.storage,
        brand,
        userId: user.id,
        companyId: user.companyId,
        llm: deps.llm,
        geminiText,
        geminiImage,
        payload: {
          eventId: linkedEvent?.id ?? null,
          eventTitle: linkedEvent?.title || body.eventTitle,
          productId: body.productId,
          productName: body.productName,
          purpose: body.purpose,
          audience: body.audience,
          language: body.language,
          style: body.style,
          dimensions: body.dimensions,
          size: body.size,
          instructions: body.instructions,
          content: body.content,
        },
      })
      noteMetric(res, {
        feature: 'design.compose',
        backgroundKind: design.backgroundKind,
      })
      res.status(201).json({ design, suggestions: suggestedProducts(body.purpose || 'custom') })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/designs/:id/status', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      const status = z.enum(['draft', 'approved', 'revision']).parse(req.body?.status)
      const design = deps.platform.updateDesignStatus(user.companyId, String(req.params.id), status)
      if (!design) throw new AppError('التصميم غير موجود ضمن شركتك.', 404, 'NOT_FOUND')
      res.json({ design })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/notifications', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      syncSystemOccasions(deps.platform)
      dispatchDueReminders(deps.platform)
      res.json({
        notifications: deps.platform.listNotifications(user.companyId, user.id),
        unread: deps.platform.unreadCount(user.companyId, user.id),
        reminderDays: deps.platform.reminderPreference(user.companyId, user.id),
      })
    } catch (error) {
      next(error)
    }
  })

  app.put('/api/notifications/preferences', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      const reminderDays = allowedReminders(z.object({
        reminderDays: z.array(z.number().int()).max(5),
      }).parse(req.body ?? {}).reminderDays)
      deps.platform.setReminderPreference(user.companyId, user.id, reminderDays)
      res.json({ reminderDays })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/notifications/:id/read', async (req, res, next) => {
    try {
      const user = await deps.requireUser(req)
      deps.platform.markRead(user.companyId, user.id, String(req.params.id))
      res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/internal/cron/reminders', (req, res, next) => {
    try {
      const secret = deps.config.cronSecret
      if (!secret) throw new AppError('CRON_SECRET غير مضبوط.', 503, 'CRON_UNCONFIGURED')
      const header = req.get('authorization') || ''
      if (header !== `Bearer ${secret}`) throw new AppError('غير مصرح.', 401, 'CRON_FORBIDDEN')
      const calendarSync = syncSystemOccasions(deps.platform)
      res.json({ ...dispatchDueReminders(deps.platform), calendarSync })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/internal/calendar/occasions', (req, res, next) => {
    try {
      const secret = deps.config.cronSecret
      if (!secret) throw new AppError('CRON_SECRET غير مضبوط.', 503, 'CRON_UNCONFIGURED')
      const header = req.get('authorization') || ''
      if (header !== `Bearer ${secret}`) throw new AppError('غير مصرح.', 401, 'CRON_FORBIDDEN')
      const body = z.object({
        key: z.string().trim().min(2).max(80),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        dateCertainty: z.enum(['official', 'estimated', 'unannounced']),
        source: z.string().trim().min(3).max(200),
      }).parse(req.body ?? {})
      const occasion = applyCalendarUpdate(deps.platform, body)
      res.json({ occasion: occasion ? publicSystemOccasion(occasion) : null })
    } catch (error) {
      next(error)
    }
  })
}

function sessionEvent(platform: PlatformStore, companyId: string, eventId?: string | null) {
  const id = eventId?.trim() || ''
  if (!id) return null
  if (isSystemEventId(id)) {
    const occasion = platform.getSystemOccasion(id.slice('sys:'.length))
    if (!occasion) throw new AppError('المناسبة غير موجودة ضمن شركتك.', 404, 'NOT_FOUND')
    return { id, title: occasion.titleAr }
  }
  const event = platform.getEvent(companyId, id)
  if (!event) throw new AppError('المناسبة غير موجودة ضمن شركتك.', 404, 'NOT_FOUND')
  return { id: event.id, title: event.title }
}

function allowedReminders(days: number[]) {
  return days.filter((day) => (reminderOffsets as readonly number[]).includes(day))
}

function eventTiming(body: { date?: string | null, dateCertainty?: DateCertainty, dateNote?: string }) {
  const date = body.date ?? null
  let dateCertainty: DateCertainty = body.dateCertainty ?? (date ? 'official' : 'unannounced')
  if (!date) dateCertainty = 'unannounced'
  if (date && dateCertainty === 'unannounced') {
    throw new AppError('حدّد التاريخ، أو اترك المناسبة بلا موعد.', 400, 'DATE_REQUIRED')
  }
  return { date, dateCertainty, dateNote: body.dateNote ?? '' }
}

function ensureBrand(platform: PlatformStore, user: SessionUser): BrandProfile {
  const existing = platform.getBrand(user.companyId)
  if (existing) return existing
  const brand: BrandProfile = {
    companyId: user.companyId,
    companyName: user.companyName,
    industry: '',
    description: '',
    language: 'ar',
    contactName: user.name,
    email: user.email,
    phone: '',
    city: '',
    primaryColor: '#1f2937',
    accentColor: '#d1d5db',
    slogan: '',
    tone: 'فاخر',
    logoPath: null,
    logoMime: null,
    updatedAt: new Date().toISOString(),
  }
  platform.upsertBrand(brand)
  return brand
}
