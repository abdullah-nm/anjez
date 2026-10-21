import { existsSync, readFileSync } from 'node:fs'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { OpenAICompatibleEmbeddings, OpenAICompatibleLlm } from './lib/embeddings.ts'
import { seedAccounts, seedDocuments } from './seed.ts'
import { createStore } from './store.ts'

loadDotEnv()

const config = loadConfig()
const store = await createStore(config)
await seedAccounts(store)
await store.purgeExpired(new Date().toISOString())

const embeddings = new OpenAICompatibleEmbeddings(config.embedding)
const llm = new OpenAICompatibleLlm(config.llm)

if (config.embedding.apiKey) {
  try {
    await seedDocuments({ store, embeddings, config })
    console.log('Seeded company knowledge bases with embeddings.')
  } catch (error) {
    console.warn('Could not seed documents:', error instanceof Error ? error.message : error)
  }
} else {
  console.warn(
    'Embeddings are not configured. Knowledge upload will be stored, but indexing stays in error until EMBEDDING_API_KEY is set.',
  )
}

const app = createApp({ config, store, embeddings, llm })
app.listen(config.port, () => {
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
  }
}
