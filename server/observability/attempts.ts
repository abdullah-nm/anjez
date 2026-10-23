import { AsyncLocalStorage } from 'node:async_hooks'

export type ProviderAttemptNote = {
  model: string
  httpStatus: number
  durationMs: number
  failureCode: string | null
}

const attempts = new AsyncLocalStorage<((attempt: ProviderAttemptNote) => void)>()

export function runWithAttemptSink<T>(sink: (attempt: ProviderAttemptNote) => void, fn: () => Promise<T>) {
  return attempts.run(sink, fn)
}

export function noteProviderAttempt(attempt: ProviderAttemptNote) {
  attempts.getStore()?.(attempt)
}

export function providerFailureCode(status: number) {
  if (status === 429) return 'QUOTA'
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 408 || status === 504) return 'TIMEOUT'
  if (status === 400) return 'INVALID'
  if (status === 404 || status === 500 || status === 502 || status === 503 || status === 0) return 'UNAVAILABLE'
  return status >= 400 ? 'FAILED' : null
}
