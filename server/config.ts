export type AppConfig = {
  port: number
  sessionSecret: string
  sessionTtlMs: number
  sqlitePath: string
  uploadRoot: string
  databaseUrl: string | null
  vectorBackend: 'sqlite' | 'postgres'
  embedding: {
    apiKey: string | null
    baseUrl: string
    model: string
    dimensions: number
  }
  llm: {
    apiKey: string | null
    baseUrl: string
    model: string
  }
  image: {
    apiKey: string | null
    baseUrl: string
    model: string
  }
  retentionDays: number
  maxUploadBytes: number
  minSimilarity: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim() || null
  const vectorBackend =
    env.VECTOR_BACKEND === 'postgres' || databaseUrl?.startsWith('postgres')
      ? 'postgres'
      : 'sqlite'

  return {
    port: Number(env.PORT) || 8787,
    sessionSecret: env.SESSION_SECRET || 'anjz-dev-session-change-me',
    sessionTtlMs: Number(env.SESSION_TTL_MS) || 1000 * 60 * 60 * 12,
    sqlitePath: env.SQLITE_PATH || 'data/anjz.sqlite',
    uploadRoot: env.UPLOAD_ROOT || 'data/uploads',
    databaseUrl,
    vectorBackend,
    embedding: {
      apiKey: env.EMBEDDING_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || null,
      baseUrl: (env.EMBEDDING_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: env.EMBEDDING_MODEL || 'text-embedding-3-small',
      dimensions: Number(env.EMBEDDING_DIMENSIONS) || 1536,
    },
    llm: {
      apiKey: env.LLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || null,
      baseUrl: (env.LLM_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: env.LLM_MODEL || 'gpt-4o-mini',
    },
    image: {
      apiKey: env.IMAGE_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || null,
      baseUrl: (env.IMAGE_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: env.IMAGE_MODEL || 'gpt-image-2.5-flare',
    },
    retentionDays: Number(env.DOCUMENT_RETENTION_DAYS) || 365,
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES) || 8 * 1024 * 1024,
    minSimilarity: Number(env.RAG_MIN_SIMILARITY) || 0.22,
  }
}

export function providerStatus(config: AppConfig) {
  return {
    embeddingsConfigured: Boolean(config.embedding.apiKey),
    llmConfigured: Boolean(config.llm.apiKey),
    embeddingModel: config.embedding.model,
    llmModel: config.llm.model,
    imageConfigured: Boolean(config.image.apiKey),
    imageModel: config.image.model,
    vectorBackend: config.vectorBackend,
    missing: [
      !config.embedding.apiKey ? 'EMBEDDING_API_KEY أو OPENAI_API_KEY' : null,
      !config.llm.apiKey ? 'LLM_API_KEY أو OPENAI_API_KEY' : null,
      !config.image.apiKey ? 'IMAGE_API_KEY أو OPENAI_API_KEY' : null,
    ].filter(Boolean),
  }
}
