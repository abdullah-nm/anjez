import type { AppConfig } from '../config.ts'
import type { EmbeddingProvider, LlmProvider } from '../types.ts'
import { OpenAICompatibleEmbeddings, OpenAICompatibleLlm } from './embeddings.ts'
import { GeminiEmbeddings, GeminiLlm } from '../platform/gemini.ts'

const OPENAI_V1 = 'https://api.openai.com/v1'

/** Native Gemini REST when a Gemini key is present and no OpenAI-compatible base URL is set. */
export function createEmbeddingProvider(config: AppConfig): EmbeddingProvider {
  const { apiKey, baseUrl, model, dimensions } = config.embedding
  if (apiKey && !baseUrl && config.geminiApiKey) {
    return new GeminiEmbeddings({
      apiKey: config.geminiApiKey,
      model: model || config.geminiEmbeddingModel,
      dimensions,
    })
  }
  return new OpenAICompatibleEmbeddings({
    apiKey,
    baseUrl: baseUrl || OPENAI_V1,
    model,
    dimensions,
  })
}

export function createLlmProvider(config: AppConfig): LlmProvider {
  const { apiKey, baseUrl, model } = config.llm
  if (apiKey && !baseUrl && config.geminiApiKey) {
    return new GeminiLlm({
      apiKey: config.geminiApiKey,
      model: model || config.geminiTextModel,
    })
  }
  return new OpenAICompatibleLlm({
    apiKey,
    baseUrl: baseUrl || OPENAI_V1,
    model,
  })
}
