import { MissingProviderError } from './errors.ts'

export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024'

export type ImageGenerationRequest = {
  prompt: string
  size: ImageSize
}

export type ImageGenerator = {
  generate(input: ImageGenerationRequest): Promise<string>
}

export class OpenAICompatibleImageGenerator implements ImageGenerator {
  constructor(
    private readonly options: {
      apiKey: string | null
      baseUrl: string
      model: string
    },
  ) {}

  async generate(input: ImageGenerationRequest) {
    if (!this.options.apiKey) {
      throw new MissingProviderError(
        'IMAGE_GENERATION_UNAVAILABLE',
        'توليد الصور غير مضبوط. أضف IMAGE_API_KEY أو OPENAI_API_KEY إلى ملف .env.',
      )
    }

    const response = await fetch(`${this.options.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        prompt: input.prompt,
        n: 1,
        size: input.size,
        quality: 'medium',
        output_format: 'webp',
      }),
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 180).replace(/sk-[a-zA-Z0-9]+/g, '[redacted]')
      throw new MissingProviderError(
        'IMAGE_GENERATION_UNAVAILABLE',
        `تعذر توليد الصورة (${response.status}). ${detail}`,
      )
    }

    const payload = (await response.json()) as { data?: { b64_json?: string }[] }
    const base64 = payload.data?.[0]?.b64_json
    if (!base64) {
      throw new MissingProviderError(
        'IMAGE_GENERATION_UNAVAILABLE',
        'لم يُرجع مزود الصور صورة صالحة. حاول مرة أخرى.',
      )
    }
    return `data:image/webp;base64,${base64}`
  }
}
