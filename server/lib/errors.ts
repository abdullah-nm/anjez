export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
  }
}

export class MissingProviderError extends AppError {
  constructor(
    code: 'EMBEDDINGS_UNAVAILABLE' | 'LLM_UNAVAILABLE' | 'IMAGE_GENERATION_UNAVAILABLE',
    message: string,
  ) {
    super(message, 503, code)
  }
}
