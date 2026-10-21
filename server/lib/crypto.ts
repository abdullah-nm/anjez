import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(10).toString('hex')}`
}

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const next = scryptSync(password, salt, 32)
  const prev = Buffer.from(hash, 'hex')
  if (next.length !== prev.length) return false
  return timingSafeEqual(next, prev)
}

export function signSession(payload: string, secret: string) {
  const body = Buffer.from(payload).toString('base64url')
  const mac = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function unsignSession(token: string, secret: string) {
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return Buffer.from(body, 'base64url').toString('utf8')
}

export function floatsToBlob(values: number[]) {
  const floats = new Float32Array(values)
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength)
}

export function blobToFloats(value: Buffer | Uint8Array | ArrayBuffer) {
  const bytes =
    value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return Array.from(new Float32Array(copy.buffer))
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length) return 0
  const n = a.length
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
