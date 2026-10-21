import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { AppError } from '../lib/errors.ts'

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const GEMINI_INLINE = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_LOGO_BYTES = 2 * 1024 * 1024

export function companyLogoDir(companyId: string) {
  return `logos/${companyId.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

export function logoBelongsToCompany(companyId: string, relative: string | null | undefined) {
  if (!relative) return false
  const normalized = relative.replace(/\\/g, '/').replace(/^\/+/, '')
  const prefix = `${companyLogoDir(companyId)}/`
  return normalized.startsWith(prefix) && !normalized.includes('..')
}

export function sniffLogoMime(buffer: Buffer) {
  if (buffer.byteLength >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png'
  }
  if (buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.byteLength >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  const head = buffer.toString('utf8', 0, Math.min(256, buffer.byteLength)).trim().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'image/svg+xml'
  }
  return null
}

export type StoredObject = { path: string; mime: string; bytes: number }

export function validateLogo(mime: string, size: number) {
  if (!ALLOWED.has(mime)) {
    throw new AppError('صيغة الشعار غير مدعومة. استخدم PNG أو JPEG أو WebP أو SVG.', 400, 'LOGO_TYPE')
  }
  if (size > MAX_LOGO_BYTES) {
    throw new AppError('حجم الشعار يتجاوز 2 ميغابايت.', 400, 'LOGO_TOO_LARGE')
  }
}

export class LocalObjectStorage {
  constructor(private root: string) {}

  saveLogo(companyId: string, mime: string, buffer: Buffer): StoredObject {
    validateLogo(mime, buffer.byteLength)
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/svg+xml' ? 'svg' : 'jpg'
    const relative = `${companyLogoDir(companyId)}/logo.${ext}`
    const abs = join(this.root, relative)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, buffer)
    return { path: relative, mime, bytes: buffer.byteLength }
  }

  absolute(relative: string) {
    const root = resolve(this.root)
    const abs = resolve(root, relative)
    const prefix = root.endsWith(sep) ? root : root + sep
    if (abs !== root && !abs.startsWith(prefix)) return null
    if (!existsSync(abs)) return null
    return abs
  }

  stream(relative: string) {
    const abs = this.absolute(relative)
    if (!abs) return null
    return createReadStream(abs)
  }

  read(relative: string) {
    const abs = this.absolute(relative)
    if (!abs) return null
    return { abs, exists: true }
  }

  remove(relative: string) {
    const abs = this.absolute(relative)
    if (abs) unlinkSync(abs)
  }

  /** Reads a logo only if the stored path belongs to this company. Never trusts a client path. */
  readCompanyLogo(companyId: string, relative: string | null, claimedMime: string | null) {
    if (!relative) {
      return { ok: false as const, reason: 'لا يوجد شعار محفوظ في ملف الهوية.' }
    }
    if (!logoBelongsToCompany(companyId, relative)) {
      return { ok: false as const, reason: 'مسار الشعار لا يخص هذه الشركة.' }
    }
    const abs = this.absolute(relative)
    if (!abs) {
      return { ok: false as const, reason: 'تعذر قراءة ملف الشعار من التخزين.' }
    }
    const buffer = readFileSync(abs)
    const sniffed = sniffLogoMime(buffer)
    const mime = sniffed || claimedMime
    if (!mime || !ALLOWED.has(mime)) {
      return { ok: false as const, reason: 'تعذر التحقق من صيغة ملف الشعار.' }
    }
    if (sniffed && claimedMime && sniffed !== claimedMime) {
      return { ok: false as const, reason: 'نوع ملف الشعار لا يطابق الامتداد المحفوظ.' }
    }
    try {
      validateLogo(mime, buffer.byteLength)
    } catch (error) {
      return {
        ok: false as const,
        reason: error instanceof AppError ? error.message : 'صيغة أو حجم الشعار غير صالح.',
      }
    }
    return {
      ok: true as const,
      mime,
      buffer,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      geminiInline: GEMINI_INLINE.has(mime),
    }
  }
}

/** Optional Supabase Storage via REST. Used only when URL + service role are set. */
export async function uploadToSupabase(input: {
  url: string
  serviceKey: string
  bucket: string
  path: string
  mime: string
  buffer: Buffer
}) {
  const endpoint = `${input.url.replace(/\/$/, '')}/storage/v1/object/${input.bucket}/${input.path}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.serviceKey}`,
      apikey: input.serviceKey,
      'Content-Type': input.mime,
      'x-upsert': 'true',
    },
    body: new Uint8Array(input.buffer),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 160)
    throw new AppError(`تعذر رفع الشعار إلى Supabase (${response.status}). ${detail}`, 502, 'SUPABASE_UPLOAD')
  }
}
