import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { MetricsStore } from '../observability/metrics.ts'
import { LocalObjectStorage } from '../platform/storage.ts'
import { PlatformStore } from '../platform/store.ts'
import { seedAccounts } from '../seed.ts'
import { SqliteStore } from '../store.ts'
import { HashingEmbeddingProvider, ScriptedLlm } from './hashingEmbeddings.ts'

function harness(dir = mkdtempSync(join(tmpdir(), 'anjz-reg-'))) {
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'k.sqlite'),
    PLATFORM_SQLITE_PATH: join(dir, 'p.sqlite'),
    UPLOAD_ROOT: join(dir, 'up'),
    SESSION_SECRET: 'register-secret',
    VECTOR_BACKEND: 'sqlite',
  })
  const store = new SqliteStore(config.sqlitePath)
  const metrics = new MetricsStore(config.platformSqlitePath)
  const platform = new PlatformStore(config.platformSqlitePath)
  const app = createApp({
    config,
    store,
    embeddings: new HashingEmbeddingProvider(),
    llm: new ScriptedLlm(),
    platform,
    storage: new LocalObjectStorage(config.uploadRoot),
    metrics,
  })
  return { app, store, config, dir }
}

function cookieOf(response: { headers: Record<string, unknown> }) {
  const cookie = response.headers['set-cookie']
  return Array.isArray(cookie) ? cookie : [String(cookie)]
}

