import { extname } from 'node:path'
import mammoth from 'mammoth'

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.csv', '.pdf', '.docx', '.html', '.htm'] as const

export type ExtractResult =
  | { ok: true; text: string; mimeType: string }
  | { ok: false; code: 'unsupported'; message: string }

export function isSupportedFilename(filename: string) {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(filename).toLowerCase())
}

export async function extractDocumentText(
  filename: string,
  buffer: Buffer,
  mimeType = '',
): Promise<ExtractResult> {
  const ext = extname(filename).toLowerCase()
  if (!isSupportedFilename(filename)) {
    return {
      ok: false,
      code: 'unsupported',
      message: `نوع الملف غير مدعوم. المسموح: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    }
  }

  try {
    if (ext === '.txt' || ext === '.md' || ext === '.csv') {
      return { ok: true, text: buffer.toString('utf8'), mimeType: mimeType || 'text/plain' }
    }
    if (ext === '.html' || ext === '.htm') {
      return { ok: true, text: stripHtml(buffer.toString('utf8')), mimeType: 'text/html' }
    }
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer })
      return { ok: true, text: result.value, mimeType: mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    }
    if (ext === '.pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      const { text } = await extractText(pdf, { mergePages: true })
      const joined = Array.isArray(text) ? text.join('\n') : text
      return { ok: true, text: joined, mimeType: 'application/pdf' }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر استخراج النص'
    return { ok: false, code: 'unsupported', message: `فشلت معالجة الملف: ${message}` }
  }

  return {
    ok: false,
    code: 'unsupported',
    message: 'نوع الملف غير مدعوم.',
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
