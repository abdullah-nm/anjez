import type { Express, Request } from 'express'
import { z } from 'zod'
import { isServiceKey, nextOrderStatus, type OrderAction } from '../../shared/orderFlow.ts'
import type { KnowledgeStore } from '../store.ts'
import { AppError } from '../lib/errors.ts'
import type { SessionUser } from '../types.ts'
import type { PlatformStore } from './store.ts'

const providerBody = z.object({
  kind: z.enum(['shop', 'individual']),
  displayName: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(5).max(30),
  services: z.array(z.string()).min(1).max(8),
})

export function registerFulfillmentRoutes(
  app: Express,
  deps: {
    platform: PlatformStore
    store: KnowledgeStore
    requireUser: (req: Request) => Promise<SessionUser>
  },
) {
  app.get('/api/provider/me', async (req, res, next) => {
    try {
      const user = await requireProvider(deps, req)
      const profile = deps.platform.getProvider(user.id)
      if (!profile) throw new AppError('ملف مقدم الخدمة غير موجود.', 404, 'NOT_FOUND')
      res.json({ profile: publicProvider(profile, user) })
    } catch (error) {
      next(error)
    }
  })

  app.put('/api/provider/me', async (req, res, next) => {
    try {
      const user = await requireProvider(deps, req)
      const body = parseProvider(req.body)
      const ok = deps.platform.updateProviderProfile({
        userId: user.id,
        kind: body.kind,
        displayName: body.displayName,
        city: body.city,
        phone: body.phone,
        services: body.services,
        updatedAt: new Date().toISOString(),
      })
      if (!ok) throw new AppError('ملف مقدم الخدمة غير موجود.', 404, 'NOT_FOUND')
      if (body.displayName !== user.name) await deps.store.updateUserName(user.id, body.displayName)
      const profile = deps.platform.getProvider(user.id)
      const fresh = await deps.store.getUserById(user.id)
      res.json({ profile: profile && fresh ? publicProvider(profile, fresh) : null })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/providers', async (req, res, next) => {
    try {
      await requirePlatformAdmin(deps, req)
      const rows = []
      for (const profile of deps.platform.listProviders()) {
        const account = await deps.store.getUserById(profile.userId)
        if (!account || account.role !== 'provider') continue
        rows.push(publicProvider(profile, account))
      }
      res.json({ providers: rows })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/providers/:userId', async (req, res, next) => {
    try {
      await requirePlatformAdmin(deps, req)
      const body = z.object({ approval: z.enum(['approved', 'rejected']) }).parse(req.body ?? {})
      const userId = String(req.params.userId)
      const account = await deps.store.getUserById(userId)
      if (!account || account.role !== 'provider') throw new AppError('مقدم الخدمة غير موجود.', 404, 'NOT_FOUND')
      const profile = deps.platform.setProviderApproval(userId, body.approval, new Date().toISOString())
      if (!profile) throw new AppError('مقدم الخدمة غير موجود.', 404, 'NOT_FOUND')
      res.json({ profile: publicProvider(profile, account) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/dispatch/orders', async (req, res, next) => {
    try {
      await requirePlatformAdmin(deps, req)
      res.json({ orders: await presentOrders(deps, deps.platform.listPlatformOrders()) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/provider/orders', async (req, res, next) => {
    try {
      const user = await requireProvider(deps, req)
      const orders = deps.platform.listAssignedOrders(user.id)
      res.json({ orders: await presentOrders(deps, orders) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/dispatch/orders/:companyId/:orderId/assign', async (req, res, next) => {
    try {
      const admin = await requirePlatformAdmin(deps, req)
      const body = z.object({ providerUserId: z.string().trim().min(1).max(80) }).parse(req.body ?? {})
      const order = deps.platform.getOrder(String(req.params.companyId), String(req.params.orderId))
      if (!order) throw new AppError('الطلب غير موجود.', 404, 'NOT_FOUND')
      const provider = await approvedProvider(deps, body.providerUserId)
      if (!provider.services.includes(order.serviceKey)) {
        throw new AppError('مقدم الخدمة لا يقدّم الخدمة المطلوبة لهذا الطلب.', 409, 'SERVICE_MISMATCH')
      }
      const toStatus = nextOrderStatus(order.status, 'assign')
      if (!toStatus) throw new AppError('لا يمكن إسناد الطلب في حالته الحالية.', 409, 'INVALID_TRANSITION')
      const at = new Date().toISOString()
      const ok = deps.platform.applyOrderTransition({
        companyId: order.companyId,
        orderId: order.id,
        fromStatus: order.status,
        toStatus,
        providerUserId: provider.userId,
        note: '',
        actorId: admin.id,
        at,
      })
      if (!ok) throw new AppError('تغيّرت حالة الطلب. حدّث الصفحة ثم أعد المحاولة.', 409, 'INVALID_TRANSITION')
      const next = deps.platform.getOrder(order.companyId, order.id)
      res.json({ order: next ? (await presentOrders(deps, [next]))[0] : null })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/provider/orders/:companyId/:orderId/transition', async (req, res, next) => {
    try {
      const user = await requireProvider(deps, req)
      const profile = deps.platform.getProvider(user.id)
      if (!profile || profile.approval !== 'approved') {
        throw new AppError('حساب مقدم الخدمة بانتظار اعتماد أدمن المنصة.', 403, 'PROVIDER_PENDING')
      }
      const body = z.object({
        action: z.enum(['accept', 'reject', 'start', 'complete']),
        note: z.string().trim().max(200).optional(),
      }).parse(req.body ?? {})
      const order = deps.platform.getOrder(String(req.params.companyId), String(req.params.orderId))
      if (!order || order.providerUserId !== user.id) throw new AppError('الطلب غير موجود.', 404, 'NOT_FOUND')
      const action = body.action as OrderAction
      const toStatus = nextOrderStatus(order.status, action)
      if (!toStatus) throw new AppError('لا يمكن نقل الطلب إلى هذه الحالة.', 409, 'INVALID_TRANSITION')
      const at = new Date().toISOString()
      const ok = deps.platform.applyOrderTransition({
        companyId: order.companyId,
        orderId: order.id,
        fromStatus: order.status,
        toStatus,
        providerUserId: order.providerUserId,
        note: action === 'reject' ? (body.note || '') : '',
        actorId: user.id,
        at,
      })
      if (!ok) throw new AppError('تغيّرت حالة الطلب. حدّث الصفحة ثم أعد المحاولة.', 409, 'INVALID_TRANSITION')
      const next = deps.platform.getOrder(order.companyId, order.id)
      res.json({ order: next ? (await presentOrders(deps, [next]))[0] : null })
    } catch (error) {
      next(error)
    }
  })
}

function parseProvider(body: unknown) {
  const parsed = providerBody.parse(body ?? {})
  const services = [...new Set(parsed.services)]
  if (!services.every(isServiceKey)) throw new AppError('اختر خدمة من القائمة.', 400, 'INVALID_SERVICE')
  return { ...parsed, services }
}

async function requirePlatformAdmin(deps: { requireUser: (req: Request) => Promise<SessionUser> }, req: Request) {
  const user = await deps.requireUser(req)
  if (user.role !== 'admin') throw new AppError('هذه العملية لأدمن المنصة فقط.', 403, 'FORBIDDEN')
  return user
}

async function requireProvider(deps: { requireUser: (req: Request) => Promise<SessionUser> }, req: Request) {
  const user = await deps.requireUser(req)
  if (user.role !== 'provider') throw new AppError('هذه العملية لحساب مقدم الخدمة.', 403, 'FORBIDDEN')
  return user
}

async function approvedProvider(deps: { platform: PlatformStore, store: KnowledgeStore }, userId: string) {
  const account = await deps.store.getUserById(userId)
  const profile = deps.platform.getProvider(userId)
  if (!account || account.role !== 'provider' || !profile) throw new AppError('مقدم الخدمة غير موجود.', 404, 'NOT_FOUND')
  if (profile.approval !== 'approved') throw new AppError('لا يمكن إسناد طلب إلى مقدم خدمة غير معتمد.', 409, 'PROVIDER_PENDING')
  return profile
}

async function presentOrders(
  deps: { platform: PlatformStore, store: KnowledgeStore },
  orders: ReturnType<PlatformStore['listPlatformOrders']>,
) {
  const providers = new Map<string, string>()
  const companies = new Map<string, string>()
  const presented = []
  for (const order of orders) {
    if (order.providerUserId && !providers.has(order.providerUserId)) {
      providers.set(order.providerUserId, deps.platform.getProvider(order.providerUserId)?.displayName ?? '')
    }
    if (!companies.has(order.companyId)) {
      const account = await deps.store.getUserById(order.userId)
      companies.set(order.companyId, account?.companyName || '')
    }
    presented.push({
      companyId: order.companyId,
      companyName: companies.get(order.companyId) || '',
      id: order.id,
      userName: order.userName,
      productId: order.productId,
      status: order.status,
      quantity: order.quantity,
      deliveryDate: order.deliveryDate,
      deliveryCity: order.deliveryCity,
      serviceKey: order.serviceKey,
      providerUserId: order.providerUserId,
      providerName: order.providerUserId ? providers.get(order.providerUserId) || '' : '',
      statusNote: order.statusNote,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      events: deps.platform.listOrderEvents(order.companyId, order.id).map((event) => ({
        id: event.id,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        note: event.note,
        createdAt: event.created_at,
      })),
    })
  }
  return presented
}

export function publicProvider(
  profile: NonNullable<ReturnType<PlatformStore['getProvider']>>,
  account: SessionUser,
) {
  return {
    userId: profile.userId,
    email: account.email,
    kind: profile.kind,
    displayName: profile.displayName,
    city: profile.city,
    phone: profile.phone,
    services: profile.services,
    approval: profile.approval,
  }
}

export { parseProvider }
