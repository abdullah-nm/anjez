import type { EmbeddingProvider, LlmProvider } from '../types.ts'
import { MissingProviderError } from '../lib/errors.ts'
import { noteProviderAttempt, providerFailureCode } from '../observability/attempts.ts'
import { noteGeminiFailure, noteGeminiUsage } from '../observability/context.ts'

const GEMINI_ROOT = 'https://generativelanguage.googleapis.com/v1beta'
const TEXT_FALLBACKS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash']
const IMAGE_FALLBACKS = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-2.5-flash-image',
]

function redactSecrets(detail: string) {
  return detail
    .replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]')
    .replace(/key=[^&\s"]+/gi, 'key=[redacted]')
}

function sanitizeGeminiDetail(detail: string) {
  return detail
    .slice(0, 180)
    .replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]')
    .replace(/key=[^&\s"]+/gi, 'key=[redacted]')
}

function geminiResponseMessage(raw: string) {
  let message = raw
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } }
    if (typeof parsed.error?.message === 'string') message = parsed.error.message
  } catch {
    // Gemini sometimes returns a non-JSON error body.
  }
  return redactSecrets(message)
}

export function suggestedModelFromGeminiError(raw: string) {
  return raw.match(/use models\/([A-Za-z0-9._-]+)/i)?.[1] ?? null
}

function l2Normalize(values: number[]) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1
  return values.map((value) => value / norm)
}

function modelPath(model: string) {
  return model.startsWith('models/') ? model.slice(7) : model
}

