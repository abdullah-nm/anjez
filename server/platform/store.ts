import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { newId } from '../lib/crypto.ts'
import { AppError } from '../lib/errors.ts'
import type { BrandProfile, CompanyEventRecord, DesignRecord, DesignStatus, NotificationRecord } from './types.ts'

function requireCompany(companyId: string) {
  if (!companyId?.trim()) throw new AppError('company scope required', 500, 'COMPANY_SCOPE_REQUIRED')
  return companyId
}

export class PlatformStore {
  private db: DatabaseSync

  constructor(path: string) {
    const dir = dirname(path)
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS brand_profiles (
        company_id TEXT PRIMARY KEY,
        company_name TEXT NOT NULL,
        industry TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'ar',
        contact_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        primary_color TEXT NOT NULL DEFAULT '#142433',
        accent_color TEXT NOT NULL DEFAULT '#c4a46a',
        slogan TEXT NOT NULL DEFAULT '',
        tone TEXT NOT NULL DEFAULT 'فاخر',
        logo_path TEXT,
        logo_mime TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS company_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned',
        reminder_days TEXT NOT NULL DEFAULT '[7,1]',
        occasion_key TEXT,
        recurring INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_company_date ON company_events(company_id, date);
      CREATE TABLE IF NOT EXISTS designs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        event_id TEXT,
        product_id TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT '',
        audience TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'ar',
        style TEXT NOT NULL DEFAULT '',
        dimensions TEXT NOT NULL DEFAULT 'square',
        instructions TEXT NOT NULL DEFAULT '',
        headline TEXT NOT NULL,
        subhead TEXT NOT NULL,
        body TEXT NOT NULL,
        svg TEXT NOT NULL,
        background_kind TEXT NOT NULL,
        background_note TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_designs_company ON designs(company_id, created_at);
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        event_id TEXT,
        design_id TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_user ON notifications(company_id, user_id, created_at);
      CREATE TABLE IF NOT EXISTS reminder_deliveries (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        offset_days INTEGER NOT NULL,
        delivered_on TEXT NOT NULL,
        UNIQUE (company_id, event_id, offset_days, delivered_on)
      );
    `)
  }

  getBrand(companyId: string): BrandProfile | null {
    const row = this.db.prepare('SELECT * FROM brand_profiles WHERE company_id = ?').get(requireCompany(companyId)) as Record<string, unknown> | undefined
    return row ? mapBrand(row) : null
  }

  upsertBrand(profile: BrandProfile) {
    requireCompany(profile.companyId)
    this.db.prepare(
      `INSERT INTO brand_profiles (
        company_id, company_name, industry, description, language, contact_name, email, phone, city,
        primary_color, accent_color, slogan, tone, logo_path, logo_mime, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(company_id) DO UPDATE SET
        company_name=excluded.company_name, industry=excluded.industry, description=excluded.description,
        language=excluded.language, contact_name=excluded.contact_name, email=excluded.email, phone=excluded.phone,
        city=excluded.city, primary_color=excluded.primary_color, accent_color=excluded.accent_color,
        slogan=excluded.slogan, tone=excluded.tone, logo_path=excluded.logo_path, logo_mime=excluded.logo_mime,
        updated_at=excluded.updated_at`,
    ).run(
      profile.companyId,
      profile.companyName,
      profile.industry,
      profile.description,
      profile.language,
      profile.contactName,
      profile.email,
      profile.phone,
      profile.city,
      profile.primaryColor,
      profile.accentColor,
      profile.slogan,
      profile.tone,
      profile.logoPath,
      profile.logoMime,
      profile.updatedAt,
    )
  }

  listEvents(companyId: string) {
    const rows = this.db.prepare(
      'SELECT * FROM company_events WHERE company_id = ? ORDER BY date ASC',
    ).all(requireCompany(companyId)) as Record<string, unknown>[]
    return rows.map(mapEvent)
  }

  getEvent(companyId: string, id: string) {
    const row = this.db.prepare(
      'SELECT * FROM company_events WHERE id = ? AND company_id = ?',
    ).get(id, requireCompany(companyId)) as Record<string, unknown> | undefined
    return row ? mapEvent(row) : null
  }

  insertEvent(event: CompanyEventRecord) {
    requireCompany(event.companyId)
    this.db.prepare(
      `INSERT INTO company_events (
        id, company_id, title, date, time, description, category, audience, status,
        reminder_days, occasion_key, recurring, created_by, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      event.id,
      event.companyId,
      event.title,
      event.date,
      event.time,
      event.description,
      event.category,
      event.audience,
      event.status,
      JSON.stringify(event.reminderDays),
      event.occasionKey,
      event.recurring ? 1 : 0,
      event.createdBy,
      event.createdAt,
      event.updatedAt,
    )
  }

  updateEvent(companyId: string, id: string, patch: Partial<CompanyEventRecord>) {
    const current = this.getEvent(companyId, id)
    if (!current) return null
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
    this.db.prepare(
      `UPDATE company_events SET title=?, date=?, time=?, description=?, category=?, audience=?, status=?,
       reminder_days=?, occasion_key=?, recurring=?, updated_at=?
       WHERE id=? AND company_id=?`,
    ).run(
      next.title,
      next.date,
      next.time,
      next.description,
      next.category,
      next.audience,
      next.status,
      JSON.stringify(next.reminderDays),
      next.occasionKey,
      next.recurring ? 1 : 0,
      next.updatedAt,
      id,
      companyId,
    )
    return this.getEvent(companyId, id)
  }

  deleteEvent(companyId: string, id: string) {
    const result = this.db.prepare('DELETE FROM company_events WHERE id = ? AND company_id = ?').run(id, requireCompany(companyId))
    return Boolean(result.changes)
  }

  insertDesign(design: DesignRecord) {
    requireCompany(design.companyId)
    this.db.prepare(
      `INSERT INTO designs (
        id, company_id, event_id, product_id, purpose, audience, language, style, dimensions, instructions,
        headline, subhead, body, svg, background_kind, background_note, status, created_by, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      design.id,
      design.companyId,
      design.eventId,
      design.productId,
      design.purpose,
      design.audience,
      design.language,
      design.style,
      design.dimensions,
      design.instructions,
      design.headline,
      design.subhead,
      design.body,
      design.svg,
      design.backgroundKind,
      design.backgroundNote,
      design.status,
      design.createdBy,
      design.createdAt,
      design.updatedAt,
    )
  }

  listDesigns(companyId: string, eventId?: string) {
    requireCompany(companyId)
    const rows = eventId
      ? this.db.prepare('SELECT * FROM designs WHERE company_id = ? AND event_id = ? ORDER BY created_at DESC').all(companyId, eventId)
      : this.db.prepare('SELECT * FROM designs WHERE company_id = ? ORDER BY created_at DESC').all(companyId)
    return (rows as Record<string, unknown>[]).map(mapDesign)
  }

  getDesign(companyId: string, id: string) {
    const row = this.db.prepare('SELECT * FROM designs WHERE id = ? AND company_id = ?').get(id, requireCompany(companyId)) as Record<string, unknown> | undefined
    return row ? mapDesign(row) : null
  }

  updateDesignStatus(companyId: string, id: string, status: DesignStatus) {
    const result = this.db.prepare(
      'UPDATE designs SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?',
    ).run(status, new Date().toISOString(), id, requireCompany(companyId))
    if (!result.changes) return null
    return this.getDesign(companyId, id)
  }

  insertNotification(note: NotificationRecord) {
    this.db.prepare(
      `INSERT INTO notifications (id, company_id, user_id, event_id, design_id, title, body, read_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(note.id, note.companyId, note.userId, note.eventId, note.designId, note.title, note.body, note.readAt, note.createdAt)
  }

  listNotifications(companyId: string, userId: string) {
    const rows = this.db.prepare(
      'SELECT * FROM notifications WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50',
    ).all(requireCompany(companyId), userId) as Record<string, unknown>[]
    return rows.map(mapNote)
  }

  markRead(companyId: string, userId: string, id: string) {
    this.db.prepare(
      'UPDATE notifications SET read_at = ? WHERE id = ? AND company_id = ? AND user_id = ? AND read_at IS NULL',
    ).run(new Date().toISOString(), id, companyId, userId)
  }

  unreadCount(companyId: string, userId: string) {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS n FROM notifications WHERE company_id = ? AND user_id = ? AND read_at IS NULL',
    ).get(companyId, userId) as { n: number }
    return Number(row.n)
  }

  dueEvents() {
    return (this.db.prepare('SELECT * FROM company_events').all() as Record<string, unknown>[]).map(mapEvent)
  }

  companyUserIds(companyId: string, fallbackUserId: string) {
    const known: Record<string, string[]> = {
      company_nebras: ['user_sara', 'user_lina'],
      company_qimam: ['user_fahd'],
    }
    const ids = new Set<string>([fallbackUserId, ...(known[companyId] ?? [])])
    ids.delete('seed')
    return [...ids]
  }

  reassignEventCreator(companyId: string, fromUserId: string, toUserId: string) {
    this.db.prepare(
      'UPDATE company_events SET created_by = ? WHERE company_id = ? AND created_by = ?',
    ).run(toUserId, requireCompany(companyId), fromUserId)
  }

  claimDelivery(companyId: string, eventId: string, offset: number, day: string) {
    try {
      this.db.prepare(
        'INSERT INTO reminder_deliveries (id, company_id, event_id, offset_days, delivered_on) VALUES (?,?,?,?,?)',
      ).run(newId('del'), companyId, eventId, offset, day)
      return true
    } catch {
      return false
    }
  }

  close() {
    this.db.close()
  }
}

function mapBrand(row: Record<string, unknown>): BrandProfile {
  return {
    companyId: String(row.company_id),
    companyName: String(row.company_name),
    industry: String(row.industry),
    description: String(row.description),
    language: row.language === 'en' ? 'en' : 'ar',
    contactName: String(row.contact_name),
    email: String(row.email),
    phone: String(row.phone),
    city: String(row.city),
    primaryColor: String(row.primary_color),
    accentColor: String(row.accent_color),
    slogan: String(row.slogan),
    tone: String(row.tone),
    logoPath: row.logo_path ? String(row.logo_path) : null,
    logoMime: row.logo_mime ? String(row.logo_mime) : null,
    updatedAt: String(row.updated_at),
  }
}

function mapEvent(row: Record<string, unknown>): CompanyEventRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    title: String(row.title),
    date: String(row.date),
    time: row.time ? String(row.time) : null,
    description: String(row.description),
    category: String(row.category),
    audience: String(row.audience),
    status: row.status as CompanyEventRecord['status'],
    reminderDays: JSON.parse(String(row.reminder_days || '[7,1]')) as number[],
    occasionKey: row.occasion_key ? String(row.occasion_key) : null,
    recurring: Boolean(row.recurring),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapDesign(row: Record<string, unknown>): DesignRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    eventId: row.event_id ? String(row.event_id) : null,
    productId: String(row.product_id),
    purpose: String(row.purpose),
    audience: String(row.audience),
    language: row.language === 'en' ? 'en' : 'ar',
    style: String(row.style),
    dimensions: String(row.dimensions),
    instructions: String(row.instructions),
    headline: String(row.headline),
    subhead: String(row.subhead),
    body: String(row.body),
    svg: String(row.svg),
    backgroundKind: row.background_kind as DesignRecord['backgroundKind'],
    backgroundNote: String(row.background_note),
    status: row.status as DesignStatus,
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapNote(row: Record<string, unknown>): NotificationRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    userId: String(row.user_id),
    eventId: row.event_id ? String(row.event_id) : null,
    designId: row.design_id ? String(row.design_id) : null,
    title: String(row.title),
    body: String(row.body),
    readAt: row.read_at ? String(row.read_at) : null,
    createdAt: String(row.created_at),
  }
}
