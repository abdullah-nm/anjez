import type { Request } from 'express'
import { hashPassword, newId, signSession, unsignSession, verifyPassword } from './lib/crypto.ts'
import { AppError } from './lib/errors.ts'
import type { KnowledgeStore } from './store.ts'
import type { SessionUser } from './types.ts'

export const SESSION_COOKIE = 'anjz_session'

export async function loginUser(
  store: KnowledgeStore,
  email: string,
  password: string,
  secret: string,
  ttlMs: number,
) {
  const typed = email.trim()
  if (!typed) throw new AppError('أدخل البريد الإلكتروني.', 400, 'EMAIL_REQUIRED')
  if (!password) throw new AppError('أدخل كلمة المرور.', 400, 'PASSWORD_REQUIRED')
  const user = await store.getUserByEmail(typed)
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AppError('البريد أو كلمة المرور غير صحيحة.', 401, 'INVALID_CREDENTIALS')
  }
  const exp = Date.now() + ttlMs
  const epoch = await store.sessionEpoch(user.id)
  const token = signSession(JSON.stringify({ sub: user.id, exp, epoch }), secret)
  const { passwordHash: _, ...session } = user
  void _
  return { token, user: session }
}

export async function registerCompany(
  store: KnowledgeStore,
  input: { companyName: string, email: string, password: string, confirm: string },
  secret: string,
  ttlMs: number,
) {
  const companyName = input.companyName.trim()
  const email = input.email.trim().toLowerCase()
  if (companyName.length < 2 || companyName.length > 80) {
    throw new AppError('أدخل اسم الشركة بين حرفين وثمانين حرفًا.', 400, 'INVALID_NAME')
  }
  if (!email) throw new AppError('أدخل البريد الإلكتروني.', 400, 'EMAIL_REQUIRED')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw new AppError('البريد الإلكتروني غير صالح.', 400, 'INVALID_EMAIL')
  }
  if (!input.password) throw new AppError('أدخل كلمة المرور.', 400, 'PASSWORD_REQUIRED')
  if (input.password.length < 8 || input.password.length > 200) {
    throw new AppError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.', 400, 'WEAK_PASSWORD')
  }
  if (input.password !== input.confirm) {
    throw new AppError('تأكيد كلمة المرور غير مطابق.', 400, 'PASSWORD_MISMATCH')
  }
  const companyId = newId('company')
  const userId = newId('user')
  await store.createCompanyAccount({
    companyId,
    companyName,
    userId,
    email,
    name: companyName,
    passwordHash: hashPassword(input.password),
  })
  const created = await store.getUserById(userId)
  if (!created || created.role !== 'member' || created.companyId !== companyId || created.companyName !== companyName) {
    throw new AppError('تعذر حفظ حساب الشركة.', 500, 'REGISTER_FAILED')
  }
  return loginUser(store, email, input.password, secret, ttlMs)
}

export async function registerProvider(
  store: KnowledgeStore,
  input: { displayName: string, email: string, password: string, confirm: string },
  secret: string,
  ttlMs: number,
) {
  const displayName = input.displayName.trim()
  const email = input.email.trim().toLowerCase()
  if (displayName.length < 2 || displayName.length > 80) {
    throw new AppError('أدخل الاسم بين حرفين وثمانين حرفًا.', 400, 'INVALID_NAME')
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw new AppError('البريد الإلكتروني غير صالح.', 400, 'INVALID_EMAIL')
  }
  if (!input.password || input.password.length < 8 || input.password.length > 200) {
    throw new AppError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.', 400, 'WEAK_PASSWORD')
  }
  if (input.password !== input.confirm) {
    throw new AppError('تأكيد كلمة المرور غير مطابق.', 400, 'PASSWORD_MISMATCH')
  }
  const userId = newId('user')
  await store.createProviderAccount({
    userId,
    email,
    name: displayName,
    passwordHash: hashPassword(input.password),
  })
  const created = await store.getUserById(userId)
  if (!created || created.role !== 'provider' || created.companyId) {
    await store.deleteUser(userId)
    throw new AppError('تعذر حفظ حساب مقدم الخدمة.', 500, 'REGISTER_FAILED')
  }
  return { userId, session: await loginUser(store, email, input.password, secret, ttlMs) }
}

export async function userFromRequest(
  store: KnowledgeStore,
  req: Request,
  secret: string,
): Promise<SessionUser | null> {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return null
  const payload = unsignSession(token, secret)
  if (!payload) return null
  try {
    const parsed = JSON.parse(payload) as { sub?: string; exp?: number; epoch?: number }
    if (!parsed.sub || !parsed.exp || parsed.exp < Date.now()) return null
    const user = await store.getUserById(parsed.sub)
    if (!user) return null
    const epoch = await store.sessionEpoch(user.id)
    if ((parsed.epoch ?? 0) !== epoch) return null
    return user
  } catch {
    return null
  }
}

export function requireRole(user: SessionUser, role: 'admin' | 'member' = 'member') {
  if (role === 'admin' && user.role !== 'admin') {
    throw new AppError('صلاحية غير كافية لإدارة المعرفة.', 403, 'FORBIDDEN')
  }
}
