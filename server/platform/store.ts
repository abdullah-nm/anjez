import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { storedCity } from '../../shared/cities.ts'
import { newId } from '../lib/crypto.ts'
import { AppError } from '../lib/errors.ts'
import type { BrandProfile, CalendarSyncState, CompanyEventRecord, DateCertainty, DesignRecord, DesignStatus, NotificationRecord, SystemOccasionRecord } from './types.ts'

function requireCompany(companyId: string) {
  if (!companyId?.trim()) throw new AppError('company scope required', 500, 'COMPANY_SCOPE_REQUIRED')
  return companyId
}

function countRows(db: DatabaseSync, sql: string) {
  const counts = new Map<string, number>()
  const rows = db.prepare(sql).all() as { company_id: string, total: number }[]
  for (const row of rows) counts.set(row.company_id, Number(row.total) || 0)
  return counts
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
        primary_color TEXT NOT NULL DEFAULT '#1f2937',
        accent_color TEXT NOT NULL DEFAULT '#d1d5db',
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
        date TEXT,
        time TEXT,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned',
        reminder_days TEXT NOT NULL DEFAULT '[30,14,7,3,1]',
        occasion_key TEXT,
        recurring INTEGER NOT NULL DEFAULT 0,
        date_certainty TEXT NOT NULL DEFAULT 'official',
        date_note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_company_date ON company_events(company_id, date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_open_occasion
        ON company_events(company_id, occasion_key)
        WHERE occasion_key IS NOT NULL AND status != 'done';
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
      CREATE TABLE IF NOT EXISTS print_orders (
        company_id TEXT NOT NULL,
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        product_id TEXT NOT NULL,
        status TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        delivery_date TEXT NOT NULL,
        delivery_city TEXT NOT NULL DEFAULT '',
        design_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (company_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_print_orders_company_time ON print_orders(company_id, created_at);
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
    `)
    this.migrateEvents()
    this.migrateNotes()
    this.migrateOrders()
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminder_deliveries (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT '',
        event_id TEXT NOT NULL,
        offset_days INTEGER NOT NULL,
        delivered_on TEXT NOT NULL,
        UNIQUE (company_id, user_id, event_id, offset_days, delivered_on)
      );
      CREATE TABLE IF NOT EXISTS reminder_preferences (
        company_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        offsets TEXT NOT NULL,
        PRIMARY KEY (company_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS system_occasions (
        key TEXT PRIMARY KEY,
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        category TEXT NOT NULL,
        date TEXT,
        date_certainty TEXT NOT NULL,
        date_note TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        cycle TEXT NOT NULL DEFAULT '',
        recurring INTEGER NOT NULL DEFAULT 0,
        checked_at TEXT,
        sync_status TEXT NOT NULL DEFAULT 'ok',
        history TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calendar_sync (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        checked_at TEXT,
        attempted_at TEXT,
        message TEXT NOT NULL DEFAULT ''
      );
    `)
    this.migrateReminders()
  }

  private migrateOrders() {
    const info = this.db.prepare('PRAGMA table_info(print_orders)').all() as { name: string }[]
    if (!info.length) return
    const names = new Set(info.map((column) => column.name))
    if (!names.has('delivery_city')) this.db.exec(`ALTER TABLE print_orders ADD COLUMN delivery_city TEXT NOT NULL DEFAULT ''`)
    if (!names.has('provider_user_id')) this.db.exec(`ALTER TABLE print_orders ADD COLUMN provider_user_id TEXT`)
    if (!names.has('service_key')) this.db.exec(`ALTER TABLE print_orders ADD COLUMN service_key TEXT NOT NULL DEFAULT 'print'`)
    if (!names.has('status_note')) this.db.exec(`ALTER TABLE print_orders ADD COLUMN status_note TEXT NOT NULL DEFAULT ''`)
    if (!names.has('updated_at')) this.db.exec(`ALTER TABLE print_orders ADD COLUMN updated_at TEXT`)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS service_providers (
        user_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        display_name TEXT NOT NULL,
        city TEXT NOT NULL,
        phone TEXT NOT NULL,
        services TEXT NOT NULL,
        approval TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS order_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(company_id, order_id, created_at);
    `)
  }

  private migrateReminders() {
    const info = this.db.prepare('PRAGMA table_info(reminder_deliveries)').all() as { name: string }[]
    if (!info.length || info.some((column) => column.name === 'user_id')) return
    this.db.exec(`
      CREATE TABLE reminder_deliveries_next (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT '',
        event_id TEXT NOT NULL,
        offset_days INTEGER NOT NULL,
        delivered_on TEXT NOT NULL,
        UNIQUE (company_id, user_id, event_id, offset_days, delivered_on)
      );
      INSERT INTO reminder_deliveries_next (id, company_id, user_id, event_id, offset_days, delivered_on)
      SELECT id, company_id, '', event_id, offset_days, delivered_on FROM reminder_deliveries;
      DROP TABLE reminder_deliveries;
      ALTER TABLE reminder_deliveries_next RENAME TO reminder_deliveries;
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
      'SELECT * FROM company_events WHERE company_id = ? ORDER BY date IS NULL, date ASC',
    ).all(requireCompany(companyId)) as Record<string, unknown>[]
    return rows.map(mapEvent)
  }

  activeOccasion(companyId: string, occasionKey: string) {
    const row = this.db.prepare(
      `SELECT * FROM company_events
       WHERE company_id = ? AND occasion_key = ? AND status != 'done'
       LIMIT 1`,
    ).get(requireCompany(companyId), occasionKey) as Record<string, unknown> | undefined
    return row ? mapEvent(row) : null
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
        reminder_days, occasion_key, recurring, date_certainty, date_note, created_by, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      event.dateCertainty,
      event.dateNote,
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
       reminder_days=?, occasion_key=?, recurring=?, date_certainty=?, date_note=?, updated_at=?
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
      next.dateCertainty,
      next.dateNote,
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

  savePrintOrder(input: {
    companyId: string
    id: string
    userId: string
    userName: string
    productId: string
    quantity: number
    deliveryDate: string
    deliveryCity?: string | null
    designId: string | null
    createdAt: string
  }) {
    requireCompany(input.companyId)
    const result = this.db.prepare(
      `INSERT OR IGNORE INTO print_orders (
        company_id, id, user_id, user_name, product_id, status, quantity, delivery_date, delivery_city, design_id, created_at, service_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'محفوظ', ?, ?, ?, ?, ?, 'print', ?)`,
    ).run(
      input.companyId,
      input.id,
      input.userId,
      input.userName.slice(0, 80),
      input.productId,
      input.quantity,
      input.deliveryDate,
      storedCity(input.deliveryCity),
      input.designId,
      input.createdAt,
      input.createdAt,
    )
    return result.changes > 0
  }

  listOrdersForAccount(companyId: string, userId: string) {
    requireCompany(companyId)
    return this.db.prepare(
      `SELECT id, user_id, user_name, product_id, status, quantity, delivery_date, delivery_city, design_id, created_at,
              provider_user_id, service_key, status_note, updated_at
       FROM print_orders
       WHERE company_id = ? AND user_id = ?
       ORDER BY created_at DESC`,
    ).all(companyId, userId) as {
      id: string
      user_id: string
      user_name: string
      product_id: string
      status: string
      quantity: number
      delivery_date: string
      delivery_city: string
      design_id: string | null
      created_at: string
      provider_user_id: string | null
      service_key: string
      status_note: string
      updated_at: string | null
    }[]
  }

  saveProvider(input: {
    userId: string
    kind: 'shop' | 'individual'
    displayName: string
    city: string
    phone: string
    services: string[]
    createdAt: string
  }) {
    this.db.prepare(
      `INSERT INTO service_providers (user_id, kind, display_name, city, phone, services, approval, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(input.userId, input.kind, input.displayName, input.city, input.phone, JSON.stringify(input.services), input.createdAt, input.createdAt)
  }

  updateProviderProfile(input: {
    userId: string
    kind: 'shop' | 'individual'
    displayName: string
    city: string
    phone: string
    services: string[]
    updatedAt: string
  }) {
    const result = this.db.prepare(
      `UPDATE service_providers
       SET kind = ?, display_name = ?, city = ?, phone = ?, services = ?, updated_at = ?
       WHERE user_id = ?`,
    ).run(input.kind, input.displayName, input.city, input.phone, JSON.stringify(input.services), input.updatedAt, input.userId)
    return result.changes > 0
  }

  setProviderApproval(userId: string, approval: 'approved' | 'rejected', updatedAt: string) {
    const result = this.db.prepare(
      `UPDATE service_providers SET approval = ?, updated_at = ? WHERE user_id = ? AND approval != ?`,
    ).run(approval, updatedAt, userId, approval)
    return result.changes > 0 ? this.getProvider(userId) : this.getProvider(userId)
  }

  getProvider(userId: string) {
    const row = this.db.prepare('SELECT * FROM service_providers WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined
    return row ? mapProvider(row) : null
  }

  listProviders() {
    const rows = this.db.prepare('SELECT * FROM service_providers ORDER BY created_at DESC').all() as Record<string, unknown>[]
    return rows.map(mapProvider)
  }

  getOrder(companyId: string, orderId: string) {
    const row = this.db.prepare(
      `SELECT company_id, id, user_id, user_name, product_id, status, quantity, delivery_date, delivery_city, design_id, created_at,
              provider_user_id, service_key, status_note, updated_at
       FROM print_orders WHERE company_id = ? AND id = ?`,
    ).get(requireCompany(companyId), orderId) as Record<string, unknown> | undefined
    return row ? mapOrder(row) : null
  }

  listAssignedOrders(providerUserId: string) {
    const rows = this.db.prepare(
      `SELECT company_id, id, user_id, user_name, product_id, status, quantity, delivery_date, delivery_city, design_id, created_at,
              provider_user_id, service_key, status_note, updated_at
       FROM print_orders WHERE provider_user_id = ? ORDER BY created_at DESC`,
    ).all(providerUserId) as Record<string, unknown>[]
    return rows.map(mapOrder)
  }

  listPlatformOrders() {
    const rows = this.db.prepare(
      `SELECT company_id, id, user_id, user_name, product_id, status, quantity, delivery_date, delivery_city, design_id, created_at,
              provider_user_id, service_key, status_note, updated_at
       FROM print_orders ORDER BY created_at DESC LIMIT 200`,
    ).all() as Record<string, unknown>[]
    return rows.map(mapOrder)
  }

  listOrderEvents(companyId: string, orderId: string) {
    return this.db.prepare(
      `SELECT id, actor_id, from_status, to_status, note, created_at
       FROM order_events WHERE company_id = ? AND order_id = ? ORDER BY created_at ASC`,
    ).all(requireCompany(companyId), orderId) as {
      id: string
      actor_id: string
      from_status: string | null
      to_status: string
      note: string
      created_at: string
    }[]
  }

  applyOrderTransition(input: {
    companyId: string
    orderId: string
    fromStatus: string
    toStatus: string
    providerUserId: string | null
    note: string
    actorId: string
    at: string
  }) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare(
        `UPDATE print_orders
         SET status = ?, provider_user_id = ?, status_note = ?, updated_at = ?
         WHERE company_id = ? AND id = ? AND status = ?`,
      ).run(
        input.toStatus,
        input.providerUserId,
        input.note,
        input.at,
        input.companyId,
        input.orderId,
        input.fromStatus,
      )
      if (!result.changes) {
        this.db.exec('ROLLBACK')
        return false
      }
      this.db.prepare(
        `INSERT INTO order_events (id, company_id, order_id, actor_id, from_status, to_status, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(newId('evt'), input.companyId, input.orderId, input.actorId, input.fromStatus, input.toStatus, input.note, input.at)
      this.db.exec('COMMIT')
      return true
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listPrintOrders(companyId: string, fromIso: string, toIso: string) {
    requireCompany(companyId)
    return this.db.prepare(
      `SELECT id, user_id, user_name, product_id, status, quantity, delivery_date, delivery_city, design_id, created_at
       FROM print_orders
       WHERE company_id = ? AND created_at >= ? AND created_at <= ?
       ORDER BY created_at DESC`,
    ).all(companyId, fromIso, toIso) as {
      id: string
      user_name: string
      product_id: string
      status: string
      quantity: number
      delivery_date: string
      delivery_city: string
      design_id: string | null
      created_at: string
      user_id: string
    }[]
  }

  orderCounts(companyIds: string[], fromIso: string, toIso: string) {
    const ids = [...new Set(companyIds.map((id) => id.trim()).filter(Boolean))]
    const counts = new Map<string, number>()
    if (!ids.length) return counts
    const marks = ids.map(() => '?').join(',')
    const rows = this.db.prepare(
      `SELECT company_id, COUNT(*) AS total
       FROM print_orders
       WHERE company_id IN (${marks}) AND created_at >= ? AND created_at <= ?
       GROUP BY company_id`,
    ).all(...ids, fromIso, toIso) as { company_id: string, total: number }[]
    for (const row of rows) counts.set(row.company_id, Number(row.total) || 0)
    return counts
  }

  countPrintOrders(companyId: string, fromIso: string, toIso: string) {
    requireCompany(companyId)
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total FROM print_orders WHERE company_id = ? AND created_at >= ? AND created_at < ?`,
    ).get(companyId, fromIso, toIso) as { total: number }
    return row.total
  }

  listPrintOrdersBetween(fromIso: string, toIso: string) {
    return this.db.prepare(
      `SELECT company_id, id, user_id, user_name, product_id, status, quantity, delivery_date, delivery_city, design_id, created_at
       FROM print_orders
       WHERE created_at >= ? AND created_at <= ?
       ORDER BY created_at DESC`,
    ).all(fromIso, toIso) as {
      company_id: string
      id: string
      user_id: string
      user_name: string
      product_id: string
      status: string
      quantity: number
      delivery_date: string
      delivery_city: string
      design_id: string | null
      created_at: string
    }[]
  }

  countPrintOrdersBetween(fromIso: string, toIso: string) {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total FROM print_orders WHERE created_at >= ? AND created_at < ?`,
    ).get(fromIso, toIso) as { total: number }
    return row.total
  }

  designCounts() {
    return countRows(this.db, `SELECT company_id, COUNT(*) AS total FROM designs GROUP BY company_id`)
  }

  orderCountsAll() {
    return countRows(this.db, `SELECT company_id, COUNT(*) AS total FROM print_orders GROUP BY company_id`)
  }

  designLinks(ids: string[]) {
    const unique = [...new Set(ids.filter((id) => /^des_[a-f0-9]+$/.test(id)))]
    if (!unique.length) return [] as { id: string, eventId: string | null }[]
    const marks = unique.map(() => '?').join(',')
    const rows = this.db.prepare(`SELECT id, event_id FROM designs WHERE id IN (${marks})`).all(...unique) as { id: string, event_id: string | null }[]
    return rows.map((row) => ({ id: row.id, eventId: row.event_id ? String(row.event_id) : null }))
  }

  eventOccasionKeys(ids: string[]) {
    const unique = [...new Set(ids.map((id) => id.trim()).filter((id) => id && !id.startsWith('sys:') && id.length <= 80))]
    if (!unique.length) return [] as { id: string, occasionKey: string | null }[]
    const marks = unique.map(() => '?').join(',')
    const rows = this.db.prepare(`SELECT id, occasion_key FROM company_events WHERE id IN (${marks})`).all(...unique) as { id: string, occasion_key: string | null }[]
    return rows.map((row) => ({ id: row.id, occasionKey: row.occasion_key ? String(row.occasion_key) : null }))
  }

  updateDesignStatus(companyId: string, id: string, status: DesignStatus) {
    const result = this.db.prepare(
      'UPDATE designs SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?',
    ).run(status, new Date().toISOString(), id, requireCompany(companyId))
    if (!result.changes) return null
    return this.getDesign(companyId, id)
  }

  private migrateNotes() {
    const info = this.db.prepare('PRAGMA table_info(notifications)').all() as { name: string }[]
    if (!info.length) return
    if (!info.some((column) => column.name === 'kind')) this.db.exec(`ALTER TABLE notifications ADD COLUMN kind TEXT NOT NULL DEFAULT ''`)
    if (!info.some((column) => column.name === 'payload')) this.db.exec(`ALTER TABLE notifications ADD COLUMN payload TEXT NOT NULL DEFAULT ''`)
  }

  insertNotification(note: NotificationRecord) {
    this.db.prepare(
      `INSERT INTO notifications (id, company_id, user_id, event_id, design_id, title, body, kind, payload, read_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(note.id, note.companyId, note.userId, note.eventId, note.designId, note.title, note.body, note.kind, note.payload, note.readAt, note.createdAt)
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
    return (this.db.prepare(
      `SELECT * FROM company_events WHERE date IS NOT NULL AND status != 'done'`,
    ).all() as Record<string, unknown>[]).map(mapEvent)
  }

  private migrateEvents() {
    const info = this.db.prepare('PRAGMA table_info(company_events)').all() as { name: string, notnull: number }[]
    if (!info.length) return
    const date = info.find((column) => column.name === 'date')
    const ready = date?.notnull === 0 && info.some((column) => column.name === 'date_certainty')
    if (ready) {
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_open_occasion
          ON company_events(company_id, occasion_key)
          WHERE occasion_key IS NOT NULL AND status != 'done';
      `)
      return
    }
    this.db.exec('BEGIN')
    this.db.exec(`
      CREATE TABLE company_events_next (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        title TEXT NOT NULL,
        date TEXT,
        time TEXT,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned',
        reminder_days TEXT NOT NULL DEFAULT '[30,14,7,3,1]',
        occasion_key TEXT,
        recurring INTEGER NOT NULL DEFAULT 0,
        date_certainty TEXT NOT NULL DEFAULT 'official',
        date_note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO company_events_next (
        id, company_id, title, date, time, description, category, audience, status,
        reminder_days, occasion_key, recurring, date_certainty, date_note, created_by, created_at, updated_at
      )
      SELECT id, company_id, title, NULLIF(date, ''), time, description, category, audience, status,
        reminder_days, occasion_key, recurring, 'official', '', created_by, created_at, updated_at
      FROM company_events;
      DROP TABLE company_events;
      ALTER TABLE company_events_next RENAME TO company_events;
      CREATE INDEX IF NOT EXISTS idx_events_company_date ON company_events(company_id, date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_open_occasion
        ON company_events(company_id, occasion_key)
        WHERE occasion_key IS NOT NULL AND status != 'done';
    `)
    this.db.exec('COMMIT')
  }

  listSystemOccasions() {
    const rows = this.db.prepare(
      'SELECT * FROM system_occasions ORDER BY date IS NULL, date ASC',
    ).all() as Record<string, unknown>[]
    return rows.map(mapSystemOccasion)
  }

  getSystemOccasion(key: string) {
    const row = this.db.prepare('SELECT * FROM system_occasions WHERE key = ?').get(key) as Record<string, unknown> | undefined
    return row ? mapSystemOccasion(row) : null
  }

  upsertSystemOccasion(occasion: SystemOccasionRecord) {
    this.db.prepare(
      `INSERT INTO system_occasions (
        key, title_ar, title_en, category, date, date_certainty, date_note, source, cycle, recurring,
        checked_at, sync_status, history, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET
        title_ar=excluded.title_ar, title_en=excluded.title_en, category=excluded.category, date=excluded.date,
        date_certainty=excluded.date_certainty, date_note=excluded.date_note, source=excluded.source,
        cycle=excluded.cycle, recurring=excluded.recurring, checked_at=excluded.checked_at,
        sync_status=excluded.sync_status, history=excluded.history, updated_at=excluded.updated_at`,
    ).run(
      occasion.key,
      occasion.titleAr,
      occasion.titleEn,
      occasion.category,
      occasion.date,
      occasion.dateCertainty,
      occasion.dateNote,
      occasion.source,
      occasion.cycle,
      occasion.recurring ? 1 : 0,
      occasion.checkedAt,
      occasion.syncStatus,
      JSON.stringify(occasion.history),
      occasion.updatedAt,
    )
  }

  calendarSyncState(): CalendarSyncState | null {
    const row = this.db.prepare(`SELECT * FROM calendar_sync WHERE id = 'hijri'`).get() as Record<string, unknown> | undefined
    if (!row) return null
    return {
      status: row.status === 'stale' ? 'stale' : 'ok',
      source: String(row.source || ''),
      checkedAt: row.checked_at ? String(row.checked_at) : null,
      attemptedAt: row.attempted_at ? String(row.attempted_at) : null,
      message: String(row.message || ''),
    }
  }

  saveCalendarSync(state: CalendarSyncState) {
    this.db.prepare(
      `INSERT INTO calendar_sync (id, status, source, checked_at, attempted_at, message)
       VALUES ('hijri', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status=excluded.status, source=excluded.source, checked_at=excluded.checked_at,
         attempted_at=excluded.attempted_at, message=excluded.message`,
    ).run(state.status, state.source, state.checkedAt, state.attemptedAt, state.message)
  }

  reminderPreference(companyId: string, userId: string) {
    const row = this.db.prepare(
      'SELECT offsets FROM reminder_preferences WHERE company_id = ? AND user_id = ?',
    ).get(requireCompany(companyId), userId) as { offsets?: string } | undefined
    if (!row) return [30, 14, 7, 3, 1]
    const parsed = JSON.parse(String(row.offsets || '[]')) as number[]
    return parsed.filter((day) => [30, 14, 7, 3, 1].includes(day))
  }

  setReminderPreference(companyId: string, userId: string, offsets: number[]) {
    this.db.prepare(
      `INSERT INTO reminder_preferences (company_id, user_id, offsets) VALUES (?,?,?)
       ON CONFLICT(company_id, user_id) DO UPDATE SET offsets=excluded.offsets`,
    ).run(requireCompany(companyId), userId, JSON.stringify(offsets))
  }

  purgeCompany(companyId: string, userIds: string[]) {
    this.db.prepare('DELETE FROM reminder_deliveries WHERE company_id = ?').run(companyId)
    this.db.prepare('DELETE FROM reminder_preferences WHERE company_id = ?').run(companyId)
    this.db.prepare('DELETE FROM designs WHERE company_id = ?').run(companyId)
    this.db.prepare('DELETE FROM company_events WHERE company_id = ?').run(companyId)
    this.db.prepare('DELETE FROM brand_profiles WHERE company_id = ?').run(companyId)
    this.db.prepare('DELETE FROM notifications WHERE company_id = ?').run(companyId)
    for (const userId of userIds) {
      this.db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId)
    }
  }

  companyIds() {
    return Object.keys(KNOWN_COMPANY_USERS)
  }

  companyUserIds(companyId: string, fallbackUserId: string) {
    const ids = new Set<string>([fallbackUserId, ...(KNOWN_COMPANY_USERS[companyId] ?? [])])
    ids.delete('seed')
    ids.delete('')
    return [...ids]
  }

  reassignEventCreator(companyId: string, fromUserId: string, toUserId: string) {
    this.db.prepare(
      'UPDATE company_events SET created_by = ? WHERE company_id = ? AND created_by = ?',
    ).run(toUserId, requireCompany(companyId), fromUserId)
  }

  claimDelivery(companyId: string, eventId: string, offset: number, day: string, userId = '') {
    try {
      this.db.prepare(
        'INSERT INTO reminder_deliveries (id, company_id, user_id, event_id, offset_days, delivered_on) VALUES (?,?,?,?,?,?)',
      ).run(newId('del'), companyId, userId, eventId, offset, day)
      return true
    } catch {
      return false
    }
  }

  ping() {
    try {
      const row = this.db.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined
      return row?.ok === 1
    } catch {
      return false
    }
  }

  close() {
    this.db.close()
  }
}

const KNOWN_COMPANY_USERS: Record<string, string[]> = {
  company_almarai: ['user_almarai_admin', 'user_almarai_member'],
  company_qimam: ['user_fahd'],
}

function mapSystemOccasion(row: Record<string, unknown>): SystemOccasionRecord {
  const certainty = row.date_certainty
  const dateCertainty: DateCertainty = certainty === 'estimated' || certainty === 'unannounced' ? certainty : 'official'
  let history: SystemOccasionRecord['history'] = []
  try {
    const parsed = JSON.parse(String(row.history || '[]')) as SystemOccasionRecord['history']
    if (Array.isArray(parsed)) history = parsed
  } catch {
    history = []
  }
  return {
    key: String(row.key),
    titleAr: String(row.title_ar),
    titleEn: String(row.title_en),
    category: row.category === 'islamic' || row.category === 'season' ? row.category : 'national',
    date: row.date ? String(row.date) : null,
    dateCertainty,
    dateNote: row.date_note ? String(row.date_note) : '',
    source: row.source ? String(row.source) : '',
    cycle: row.cycle ? String(row.cycle) : '',
    recurring: Boolean(row.recurring),
    checkedAt: row.checked_at ? String(row.checked_at) : null,
    syncStatus: row.sync_status === 'stale' ? 'stale' : 'ok',
    history,
    updatedAt: String(row.updated_at),
  }
}

function mapProvider(row: Record<string, unknown>) {
  let services: string[] = []
  try {
    const parsed = JSON.parse(String(row.services ?? '[]'))
    if (Array.isArray(parsed)) services = parsed.filter((item) => typeof item === 'string')
  } catch {
    services = []
  }
  const approval = row.approval === 'approved' || row.approval === 'rejected' ? row.approval : 'pending'
  return {
    userId: String(row.user_id),
    kind: row.kind === 'individual' ? 'individual' as const : 'shop' as const,
    displayName: String(row.display_name),
    city: String(row.city),
    phone: String(row.phone),
    services,
    approval,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapOrder(row: Record<string, unknown>) {
  return {
    companyId: String(row.company_id),
    id: String(row.id),
    userId: String(row.user_id),
    userName: String(row.user_name),
    productId: String(row.product_id),
    status: String(row.status),
    quantity: Number(row.quantity),
    deliveryDate: String(row.delivery_date),
    deliveryCity: String(row.delivery_city ?? ''),
    designId: row.design_id ? String(row.design_id) : null,
    createdAt: String(row.created_at),
    providerUserId: row.provider_user_id ? String(row.provider_user_id) : null,
    serviceKey: String(row.service_key || 'print'),
    statusNote: String(row.status_note ?? ''),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
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
    date: row.date ? String(row.date) : null,
    time: row.time ? String(row.time) : null,
    description: String(row.description),
    category: String(row.category),
    audience: String(row.audience),
    status: row.status as CompanyEventRecord['status'],
    reminderDays: JSON.parse(String(row.reminder_days || '[30,14,7,3,1]')) as number[],
    occasionKey: row.occasion_key ? String(row.occasion_key) : null,
    dateCertainty: row.date_certainty === 'estimated' || row.date_certainty === 'unannounced' ? row.date_certainty : 'official',
    dateNote: row.date_note ? String(row.date_note) : '',
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
    kind: row.kind ? String(row.kind) : '',
    payload: row.payload ? String(row.payload) : '',
    readAt: row.read_at ? String(row.read_at) : null,
    createdAt: String(row.created_at),
  }
}
