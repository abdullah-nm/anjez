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
    baseUrl: string | null
    model: string
    dimensions: number
  }
  llm: {
    apiKey: string | null
    baseUrl: string | null
    model: string
  }
  image: {
    apiKey: string | null
    baseUrl: string | null
    model: string
  }
  geminiApiKey: string | null
  geminiTextModel: string
  geminiEmbeddingModel: string
  geminiImageModel: string
  cronSecret: string | null
  supabaseUrl: string | null
  supabaseServiceKey: string | null
  supabaseBucket: string
  smtpUrl: string | null
  platformSqlitePath: string
  retentionDays: number
  maxUploadBytes: number
  minSimilarity: number
}

function blank(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim()
  return value ? value : null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = blank(env, 'DATABASE_URL')
  const vectorBackend =
    env.VECTOR_BACKEND === 'postgres' || databaseUrl?.startsWith('postgres')
      ? 'postgres'
      : 'sqlite'

  const geminiApiKey =
    blank(env, 'GEMINI_API_KEY') ||
    Object.entries(env).find(([key, value]) => key.toUpperCase() === 'GEMINI_API_KEY' && value?.trim())?.[1]?.trim() ||
    null
  const geminiTextModel = env.GEMINI_TEXT_MODEL?.trim() || 'gemini-3.8-flash'
  const geminiEmbeddingModel = env.GEMINI_EMBEDDING_MODEL?.trim() || 'gemini-embedding-001'
  const geminiImageModel = env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-3.1-flash-image'
  const openaiKey = blank(env, 'OPENAI_API_KEY')

  const embeddingExplicit = Boolean(blank(env, 'EMBEDDING_MODEL') || blank(env, 'EMBEDDING_BASE_URL'))
  const llmExplicit = Boolean(blank(env, 'LLM_MODEL') || blank(env, 'LLM_BASE_URL'))
  const usingGeminiEmbeddings = Boolean(geminiApiKey) && !blank(env, 'EMBEDDING_BASE_URL') && !blank(env, 'OPENAI_BASE_URL')
  const dimensionsFromEnv = env.EMBEDDING_DIMENSIONS?.trim()
    ? Number(env.EMBEDDING_DIMENSIONS)
    : usingGeminiEmbeddings
      ? 768
      : 1536

  return {
    port: Number(env.PORT) || 8787,
    sessionSecret: env.SESSION_SECRET || 'anjz-dev-session-change-me',
    sessionTtlMs: Number(env.SESSION_TTL_MS) || 1000 * 60 * 60 * 12,
    sqlitePath: env.SQLITE_PATH || 'data/anjz.sqlite',
    uploadRoot: env.UPLOAD_ROOT || 'data/uploads',
    databaseUrl,
    vectorBackend,
    embedding: {
      apiKey: blank(env, 'EMBEDDING_API_KEY') || geminiApiKey || openaiKey,
      baseUrl: (blank(env, 'EMBEDDING_BASE_URL') || blank(env, 'OPENAI_BASE_URL'))?.replace(/\/$/, '') || null,
      model:
        env.EMBEDDING_MODEL?.trim() ||
        (geminiApiKey && !embeddingExplicit ? geminiEmbeddingModel : 'text-embedding-3-small'),
      dimensions: Number.isFinite(dimensionsFromEnv) && dimensionsFromEnv > 0 ? dimensionsFromEnv : 1536,
    },
    llm: {
      apiKey: blank(env, 'LLM_API_KEY') || geminiApiKey || openaiKey,
      baseUrl: (blank(env, 'LLM_BASE_URL') || blank(env, 'OPENAI_BASE_URL'))?.replace(/\/$/, '') || null,
      model: env.LLM_MODEL?.trim() || (geminiApiKey && !llmExplicit ? geminiTextModel : 'gpt-4o-mini'),
    },
    image: {
      apiKey: geminiApiKey,
      baseUrl: null,
      model: geminiImageModel,
    },
    geminiApiKey,
    geminiTextModel,
    geminiEmbeddingModel,
    geminiImageModel,
    cronSecret: blank(env, 'CRON_SECRET'),
    supabaseUrl: blank(env, 'SUPABASE_URL'),
    supabaseServiceKey: blank(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    supabaseBucket: env.SUPABASE_LOGO_BUCKET?.trim() || 'company-logos',
    smtpUrl: blank(env, 'SMTP_URL'),
    platformSqlitePath: env.PLATFORM_SQLITE_PATH || 'data/platform.sqlite',
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
    embeddingDimensions: config.embedding.dimensions,
    llmModel: config.llm.model,
    imageConfigured: Boolean(config.geminiApiKey),
    imageModel: config.geminiImageModel,
    geminiConfigured: Boolean(config.geminiApiKey),
    geminiTextModel: config.geminiTextModel,
    geminiEmbeddingModel: config.geminiEmbeddingModel,
    vectorBackend: config.vectorBackend,
    missing: [
      !config.embedding.apiKey ? 'GEMINI_API_KEY أو EMBEDDING_API_KEY' : null,
      !config.llm.apiKey ? 'GEMINI_API_KEY أو LLM_API_KEY' : null,
      !config.geminiApiKey ? 'GEMINI_API_KEY' : null,
    ].filter(Boolean),
  }
}