describe('company accounts', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.()
  })

  it('keeps two company accounts after logout, login, and reopening the database', async () => {
    const first = harness()
    cleanups.push(() => first.store.close())
    await seedAccounts(first.store)
    const before = new DatabaseSync(first.config.sqlitePath)
    const companiesBefore = (before.prepare('SELECT COUNT(*) AS total FROM companies').get() as { total: number }).total
    before.close()

    const rejected = await request(first.app).post('/api/register').send({
      companyName: 'شركة مرفوضة',
      email: 'rejected@example.com',
      password: 'CompanyPass1',
      confirm: 'CompanyPass1',
      role: 'admin',
    }).expect(400)
    expect(rejected.body.code).toBe('ROLE_FORBIDDEN')

    await request(first.app).post('/api/register').send({
      companyName: 'ش',
      email: 'short@example.com',
      password: 'CompanyPass1',
      confirm: 'CompanyPass1',
    }).expect(400)
    await request(first.app).post('/api/register').send({
      companyName: 'شركة النور',
      email: 'noor@example.com',
      password: 'CompanyPass1',
      confirm: 'OtherPass1',
    }).expect(400)

    const created = await request(first.app).post('/api/register').send({
      companyName: 'شركة النور',
      email: 'Noor@Example.com',
      password: 'CompanyPass1',
      confirm: 'CompanyPass1',
    }).expect(201)
    expect(created.body.user.role).toBe('member')
    expect(created.body.user.companyName).toBe('شركة النور')
    expect(created.body.user.email).toBe('noor@example.com')
    expect(JSON.stringify(created.body)).not.toContain('CompanyPass1')
    const noor = cookieOf(created)

    const duplicate = await request(first.app).post('/api/register').send({
      companyName: 'شركة أخرى',
      email: 'noor@example.com',
      password: 'CompanyPass1',
      confirm: 'CompanyPass1',
    }).expect(409)
    expect(duplicate.body.error).toContain('مسجّل')

    const second = await request(first.app).post('/api/register').send({
      companyName: 'مؤسسة الأفق',
      email: 'ofuq@example.com',
      password: 'CompanyPass2',
      confirm: 'CompanyPass2',
    }).expect(201)
    expect(second.body.user.companyId).not.toBe(created.body.user.companyId)
    const ofuq = cookieOf(second)

    await request(first.app).post('/api/logout').set('Cookie', noor).expect(200)
    const companiesAfterLogout = new DatabaseSync(first.config.sqlitePath)
    expect((companiesAfterLogout.prepare('SELECT COUNT(*) AS total FROM companies').get() as { total: number }).total).toBe(companiesBefore + 2)
    companiesAfterLogout.close()

    const returned = await request(first.app).post('/api/login').send({
      email: 'noor@example.com',
      password: 'CompanyPass1',
    }).expect(200)
    expect(returned.body.user.id).toBe(created.body.user.id)
    expect(returned.body.user.companyId).toBe(created.body.user.companyId)
    const noorAgain = cookieOf(returned)
    const session = await request(first.app).get('/api/session').set('Cookie', noorAgain).expect(200)
    expect(session.body.user.companyName).toBe('شركة النور')

    const stillTwo = new DatabaseSync(first.config.sqlitePath)
    expect((stillTwo.prepare('SELECT COUNT(*) AS total FROM companies').get() as { total: number }).total).toBe(companiesBefore + 2)
    const stored = stillTwo.prepare(`SELECT role, password_hash FROM users WHERE email = ?`).get('noor@example.com') as { role: string, password_hash: string }
    expect(stored.role).toBe('member')
    expect(stored.password_hash).toContain(':')
    expect(stored.password_hash).not.toContain('CompanyPass1')
    stillTwo.close()

    await request(first.app).put('/api/brand').set('Cookie', noorAgain).send({
      companyName: 'شركة النور',
      industry: 'طباعة',
      primaryColor: '#112233',
      accentColor: '#445566',
    }).expect(200)
    const noorDesign = await request(first.app).post('/api/designs/compose').set('Cookie', noorAgain).send({
      eventId: null,
      eventTitle: 'دعوة النور',
      productId: 'prd-invite',
      productName: 'بطاقات دعوة',
      purpose: 'دعوة',
      language: 'ar',
    }).expect(201)
    await request(first.app).post('/api/orders').set('Cookie', noorAgain).send({
      id: 'ORD-550001',
      productId: 'prd-invite',
      quantity: 12,
      deliveryDate: '2026-12-01',
      designId: noorDesign.body.design.id,
    }).expect(201)

    const ofuqDesign = await request(first.app).post('/api/designs/compose').set('Cookie', ofuq).send({
      eventId: null,
      eventTitle: 'ملصق الأفق',
      productId: 'prd-poster',
      productName: 'ملصقات',
      purpose: 'إعلان',
      language: 'ar',
    }).expect(201)
    const noorList = await request(first.app).get('/api/designs').set('Cookie', noorAgain).expect(200)
    const ofuqList = await request(first.app).get('/api/designs').set('Cookie', ofuq).expect(200)
    expect(noorList.body.designs.map((design: { id: string }) => design.id)).toEqual([noorDesign.body.design.id])
    expect(ofuqList.body.designs.map((design: { id: string }) => design.id)).toEqual([ofuqDesign.body.design.id])
    await request(first.app).post(`/api/designs/${noorDesign.body.design.id}/status`).set('Cookie', ofuq).send({ status: 'approved' }).expect(404)
    const noorOrders = await request(first.app).get('/api/orders').set('Cookie', noorAgain).expect(200)
    expect(noorOrders.body.orders.map((order: { id: string }) => order.id)).toEqual(['ORD-550001'])
    const ofuqOrders = await request(first.app).get('/api/orders').set('Cookie', ofuq).expect(200)
    expect(ofuqOrders.body.orders).toEqual([])

    const dated = new DatabaseSync(first.config.sqlitePath)
    dated.prepare(`UPDATE companies SET created_at = ? WHERE id = ?`).run('2020-01-01T00:00:00.000Z', second.body.user.companyId)
    dated.close()
    const adminLogin = await request(first.app).post('/api/login').send({ email: 'nasser@almarai.com', password: 'AnjzDemo!26' }).expect(200)
    const adminCookie = cookieOf(adminLogin)
    await request(first.app).get('/api/observability/dashboard?preset=7d').set('Cookie', noorAgain).expect(403)
    await request(first.app).get(`/api/observability/companies/${created.body.user.companyId}`).set('Cookie', noorAgain).expect(403)
    await request(first.app).get(`/api/observability/companies/${second.body.user.companyId}`).set('Cookie', ofuq).expect(403)
    const board = await request(first.app).get('/api/observability/dashboard?preset=7d').set('Cookie', adminCookie).expect(200)
    expect(board.body.companies.total).toBe(companiesBefore + 2)
    expect(board.body.companies.newInPeriod).toBe(companiesBefore + 1)
    const registered = (board.body.journey.series as { registrations: number }[]).reduce((sum, point) => sum + point.registrations, 0)
    expect(registered).toBe(board.body.companies.newInPeriod)
    const noorRow = board.body.companies.rows.find((row: { email: string }) => row.email === 'noor@example.com')
    const ofuqRow = board.body.companies.rows.find((row: { email: string }) => row.email === 'ofuq@example.com')
    expect(noorRow).toMatchObject({ name: 'شركة النور', status: 'نشط', orders: 1, designs: 1, generations: 1 })
    expect(ofuqRow).toMatchObject({ name: 'مؤسسة الأفق', status: 'نشط', orders: 0, designs: 1, generations: 1 })
    expect(board.body.summary.orders).toBe(1)
    expect(board.body.journey.total).toBe(2)
    expect(board.body.orders.recent[0]).toMatchObject({ id: 'ORD-550001', companyId: created.body.user.companyId })
    expect(board.body.recent.filter((row: { companyId: string }) => row.companyId === created.body.user.companyId)).toHaveLength(1)
    expect(board.body.recent.filter((row: { companyId: string }) => row.companyId === second.body.user.companyId)).toHaveLength(1)
    const noorDetail = await request(first.app).get(`/api/observability/companies/${created.body.user.companyId}`).set('Cookie', adminCookie).expect(200)
    expect(noorDetail.body.orders.map((order: { id: string }) => order.id)).toEqual(['ORD-550001'])
    expect(noorDetail.body.designs).toHaveLength(1)
    expect(noorDetail.body.generations).toHaveLength(1)
    expect(JSON.stringify(noorDetail.body)).not.toContain('دعوة النور')
    const ofuqDetail = await request(first.app).get(`/api/observability/companies/${second.body.user.companyId}`).set('Cookie', adminCookie).expect(200)
    expect(ofuqDetail.body.orders).toEqual([])
    expect(ofuqDetail.body.generations).toHaveLength(1)
    expect(ofuqDetail.body.generations[0].id).not.toBe(noorDetail.body.generations[0].id)

    const hind = await request(first.app).post('/api/login').send({ email: 'hind@almarai.com', password: 'AnjzDemo!26' })
    await request(first.app).put('/api/brand').set('Cookie', cookieOf(hind)).send({
      companyName: 'المراعي',
      primaryColor: '#112233',
      accentColor: '#445566',
    }).expect(403)

    const reopened = harness(first.dir)
    cleanups.push(() => reopened.store.close())
    const again = await request(reopened.app).post('/api/login').send({
      email: 'noor@example.com',
      password: 'CompanyPass1',
    }).expect(200)
    expect(again.body.user.companyId).toBe(created.body.user.companyId)
    const brand = await request(reopened.app).get('/api/brand').set('Cookie', cookieOf(again)).expect(200)
    expect(brand.body.brand.companyName).toBe('شركة النور')
    expect(brand.body.brand.industry).toBe('طباعة')
    const orders = await request(reopened.app).get('/api/orders').set('Cookie', cookieOf(again)).expect(200)
    expect(orders.body.orders).toHaveLength(1)
    const ofuqLogin = await request(reopened.app).post('/api/login').send({
      email: 'ofuq@example.com',
      password: 'CompanyPass2',
    }).expect(200)
    const hidden = await request(reopened.app).get('/api/designs').set('Cookie', cookieOf(ofuqLogin)).expect(200)
    expect(hidden.body.designs.map((design: { id: string }) => design.id)).toEqual([ofuqDesign.body.design.id])
    const adminAgain = await request(reopened.app).post('/api/login').send({ email: 'nasser@almarai.com', password: 'AnjzDemo!26' }).expect(200)
    const persisted = await request(reopened.app).get('/api/observability/dashboard?preset=7d').set('Cookie', cookieOf(adminAgain)).expect(200)
    expect(persisted.body.companies.rows.find((row: { email: string }) => row.email === 'noor@example.com')).toMatchObject({ orders: 1, designs: 1, generations: 1 })
    expect(persisted.body.summary.orders).toBe(1)
    await request(reopened.app).get('/api/observability/dashboard?preset=7d').set('Cookie', cookieOf(again)).expect(403)
    await request(reopened.app).post('/api/login').send({ email: 'noor@example.com', password: 'wrong-password' }).expect(401)
  })
})
