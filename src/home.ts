import type { SessionUser } from './auth'

export function homeFor(role: SessionUser['role']) {
  if (role === 'admin') return '/monitor'
  if (role === 'provider') return '/provider'
  return '/studio'
}