function modelFromPath(path: string) {
  const match = /models\/([^:/?]+)/.exec(path)
  return (match?.[1] || 'unknown').slice(0, 80)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function geminiPost(
  apiKey: string,
  path: string,
  body: unknown,
  code: 'LLM_UNAVAILABLE' | 'EMBEDDINGS_UNAVAILABLE' | 'IMAGE_GENERATION_UNAVAILABLE',
) {
  const started = Date.now()
  const model = modelFromPath(path)
  let response: Response
  try {
    response = await fetch(`${GEMINI_ROOT}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    noteProviderAttempt({
      model,
      httpStatus: 0,
      durationMs: Date.now() - started,
      failureCode: 'UNAVAILABLE',
    })
    throw error
  }
  const raw = await response.text()
  noteProviderAttempt({
    model,
    httpStatus: response.status,
    durationMs: Date.now() - started,
    failureCode: response.ok ? null : providerFailureCode(response.status),
  })
  if (!response.ok) {
    noteGeminiFailure(response.status, 'http')
    const error = new MissingProviderError(code, `فشل Gemini (${response.status}). ${sanitizeGeminiDetail(raw)}`)
    ;(error as MissingProviderError & { status?: number; raw?: string }).status = response.status
    ;(error as MissingProviderError & { raw?: string }).raw = raw
    throw error
  }
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>
    noteGeminiUsage(payload)
    return payload
  } catch {
    noteGeminiFailure(undefined, 'bad_response')
    throw new MissingProviderError(code, 'رد Gemini ليس JSON صالحاً.')
  }
}

async function generateContentWithFailover(
  apiKey: string,
  preferred: string,
  body: unknown,
  fallbacks: string[],
  cache: { model: string | null },
  code: 'LLM_UNAVAILABLE' | 'IMAGE_GENERATION_UNAVAILABLE',
) {
  const queue = [cache.model, preferred, ...fallbacks].filter((model): model is string => Boolean(model))
  const tried = new Set<string>()
  let last: MissingProviderError | null = null

  for (const model of queue) {
    const name = modelPath(model)
    if (tried.has(name)) continue
    tried.add(name)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const payload = await geminiPost(apiKey, `models/${name}:generateContent`, body, code)
        cache.model = name
        return payload
      } catch (error) {
        if (!(error instanceof MissingProviderError)) throw error
        last = error
        const status = (error as MissingProviderError & { status?: number }).status
        const raw = (error as MissingProviderError & { raw?: string }).raw || ''
        if (code === 'IMAGE_GENERATION_UNAVAILABLE' && typeof status === 'number') {
          console.error(
            `Gemini image request failed status=${status} model=${name} message=${geminiResponseMessage(raw)}`,
          )
        }
        if (status === 404) {
          const suggested = suggestedModelFromGeminiError(raw)
          if (suggested && !tried.has(suggested)) queue.push(suggested)
          break
        }
        if (status === 429 || status === 503) {
          if (code === 'IMAGE_GENERATION_UNAVAILABLE') break
          await sleep(400 * 2 ** attempt)
          continue
        }
        if (code === 'IMAGE_GENERATION_UNAVAILABLE' && (status === 401 || status === 403)) {
          throw new MissingProviderError(
            'IMAGE_GENERATION_UNAVAILABLE',
            'تحقق من صلاحية GEMINI_API_KEY وإتاحة نموذج الصور للمشروع.',
          )
        }
        throw error
      }
    }
  }
  throw last ?? new MissingProviderError(code, 'فشل Gemini.')
}

const textModelCache = { model: null as string | null }
const imageModelCache = { model: null as string | null }

export class GeminiTextClient {
  constructor(
    private readonly apiKey: string | null,
    private readonly model = 'gemini-3.8-flash',
  ) {}

  configured() {
    return Boolean(this.apiKey)
  }

  async generateJson(prompt: string) {
    if (!this.apiKey) {
      noteGeminiFailure(undefined, 'unconfigured')
      throw new MissingProviderError(
        'LLM_UNAVAILABLE',
        'مزود Gemini غير مضبوط. ضع GEMINI_API_KEY في الخادم.',
      )
    }
    const payload = await generateContentWithFailover(
      this.apiKey,
      this.model,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
      },
      TEXT_FALLBACKS,
      textModelCache,
      'LLM_UNAVAILABLE',
    )
    return extractText(payload)
  }
}

export class GeminiLlm implements LlmProvider {
  readonly name = 'gemini'

  constructor(
    private readonly options: {
      apiKey: string | null
      model: string
    },
  ) {}

  async complete(input: { system: string; user: string }) {
    if (!this.options.apiKey) {
      noteGeminiFailure(undefined, 'unconfigured')
      throw new MissingProviderError(
        'LLM_UNAVAILABLE',
        'مزود Gemini غير مضبوط. ضع GEMINI_API_KEY في الخادم.',
      )
    }
    const payload = await generateContentWithFailover(
      this.options.apiKey,
      this.options.model,
      {
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: 'user', parts: [{ text: input.user }] }],
        generationConfig: { temperature: 0 },
      },
      TEXT_FALLBACKS,
      textModelCache,
      'LLM_UNAVAILABLE',
    )
    return extractText(payload).trim()
  }
}

export class GeminiEmbeddings implements EmbeddingProvider {
  readonly name = 'gemini'

  constructor(
    private readonly options: {
      apiKey: string | null
      model: string
      dimensions: number
    },
  ) {}

  get dimensions() {
    return this.options.dimensions
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.options.apiKey) {
      noteGeminiFailure(undefined, 'unconfigured')
      throw new MissingProviderError(
        'EMBEDDINGS_UNAVAILABLE',
        'مزود التضمين غير مضبوط. ضع GEMINI_API_KEY أو EMBEDDING_API_KEY ثم أعد الفهرسة.',
      )
    }
    if (texts.length === 0) return []

    const model = `models/${modelPath(this.options.model)}`
    const batches: number[][] = []
    const size = 16
    for (let i = 0; i < texts.length; i += size) {
      const slice = texts.slice(i, i + size)
      let last: unknown = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const payload = await geminiPost(
            this.options.apiKey,
            `${model}:batchEmbedContents`,
            {
              requests: slice.map((text) => ({
                model,
                content: { parts: [{ text }] },
                outputDimensionality: this.options.dimensions,
              })),
            },
            'EMBEDDINGS_UNAVAILABLE',
          )
          const embeddings = (payload.embeddings as { values?: number[] }[] | undefined) || []
          if (embeddings.length !== slice.length) {
            throw new MissingProviderError(
              'EMBEDDINGS_UNAVAILABLE',
              'عدد متجهات Gemini لا يطابق عدد المقاطع.',
            )
          }
          for (const row of embeddings) {
            const values = row.values || []
            if (values.length !== this.options.dimensions) {
              throw new MissingProviderError(
                'EMBEDDINGS_UNAVAILABLE',
                `أبعاد Gemini (${values.length}) لا تطابق EMBEDDING_DIMENSIONS (${this.options.dimensions}).`,
              )
            }
            batches.push(this.options.dimensions === 3072 ? values : l2Normalize(values))
          }
          last = null
          break
        } catch (error) {
          last = error
          const status = (error as { status?: number }).status
          if (status === 429 || status === 503) {
            await sleep(400 * 2 ** attempt)
            continue
          }
          if (error instanceof MissingProviderError) throw error
          throw error
        }
      }
      if (last) throw last
    }
    return batches
  }
}

export class GeminiImageClient {
  constructor(
    private readonly apiKey: string | null,
    private readonly model = 'gemini-3.1-flash-image',
  ) {}

  configured() {
    return Boolean(this.apiKey)
  }

  async generatePngDataUrl(
    prompt: string,
    referenceImage?: { mimeType: string; data: string } | null,
  ) {
    if (!this.apiKey) {
      noteGeminiFailure(undefined, 'unconfigured')
      throw new MissingProviderError(
        'IMAGE_GENERATION_UNAVAILABLE',
        'توليد الصور عبر Gemini غير مضبوط.',
      )
    }
    const parts: Array<Record<string, unknown>> = [{ text: prompt }]
    if (referenceImage?.data && referenceImage.mimeType) {
      parts.push({
        inlineData: {
          mimeType: referenceImage.mimeType,
          data: referenceImage.data,
        },
      })
    }
    const payload = await generateContentWithFailover(
      this.apiKey,
      this.model,
      {
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      },
      IMAGE_FALLBACKS,
      imageModelCache,
      'IMAGE_GENERATION_UNAVAILABLE',
    )
    const candidates = payload.candidates as
      | { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[]
      | undefined
    const inline = candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData
    if (!inline?.data) {
      throw new MissingProviderError(
        'IMAGE_GENERATION_UNAVAILABLE',
        'Gemini لم يُرجع بيانات صورة. تأكد أن GEMINI_IMAGE_MODEL يدعم توليد الصور على هذا الحساب.',
      )
    }
    return `data:${inline.mimeType || 'image/png'};base64,${inline.data}`
  }
}

function extractText(payload: Record<string, unknown>) {
  const candidates = payload.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined
  return candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
}
