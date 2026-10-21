import type { Request } from 'express'
import { signSession, unsignSession, verifyPassword } from './lib/crypto.ts'
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
  const user = await store.getUserByEmail(email.trim())
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AppError('البريد أو كلمة المرور غير صحيحة.', 401, 'INVALID_CREDENTIALS')
  }
  const exp = Date.now() + ttlMs
  const token = signSession(JSON.stringify({ sub: user.id, exp }), secret)
  const { passwordHash: _, ...session } = user
  void _
  return { token, user: session }
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
    const parsed = JSON.parse(payload) as { sub?: string; exp?: number }
    if (!parsed.sub || !parsed.exp || parsed.exp < Date.now()) return null
    return store.getUserById(parsed.sub)
  } catch {
    return null
  }
}

export function requireRole(user: SessionUser, role: 'admin' | 'member' = 'member') {
  if (role === 'admin' && user.role !== 'admin') {
    throw new AppError('صلاحية غير كافية لإدارة المعرفة.', 403, 'FORBIDDEN')
  }
}
