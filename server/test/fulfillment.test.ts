import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { nextOrderStatus } from '../../shared/orderFlow.ts'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { MetricsStore } from '../observability/metrics.ts'
import { LocalObjectStorage } from '../platform/storage.ts'
import { PlatformStore } from '../platform/store.ts'
import { seedAccounts } from '../seed.ts'
import { SqliteStore } from '../store.ts'
import { HashingEmbeddingProvider, ScriptedLlm } from './hashingEmbeddings.ts'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'anjz-flow-'))
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'k.sqlite'),
    PLATFORM_SQLITE_PATH: join(dir, 'p.sqlite'),
    UPLOAD_ROOT: join(dir, 'up'),
    SESSION_SECRET: 'flow-secret',
    VECTOR_BACKEND: 'sqlite',
  })
  const store = new SqliteStore(config.sqlitePath)
  const platform = new PlatformStore(config.platformSqlitePath)
  const app = createApp({
    config,
    store,
    embeddings: new HashingEmbeddingProvider(),
    llm: new ScriptedLlm(),
    platform,
    storage: new LocalObjectStorage(config.uploadRoot),
    metrics: new MetricsStore(config.platformSqlitePath),
  })
  return { app, store }
}

function cookieOf(response: { headers: Record<string, unknown> }) {
  const cookie = response.headers['set-cookie']
  return Array.isArray(cookie) ? cookie : [String(cookie)]
}

describe('order fulfillment', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.()
  })

  it('keeps the status machine on the allowed path', () => {
    expect(nextOrderStatus('محفوظ', 'assign')).toBe('مسند')
    expect(nextOrderStatus('مسند', 'accept')).toBe('مقبول')
    expect(nextOrderStatus('مقبول', 'start')).toBe('قيد التنفيذ')
    expect(nextOrderStatus('قيد التنفيذ', 'complete')).toBe('مكتمل')
    expect(nextOrderStatus('مسند', 'start')).toBeNull()
    expect(nextOrderStatus('مكتمل', 'assign')).toBeNull()
    expect(nextOrderStatus('مرفوض', 'assign')).toBe('مسند')
  })

  it('isolates company orders from providers until an admin assigns an approved provider', async () => {
    const { app, store } = harness()
    cleanups.push(() => store.close())
    await seedAccounts(store)
    const admin = cookieOf(await request(app).post('/api/login').send({ email: 'nasser@almarai.com', password: 'AnjzDemo!26' }).expect(200))
    const company = cookieOf(await request(app).post('/api/register').send({
      companyName: 'شركة النور',
      email: 'noor@example.com',
      password: 'CompanyPass1',
      confirm: 'CompanyPass1',
    }).expect(201))
    const provider = cookieOf(await request(app).post('/api/register/provider').send({
      kind: 'shop',
      displayName: 'مطبعة الواحة',
      city: 'الرياض',
      phone: '0550000000',
      services: ['print'],
      email: 'press@example.com',
      password: 'ProviderPass1',
      confirm: 'ProviderPass1',
    }).expect(201))

    await request(app).get('/api/dispatch/orders').set('Cookie', company).expect(403)
    await request(app).get('/api/provider/orders').set('Cookie', company).expect(403)
    await request(app).get('/api/observability/dashboard').set('Cookie', provider).expect(403)

    const created = await request(app).post('/api/orders').set('Cookie', company).send({
      id: 'ORD-1001',
      productId: 'prd-poster',
      quantity: 20,
      deliveryDate: '2026-12-01',
      deliveryCity: 'الرياض',
    }).expect(201)
    expect(created.body.status).toBe('محفوظ')

    const hidden = await request(app).get('/api/provider/orders').set('Cookie', provider).expect(200)
    expect(hidden.body.orders).toEqual([])
    await request(app).post('/api/dispatch/orders/company_x/ORD-1001/assign').set('Cookie', provider).send({ providerUserId: 'x' }).expect(403)

    const providerId = (await request(app).get('/api/providers').set('Cookie', admin).expect(200)).body.providers[0].userId
    await request(app).post(`/api/dispatch/orders/${created.body.companyId}/ORD-1001/assign`).set('Cookie', admin).send({ providerUserId: providerId }).expect(409)

    await request(app).patch(`/api/providers/${providerId}`).set('Cookie', company).send({ approval: 'approved' }).expect(403)
    await request(app).patch(`/api/providers/${providerId}`).set('Cookie', admin).send({ approval: 'approved' }).expect(200)
    await request(app).post(`/api/provider/orders/${created.body.companyId}/ORD-1001/transition`).set('Cookie', provider).send({ action: 'accept' }).expect(404)

    await request(app).post(`/api/dispatch/orders/${created.body.companyId}/ORD-1001/assign`).set('Cookie', admin).send({ providerUserId: providerId }).expect(200)
    const assigned = await request(app).get('/api/provider/orders').set('Cookie', provider).expect(200)
    expect(assigned.body.orders.map((order: { id: string }) => order.id)).toEqual(['ORD-1001'])

    const other = cookieOf(await request(app).post('/api/register').send({
      companyName: 'شركة أخرى',
      email: 'other@example.com',
      password: 'CompanyPass1',
      confirm: 'CompanyPass1',
    }).expect(201))
    const otherOrders = await request(app).get('/api/orders').set('Cookie', other).expect(200)
    expect(otherOrders.body.orders).toEqual([])

    await request(app).post(`/api/provider/orders/${created.body.companyId}/ORD-1001/transition`).set('Cookie', provider).send({ action: 'start' }).expect(409)
    await request(app).post(`/api/provider/orders/${created.body.companyId}/ORD-1001/transition`).set('Cookie', provider).send({ action: 'accept' }).expect(200)
    await request(app).post(`/api/provider/orders/${created.body.companyId}/ORD-1001/transition`).set('Cookie', provider).send({ action: 'start' }).expect(200)
    await request(app).post(`/api/provider/orders/${created.body.companyId}/ORD-1001/transition`).set('Cookie', provider).send({ action: 'complete' }).expect(200)

    const companyOrders = await request(app).get('/api/orders').set('Cookie', company).expect(200)
    expect(companyOrders.body.orders[0].status).toBe('مكتمل')
    expect(companyOrders.body.orders[0].providerName).toBe('مطبعة الواحة')
    expect(companyOrders.body.orders[0].events).toHaveLength(4)

    const stored = await store.getUserByEmail('noor@example.com')
    expect(stored?.role).toBe('member')
    const adminStill = await store.getUserByEmail('nasser@almarai.com')
    expect(adminStill?.role).toBe('admin')
  })
})
