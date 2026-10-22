import type { Request, Response } from 'express'
import { AsyncLocalStorage } from 'node:async_hooks'

export type MetricContext = {
  geminiClass?: string
  promptTokens: number
  outputTokens: number
  usageSamples: number
  usageMissing: number
}

export const metricContext = new AsyncLocalStorage<MetricContext>()

const companies = new WeakMap<Request, string>()

export function attachMetricCompany(req: Request, companyId: string) {
  if (companyId.trim()) companies.set(req, companyId)
}

export function metricCompany(req: Request) {
  return companies.get(req) ?? null
}

export type MetricNote = {
  feature?: string
  retrieveOk?: boolean | null
  generateOk?: boolean | null
  indexOk?: boolean | null
  insufficient?: boolean | null
  backgroundKind?: string | null
  errorClass?: string | null
}

export function noteMetric(res: Response, note: MetricNote) {
  const current = (res.locals.metricNote || {}) as MetricNote
  res.locals.metricNote = { ...current, ...note }
}

export function classifyGemini(status: number | undefined, reason: 'http' | 'unconfigured' | 'bad_response') {
  if (reason === 'unconfigured') return 'not_configured'
  if (reason === 'bad_response') return 'invalid'
  if (status === 429) return 'quota'
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'model_not_found'
  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) return 'unavailable'
  if (status === 400) return 'invalid'
  return 'unknown'
}

export function noteGeminiUsage(payload: Record<string, unknown>) {
  const ctx = metricContext.getStore()
  if (!ctx) return
  ctx.geminiClass = undefined
  const usage = payload.usageMetadata
  const prompt = usage && typeof usage === 'object' && 'promptTokenCount' in usage ? usage.promptTokenCount : null
  const output = usage && typeof usage === 'object' && 'candidatesTokenCount' in usage ? usage.candidatesTokenCount : null
  const promptTokens = typeof prompt === 'number' && Number.isFinite(prompt) ? prompt : null
  const outputTokens = typeof output === 'number' && Number.isFinite(output) ? output : null
  if (promptTokens === null && outputTokens === null) {
    ctx.usageMissing += 1
    return
  }
  ctx.promptTokens += promptTokens ?? 0
  ctx.outputTokens += outputTokens ?? 0
  ctx.usageSamples += 1
}

export function noteGeminiFailure(status: number | undefined, reason: 'http' | 'unconfigured' | 'bad_response') {
  const ctx = metricContext.getStore()
  if (!ctx) return
  ctx.geminiClass = classifyGemini(status, reason)
}

export function freshMetricContext(): MetricContext {
  return { promptTokens: 0, outputTokens: 0, usageSamples: 0, usageMissing: 0 }
}
