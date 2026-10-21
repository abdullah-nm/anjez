import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.ts'
import { createEmbeddingProvider, createLlmProvider } from '../lib/providers.ts'
import { GeminiEmbeddings, GeminiLlm } from '../platform/gemini.ts'
import { OpenAICompatibleEmbeddings, OpenAICompatibleLlm } from '../lib/embeddings.ts'

describe('Gemini environment wiring', () => {
  it('uses native Gemini providers when only GEMINI_API_KEY is set', () => {
    const config = loadConfig({
      GEMINI_API_KEY: 'test-gemini',
      GEMINI_TEXT_MODEL: 'gemini-3.8-flash',
      GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
      EMBEDDING_MODEL: 'gemini-embedding-001',
      EMBEDDING_DIMENSIONS: '768',
      LLM_MODEL: 'gemini-3.8-flash',
    })
    expect(config.embedding.apiKey).toBe('test-gemini')
    expect(config.embedding.baseUrl).toBeNull()
    expect(config.embedding.dimensions).toBe(768)
    expect(config.llm.apiKey).toBe('test-gemini')
    expect(config.geminiImageModel).toBe('gemini-3.1-flash-image')
    expect(createEmbeddingProvider(config)).toBeInstanceOf(GeminiEmbeddings)
    expect(createLlmProvider(config)).toBeInstanceOf(GeminiLlm)
  })

  it('keeps the OpenAI-compatible client when an explicit base URL is set', () => {
    const config = loadConfig({
      GEMINI_API_KEY: 'test-gemini',
      EMBEDDING_API_KEY: 'other',
      EMBEDDING_BASE_URL: 'https://api.openai.com/v1',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_DIMENSIONS: '1536',
      LLM_API_KEY: 'other',
      LLM_BASE_URL: 'https://api.openai.com/v1',
      LLM_MODEL: 'gpt-4o-mini',
    })
    expect(config.embedding.dimensions).toBe(1536)
    expect(createEmbeddingProvider(config)).toBeInstanceOf(OpenAICompatibleEmbeddings)
    expect(createLlmProvider(config)).toBeInstanceOf(OpenAICompatibleLlm)
  })

  it('parses the replacement model from a Gemini 404 body', async () => {
    const { suggestedModelFromGeminiError } = await import('../platform/gemini.ts')
    expect(
      suggestedModelFromGeminiError(
        'This model models/gemini-2.0-flash is no longer available. Please update your code to use models/gemini-3.8-flash for the latest',
      ),
    ).toBe('gemini-3.8-flash')
  })

  it('does not treat empty keys as configured', () => {
    const config = loadConfig({
      GEMINI_API_KEY: '',
      EMBEDDING_API_KEY: '',
      LLM_API_KEY: '',
    })
    expect(config.embedding.apiKey).toBeNull()
    expect(config.llm.apiKey).toBeNull()
    expect(config.geminiApiKey).toBeNull()
    expect(config.embedding.dimensions).toBe(1536)
  })
})
