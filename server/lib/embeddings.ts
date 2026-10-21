import type { EmbeddingProvider } from '../types.ts'
import { MissingProviderError } from './errors.ts'

export class OpenAICompatibleEmbeddings implements EmbeddingProvider {
  readonly name = 'openai-compatible'

  constructor(
    private readonly options: {
      apiKey: string | null
      baseUrl: string | null
      model: string
      dimensions: number
    },
  ) {}

  get dimensions() {
    return this.options.dimensions
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.options.apiKey) {
      throw new MissingProviderError(
        'EMBEDDINGS_UNAVAILABLE',
        'مزود التضمين غير مضبوط. ضع GEMINI_API_KEY أو EMBEDDING_API_KEY ثم أعد الفهرسة.',
      )
    }
    if (texts.length === 0) return []

    const batches: number[][] = []
    const size = 32
    for (let i = 0; i < texts.length; i += size) {
      const input = texts.slice(i, i + size)
      const response = await fetch(`${this.options.baseUrl || 'https://api.openai.com/v1'}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          input,
          dimensions: this.options.dimensions,
        }),
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new MissingProviderError(
          'EMBEDDINGS_UNAVAILABLE',
          `فشل مزود التضمين (${response.status}). ${safeProviderMessage(detail)}`,
        )
      }
      const payload = (await response.json()) as {
        data: { embedding: number[]; index: number }[]
      }
      const ordered = [...payload.data].sort((a, b) => a.index - b.index)
      for (const row of ordered) batches.push(row.embedding)
    }
    return batches
  }
}

export class OpenAICompatibleLlm {
  readonly name = 'openai-compatible'

  constructor(
    private readonly options: {
      apiKey: string | null
      baseUrl: string | null
      model: string
    },
  ) {}

  async complete(input: { system: string; user: string }) {
    if (!this.options.apiKey) {
      throw new MissingProviderError(
        'LLM_UNAVAILABLE',
        'مزود اللغة غير مضبوط. ضع GEMINI_API_KEY أو LLM_API_KEY.',
      )
    }
    const response = await fetch(`${this.options.baseUrl || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      }),
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new MissingProviderError(
        'LLM_UNAVAILABLE',
        `فشل مزود اللغة (${response.status}). ${safeProviderMessage(detail)}`,
      )
    }
    const payload = (await response.json()) as {
      choices: { message: { content?: string } }[]
    }
    return payload.choices[0]?.message?.content?.trim() || ''
  }
}

function safeProviderMessage(detail: string) {
  return detail.slice(0, 180).replace(/sk-[a-zA-Z0-9]+/g, '[redacted]')
}
