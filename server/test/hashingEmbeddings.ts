import type { EmbeddingProvider, LlmProvider } from '../types.ts'

/** Test-only embedding function: hashed token counts as unit vectors. Production uses the configured model API. */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'test-hashing'

  constructor(readonly dimensions = 64) {}

  async embed(texts: string[]) {
    return texts.map((text) => {
      const vector = new Array(this.dimensions).fill(0)
      for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
        let hash = 2166136261
        for (const char of token) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
        vector[Math.abs(hash) % this.dimensions] += 1
      }
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
      return vector.map((value) => value / norm)
    })
  }
}

export class ScriptedLlm implements LlmProvider {
  readonly name = 'test-scripted'

  async complete(input: { system: string; user: string }) {
    if (!input.user.includes('[#1')) {
      return 'لا تتوفر معلومة كافية في معرفة الشركة.'
    }
    const files = [...input.user.matchAll(/ملف: (\S+)/g)].map((match) => match[1])
    return `اعتماداً على المقاطع المسترجعة فقط. المصادر: ${files.join(', ')}`
  }
}
