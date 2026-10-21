import { existsSync, readFileSync } from 'node:fs'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createEmbeddingProvider, createLlmProvider } from './lib/providers.ts'
import { seedAccounts, seedDocuments } from './seed.ts'
import { createStore } from './store.ts'
import { seedPlatformDemo } from './platform/demoSeed.ts'
import { LocalObjectStorage } from './platform/storage.ts'
import { PlatformStore } from './platform/store.ts'

loadDotEnv()
canonicalizeGeminiEnv()

const config = loadConfig()
const store = await createStore(config)
await seedAccounts(store)
await store.purgeExpired(new Date().toISOString())

const embeddings = createEmbeddingProvider(config)
const llm = createLlmProvider(config)
const storedDim = await store.storedEmbeddingDimension()
if (storedDim && storedDim !== config.embedding.dimensions) {
  console.warn(
    `Existing vectors are ${storedDim}-d; EMBEDDING_DIMENSIONS=${config.embedding.dimensions}. Re-index all documents before mixing models. Postgres remains vector(1536) unless you migrate.`,
  )
}

if (config.embedding.apiKey) {
  try {
    await seedDocuments({ store, embeddings, config })
    console.log('Seeded company knowledge bases with embeddings.')
  } catch (error) {
    console.warn('Could not seed documents:', error instanceof Error ? error.message : error)
  }
} else {
  console.warn(
    'Embeddings are not configured. Knowledge upload will be stored, but indexing stays in error until GEMINI_API_KEY or EMBEDDING_API_KEY is set.',
  )
}

const platform = new PlatformStore(config.platformSqlitePath)
seedPlatformDemo(platform)
const storage = new LocalObjectStorage(config.uploadRoot)
const app = createApp({ config, store, embeddings, llm, platform, storage })
app.listen(config.port, '127.0.0.1', () => {
  console.log(`Anjz API on http://127.0.0.1:${config.port}`)
})

function loadDotEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 0) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(key in process.env)) process.env[key] = value
    if (key.toUpperCase() === 'GEMINI_API_KEY' && !process.env.GEMINI_API_KEY?.trim()) {
      process.env.GEMINI_API_KEY = value
    }
  }
}

function canonicalizeGeminiEnv() {
  if (process.env.GEMINI_API_KEY?.trim()) return
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase() === 'GEMINI_API_KEY' && value?.trim()) {
      process.env.GEMINI_API_KEY = value.trim()
      return
    }
  }
}
