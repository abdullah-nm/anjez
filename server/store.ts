import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'
import type { AppConfig } from './config.ts'
import { blobToFloats, cosineSimilarity, floatsToBlob, newId } from './lib/crypto.ts'
import { AppError } from './lib/errors.ts'
import type {
  AuditEvent,
  KnowledgeChunk,
  KnowledgeDocument,
  RetrievedChunk,
  Role,
  SessionUser,
} from './types.ts'

export type UserRow = SessionUser & { passwordHash: string }

const ACTIVITY_ACTIONS = [
  'auth.login',
  'design.image.generate',
  'design.compose',
  'print.order',
  'document.upload',
  'document.reindex',
  'knowledge.ask',
  'design.status',
]

export interface KnowledgeStore {
  getUserByEmail(email: string): Promise<UserRow | null>
  getUserById(id: string): Promise<SessionUser | null>
  insertCompany(id: string, name: string): Promise<void>
  insertUser(input: {
    id: string
    companyId: string
    email: string
    name: string
    role: Role
    passwordHash: string
  }): Promise<void>
  createCompanyAccount(input: {
    companyId: string
    companyName: string
    userId: string
    email: string
    name: string
    passwordHash: string
  }): Promise<void>
  createProviderAccount(input: {
    userId: string
    email: string
    name: string
    passwordHash: string
  }): Promise<void>
  deleteUser(userId: string): Promise<void>
  upsertCompany(id: string, name: string): Promise<void>
  renameCompany(companyId: string, name: string): Promise<void>
  updateUserName(userId: string, name: string): Promise<void>
  sessionEpoch(userId: string): Promise<number>
  bumpSessionEpoch(userId: string): Promise<void>
  upsertUser(input: {
    id: string
    companyId: string
    email: string
    name: string
    role: Role
    passwordHash: string
  }): Promise<void>
  removeCompany(companyId: string, userIds: string[]): Promise<void>
  createDocument(
    input: Omit<KnowledgeDocument, 'chunkCount' | 'deletedAt' | 'errorCode' | 'errorMessage'> & {
      errorCode?: string | null
      errorMessage?: string | null
    },
  ): Promise<KnowledgeDocument>
  listDocuments(companyId: string): Promise<KnowledgeDocument[]>
  getDocument(companyId: string, documentId: string): Promise<KnowledgeDocument | null>
  updateDocument(
    companyId: string,
    documentId: string,
    patch: Partial<Pick<KnowledgeDocument, 'status' | 'errorCode' | 'errorMessage' | 'chunkCount' | 'updatedAt'>>,
  ): Promise<KnowledgeDocument | null>
  softDeleteDocument(companyId: string, documentId: string, at: string): Promise<boolean>
  replaceChunks(companyId: string, documentId: string, chunks: Omit<KnowledgeChunk, 'filename'>[]): Promise<void>
  searchChunks(companyId: string, queryEmbedding: number[], limit: number): Promise<RetrievedChunk[]>
  storedEmbeddingDimension(): Promise<number | null>
  audit(event: AuditEvent): Promise<void>
  activeActorIds(companyId: string, fromIso: string, toIso: string): Promise<string[]>
  activeActorIdsAll(fromIso: string, toIso: string): Promise<string[]>
  listPlatformCompanies(): Promise<PlatformCompany[]>
  listCompanyUsers(companyId: string): Promise<CompanyAccount[]>
  listIndependentClients(): Promise<ClientAccount[]>
  purgeExpired(nowIso: string): Promise<number>
  ping(): Promise<boolean>
  close(): Promise<void>
}

export type CompanyAccount = {
  id: string
  email: string
  name: string
  role: Role
  createdAt: string
}

export type ClientAccount = {
  id: string
  email: string
  name: string
  companyId: string
  createdAt: string
}

function accountCreatedAt(value: unknown) {
  const parsed = new Date(String(value || ''))
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString()
}

export type PlatformCompany = {
  id: string
  name: string
  email: string
  contactName: string
  role: Role | null
  createdAt: string
  status: string
}

type CompanyDirectoryRow = {
  companyId: string
  companyName: string
  companyCreated: string
  userId: string | null
  email: string | null
  userName: string | null
  role: Role | null
  userCreated: string | null
  status: string | null
  deletedAt: string | null
}

function groupCompanies(rows: CompanyDirectoryRow[]): PlatformCompany[] {
  const grouped = new Map<string, { row: CompanyDirectoryRow, contact: CompanyDirectoryRow | null }>()
  for (const row of rows) {
    const current = grouped.get(row.companyId)
    if (!current) {
      grouped.set(row.companyId, { row, contact: row.userId ? row : null })
      continue
    }
    if (row.userId && row.role === 'admin' && current.contact?.role !== 'admin') current.contact = row
  }
  return [...grouped.values()].map(({ row, contact }) => ({
    id: row.companyId,
    name: row.companyName,
    email: contact?.email ?? '',
    contactName: contact?.userName ?? '',
    role: contact?.role ?? null,
    createdAt: accountCreatedAt(row.companyCreated || contact?.userCreated),
    status: contact?.deletedAt ? 'deleted' : (contact?.status || 'active'),
  }))
}

function requireCompanyId(companyId: string) {
  if (!companyId?.trim()) {
    throw new AppError('company_id is required on the server', 500, 'COMPANY_SCOPE_REQUIRED')
  }
  return companyId
}

export async function createStore(config: AppConfig): Promise<KnowledgeStore> {
  if (config.vectorBackend === 'postgres') {
    return createPostgresStore(config)
  }
  const dir = dirname(config.sqlitePath)
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true })
  return new SqliteStore(config.sqlitePath)
}

export class SqliteStore implements KnowledgeStore {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (company_id) REFERENCES companies(id)
      );
      CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        expires_at TEXT,
        created_by TEXT NOT NULL,
        FOREIGN KEY (company_id) REFERENCES companies(id)
      );
      CREATE INDEX IF NOT EXISTS idx_documents_company_alive
        ON documents(company_id, deleted_at, status);
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (document_id, chunk_index),
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY (company_id) REFERENCES companies(id)
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_company ON chunks(company_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        actor_user_id TEXT,
        company_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        ip TEXT,
        result TEXT NOT NULL,
        extra TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_logs(company_id, at);
    `)
    this.keepCompanyAccounts()
    const userColumns = new Set((this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((column) => column.name))
    if (!userColumns.has('session_epoch')) {
      this.db.exec('ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0')
    }
    this.migrateNullableCompany()
  }

  private migrateNullableCompany() {
    const columns = this.db.prepare('PRAGMA table_info(users)').all() as { name: string, notnull: number }[]
    const company = columns.find((column) => column.name === 'company_id')
    if (!company || company.notnull === 0) return
    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE users_next (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        session_epoch INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (company_id) REFERENCES companies(id)
      );
      INSERT INTO users_next (id, company_id, email, name, role, password_hash, created_at, session_epoch)
      SELECT id, company_id, email, name, role, password_hash, created_at, session_epoch FROM users;
      DROP TABLE users;
      ALTER TABLE users_next RENAME TO users;
      CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
      PRAGMA foreign_keys = ON;
    `)
  }

  private keepCompanyAccounts() {
    const rows = this.db.prepare(
      `SELECT u.company_id, u.name
       FROM users u
       WHERE u.role = 'member'
         AND (SELECT COUNT(*) FROM users x WHERE x.company_id = u.company_id) = 1`,
    ).all() as { company_id: string, name: string }[]
    const fillName = this.db.prepare(
      `UPDATE companies SET name = ? WHERE id = ? AND trim(name) = ''`,
    )
    for (const row of rows) fillName.run(row.name, row.company_id)
  }

  async getUserByEmail(email: string) {
    const row = this.db.prepare(
      `SELECT u.id, u.company_id, u.email, u.name, u.role, u.password_hash, COALESCE(c.name, '') AS company_name
       FROM users u LEFT JOIN companies c ON c.id = u.company_id
       WHERE lower(u.email) = lower(?)`,
    ).get(email) as
      | {
          id: string
          company_id: string
          email: string
          name: string
          role: Role
          password_hash: string
          company_name: string
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      companyId: row.company_id ?? '',
      companyName: row.company_name ?? '',
      role: row.role,
      passwordHash: row.password_hash,
    }
  }

  async getUserById(id: string): Promise<SessionUser | null> {
    const row = this.db.prepare(
      `SELECT u.id, u.company_id, u.email, u.name, u.role, COALESCE(c.name, '') AS company_name
       FROM users u LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = ?`,
    ).get(id) as
      | {
          id: string
          company_id: string
          email: string
          name: string
          role: Role
          company_name: string
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      companyId: row.company_id ?? '',
      companyName: row.company_name ?? '',
      role: row.role,
    }
  }

  async insertCompany(id: string, name: string) {
    this.db.prepare(
      'INSERT OR IGNORE INTO companies (id, name, created_at) VALUES (?, ?, ?)',
    ).run(id, name, new Date().toISOString())
  }

  async insertUser(input: {
    id: string
    companyId: string
    email: string
    name: string
    role: Role
    passwordHash: string
  }) {
    this.db.prepare(
      `INSERT OR IGNORE INTO users (id, company_id, email, name, role, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.companyId,
      input.email,
      input.name,
      input.role,
      input.passwordHash,
      new Date().toISOString(),
    )
  }

  async createCompanyAccount(input: {
    companyId: string
    companyName: string
    userId: string
    email: string
    name: string
    passwordHash: string
  }) {
    const email = input.email.trim().toLowerCase()
    const existing = this.db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email) as { id: string } | undefined
    if (existing) throw new AppError('هذا البريد مسجّل بالفعل. سجّل الدخول بدل إنشاء حساب جديد.', 409, 'EMAIL_TAKEN')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(
        'INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)',
      ).run(input.companyId, input.companyName, new Date().toISOString())
      this.db.prepare(
        `INSERT INTO users (id, company_id, email, name, role, password_hash, created_at)
         VALUES (?, ?, ?, ?, 'member', ?, ?)`,
      ).run(input.userId, input.companyId, email, input.name, input.passwordHash, new Date().toISOString())
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        throw new AppError('هذا البريد مسجّل بالفعل. سجّل الدخول بدل إنشاء حساب جديد.', 409, 'EMAIL_TAKEN')
      }
      throw error
    }
  }

  async createProviderAccount(input: {
    userId: string
    email: string
    name: string
    passwordHash: string
  }) {
    const email = input.email.trim().toLowerCase()
    const existing = this.db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email) as { id: string } | undefined
    if (existing) throw new AppError('هذا البريد مسجّل بالفعل. سجّل الدخول بدل إنشاء حساب جديد.', 409, 'EMAIL_TAKEN')
    this.db.prepare(
      `INSERT INTO users (id, company_id, email, name, role, password_hash, created_at)
       VALUES (?, NULL, ?, ?, 'provider', ?, ?)`,
    ).run(input.userId, email, input.name, input.passwordHash, new Date().toISOString())
  }

  async deleteUser(userId: string) {
    this.db.prepare(`DELETE FROM users WHERE id = ?`).run(userId)
  }

  async upsertCompany(id: string, name: string) {
    this.db.prepare(
      `INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    ).run(id, name, new Date().toISOString())
  }

  async renameCompany(companyId: string, name: string) {
    this.db.prepare('UPDATE companies SET name = ? WHERE id = ?').run(name, companyId)
  }

  async updateUserName(userId: string, name: string) {
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId)
  }

  async sessionEpoch(userId: string) {
    const row = this.db.prepare('SELECT session_epoch FROM users WHERE id = ?').get(userId) as { session_epoch: number } | undefined
    return row?.session_epoch ?? 0
  }

  async bumpSessionEpoch(userId: string) {
    this.db.prepare('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?').run(userId)
  }

  async upsertUser(input: {
    id: string
    companyId: string
    email: string
    name: string
    role: Role
    passwordHash: string
  }) {
    this.db.prepare(
      `INSERT INTO users (id, company_id, email, name, role, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         company_id = excluded.company_id,
         email = excluded.email,
         name = excluded.name,
         role = excluded.role,
         password_hash = excluded.password_hash`,
    ).run(
      input.id,
      input.companyId,
      input.email,
      input.name,
      input.role,
      input.passwordHash,
      new Date().toISOString(),
    )
  }

  async removeCompany(companyId: string, userIds: string[]) {
    const marks = userIds.map(() => '?').join(', ')
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM chunks WHERE company_id = ?').run(companyId)
      if (userIds.length) {
        this.db.prepare(`DELETE FROM chunks WHERE document_id IN (SELECT id FROM documents WHERE created_by IN (${marks}))`).run(...userIds)
        this.db.prepare(`DELETE FROM documents WHERE company_id = ? OR created_by IN (${marks})`).run(companyId, ...userIds)
        this.db.prepare(`DELETE FROM audit_logs WHERE company_id = ? OR actor_user_id IN (${marks})`).run(companyId, ...userIds)
        this.db.prepare(`DELETE FROM users WHERE company_id = ? OR id IN (${marks})`).run(companyId, ...userIds)
      } else {
        this.db.prepare('DELETE FROM documents WHERE company_id = ?').run(companyId)
        this.db.prepare('DELETE FROM audit_logs WHERE company_id = ?').run(companyId)
        this.db.prepare('DELETE FROM users WHERE company_id = ?').run(companyId)
      }
      this.db.prepare('DELETE FROM companies WHERE id = ?').run(companyId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async createDocument(
    input: Omit<KnowledgeDocument, 'chunkCount' | 'deletedAt' | 'errorCode' | 'errorMessage'> & {
      errorCode?: string | null
      errorMessage?: string | null
    },
  ) {
    requireCompanyId(input.companyId)
    this.db.prepare(
      `INSERT INTO documents (
        id, company_id, filename, mime_type, byte_size, status, error_code, error_message,
        chunk_count, created_at, updated_at, deleted_at, expires_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)`,
    ).run(
      input.id,
      input.companyId,
      input.filename,
      input.mimeType,
      input.byteSize,
      input.status,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.createdAt,
      input.updatedAt,
      input.expiresAt,
      input.createdBy,
    )
    return (await this.getDocument(input.companyId, input.id))!
  }

  async listDocuments(companyId: string) {
    requireCompanyId(companyId)
    const rows = this.db.prepare(
      `SELECT * FROM documents WHERE company_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    ).all(companyId) as Record<string, unknown>[]
    return rows.map(mapDocument)
  }

  async getDocument(companyId: string, documentId: string) {
    requireCompanyId(companyId)
    const row = this.db.prepare(
      `SELECT * FROM documents WHERE id = ? AND company_id = ? AND deleted_at IS NULL`,
    ).get(documentId, companyId) as Record<string, unknown> | undefined
    return row ? mapDocument(row) : null
  }

  async updateDocument(
    companyId: string,
    documentId: string,
    patch: Partial<Pick<KnowledgeDocument, 'status' | 'errorCode' | 'errorMessage' | 'chunkCount' | 'updatedAt'>>,
  ) {
    const current = await this.getDocument(companyId, documentId)
    if (!current) return null
    const next = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt || new Date().toISOString(),
    }
    this.db.prepare(
      `UPDATE documents SET status = ?, error_code = ?, error_message = ?, chunk_count = ?, updated_at = ?
       WHERE id = ? AND company_id = ? AND deleted_at IS NULL`,
    ).run(
      next.status,
      next.errorCode,
      next.errorMessage,
      next.chunkCount,
      next.updatedAt,
      documentId,
      companyId,
    )
    return this.getDocument(companyId, documentId)
  }

  async softDeleteDocument(companyId: string, documentId: string, at: string) {
    requireCompanyId(companyId)
    const result = this.db.prepare(
      `UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ? AND company_id = ? AND deleted_at IS NULL`,
    ).run(at, at, documentId, companyId)
    if (!result.changes) return false
    this.db.prepare(`DELETE FROM chunks WHERE document_id = ? AND company_id = ?`).run(documentId, companyId)
    return true
  }

  async replaceChunks(companyId: string, documentId: string, chunks: Omit<KnowledgeChunk, 'filename'>[]) {
    requireCompanyId(companyId)
    const owned = await this.getDocument(companyId, documentId)
    if (!owned) throw new AppError('المستند غير موجود ضمن شركتك', 404, 'NOT_FOUND')
    const del = this.db.prepare(`DELETE FROM chunks WHERE document_id = ? AND company_id = ?`)
    const ins = this.db.prepare(
      `INSERT INTO chunks (id, document_id, company_id, chunk_index, content, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const now = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      del.run(documentId, companyId)
      for (const chunk of chunks) {
        if (chunk.companyId !== companyId) {
          throw new AppError('رفض كتابة مقطع خارج نطاق الشركة', 403, 'TENANT_ISOLATION')
        }
        ins.run(
          chunk.id,
          documentId,
          companyId,
          chunk.chunkIndex,
          chunk.content,
          floatsToBlob(chunk.embedding),
          now,
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async searchChunks(companyId: string, queryEmbedding: number[], limit: number): Promise<RetrievedChunk[]> {
    requireCompanyId(companyId)
    const rows = this.db.prepare(
      `SELECT c.id, c.document_id, c.company_id, c.chunk_index, c.content, c.embedding, d.filename
       FROM chunks c
       INNER JOIN documents d ON d.id = c.document_id
       WHERE c.company_id = ?
         AND d.company_id = ?
         AND d.deleted_at IS NULL
         AND d.status = 'ready'`,
    ).all(companyId, companyId) as {
      id: string
      document_id: string
      company_id: string
      chunk_index: number
      content: string
      embedding: Uint8Array
      filename: string
    }[]

    return rows
      .flatMap((row) => {
        const stored = blobToFloats(row.embedding)
        if (stored.length !== queryEmbedding.length || row.company_id !== companyId) return []
        return [
          {
            id: row.id,
            documentId: row.document_id,
            companyId: row.company_id,
            chunkIndex: row.chunk_index,
            content: row.content,
            filename: row.filename,
            similarity: cosineSimilarity(queryEmbedding, stored),
          },
        ]
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
  }

  async storedEmbeddingDimension() {
    const row = this.db.prepare('SELECT embedding FROM chunks LIMIT 1').get() as
      | { embedding: Uint8Array }
      | undefined
    if (!row) return null
    return blobToFloats(row.embedding).length
  }

  async listCompanyUsers(companyId: string) {
    const rows = this.db.prepare(
      `SELECT id, email, name, role, created_at FROM users WHERE company_id = ? ORDER BY created_at ASC`,
    ).all(requireCompanyId(companyId)) as { id: string, email: string, name: string, role: Role, created_at: string }[]
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: accountCreatedAt(row.created_at),
    }))
  }

  async listIndependentClients() {
    const rows = this.db.prepare(
      `SELECT u.id, u.email, u.name, u.company_id, u.created_at
       FROM users u
       WHERE u.role = 'member'
         AND (SELECT COUNT(*) FROM users x WHERE x.company_id = u.company_id) = 1
       ORDER BY u.created_at DESC`,
    ).all() as { id: string, email: string, name: string, company_id: string, created_at: string }[]
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      companyId: row.company_id,
      createdAt: accountCreatedAt(row.created_at),
    }))
  }

  async activeActorIds(companyId: string, fromIso: string, toIso: string) {
    const marks = ACTIVITY_ACTIONS.map(() => '?').join(',')
    const rows = this.db.prepare(
      `SELECT DISTINCT a.actor_user_id AS id
       FROM audit_logs a
       JOIN users u ON u.id = a.actor_user_id AND u.company_id = a.company_id
       WHERE a.company_id = ? AND a.result IN ('ok', 'error') AND a.action IN (${marks})
         AND a.at >= ? AND a.at <= ?`,
    ).all(companyId, ...ACTIVITY_ACTIONS, fromIso, toIso) as { id: string }[]
    return rows.map((row) => row.id)
  }

  async activeActorIdsAll(fromIso: string, toIso: string) {
    const marks = ACTIVITY_ACTIONS.map(() => '?').join(',')
    const rows = this.db.prepare(
      `SELECT DISTINCT a.actor_user_id AS id
       FROM audit_logs a
       JOIN users u ON u.id = a.actor_user_id AND u.company_id = a.company_id
       WHERE a.result IN ('ok', 'error') AND a.action IN (${marks})
         AND a.at >= ? AND a.at <= ?`,
    ).all(...ACTIVITY_ACTIONS, fromIso, toIso) as { id: string }[]
    return rows.map((row) => row.id)
  }

  async listPlatformCompanies() {
    const columns = new Set((this.db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map((column) => column.name))
    const statusSql = columns.has('status') ? 'u.status' : 'NULL'
    const deletedSql = columns.has('deleted_at') ? 'u.deleted_at' : 'NULL'
    const rows = this.db.prepare(
      `SELECT c.id AS company_id, c.name AS company_name, c.created_at AS company_created,
              u.id AS user_id, u.email, u.name AS user_name, u.role, u.created_at AS user_created,
              ${statusSql} AS status, ${deletedSql} AS deleted_at
       FROM companies c
       LEFT JOIN users u ON u.company_id = c.id
       ORDER BY c.created_at ASC, u.created_at ASC`,
    ).all() as {
      company_id: string
      company_name: string
      company_created: string
      user_id: string | null
      email: string | null
      user_name: string | null
      role: Role | null
      user_created: string | null
      status: string | null
      deleted_at: string | null
    }[]
    return groupCompanies(rows.map((row) => ({
      companyId: row.company_id,
      companyName: row.company_name,
      companyCreated: row.company_created,
      userId: row.user_id,
      email: row.email,
      userName: row.user_name,
      role: row.role,
      userCreated: row.user_created,
      status: row.status,
      deletedAt: row.deleted_at,
    })))
  }

  async audit(event: AuditEvent) {
    this.db.prepare(
      `INSERT INTO audit_logs (id, at, actor_user_id, company_id, action, target_type, target_id, ip, result, extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('aud'),
      new Date().toISOString(),
      event.actorUserId,
      event.companyId,
      event.action,
      event.targetType,
      event.targetId,
      event.ip,
      event.result,
      event.extra ? JSON.stringify(event.extra) : null,
    )
  }

  async purgeExpired(nowIso: string) {
    const expired = this.db.prepare(
      `SELECT id, company_id FROM documents WHERE expires_at IS NOT NULL AND expires_at <= ?`,
    ).all(nowIso) as { id: string; company_id: string }[]
    for (const row of expired) {
      this.db.prepare(`DELETE FROM chunks WHERE document_id = ? AND company_id = ?`).run(row.id, row.company_id)
      this.db.prepare(`DELETE FROM documents WHERE id = ? AND company_id = ?`).run(row.id, row.company_id)
      await this.audit({
        actorUserId: null,
        companyId: row.company_id,
        action: 'document.purge_expired',
        targetType: 'document',
        targetId: row.id,
        ip: null,
        result: 'ok',
      })
    }
    return expired.length
  }

  async ping() {
    try {
      const row = this.db.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined
      return row?.ok === 1
    } catch {
      return false
    }
  }

  async close() {
    this.db.close()
  }
}

export async function createPostgresStore(config: AppConfig): Promise<KnowledgeStore> {
  if (!config.databaseUrl) {
    throw new AppError('DATABASE_URL مطلوب لمخزن Postgres', 500, 'DATABASE_URL_MISSING')
  }
  const pool = new pg.Pool({ connectionString: config.databaseUrl })
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'db/schema.postgres.sql')
  await pool.query(readFileSync(schemaPath, 'utf8'))
  return new PostgresStore(pool)
}

class PostgresStore implements KnowledgeStore {
  constructor(private pool: pg.Pool) {}

  async getUserByEmail(email: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.company_id, u.email, u.name, u.role, u.password_hash, COALESCE(c.name, '') AS company_name
       FROM users u LEFT JOIN companies c ON c.id = u.company_id
       WHERE lower(u.email) = lower($1)`,
      [email],
    )
    const row = rows[0]
    if (!row) return null
    return mapUser(row)
  }

  async getUserById(id: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.company_id, u.email, u.name, u.role, COALESCE(c.name, '') AS company_name
       FROM users u LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = $1`,
      [id],
    )
    const row = rows[0]
    if (!row) return null
    const { passwordHash: _, ...user } = mapUser({ ...row, password_hash: '' })
    void _
    return user
  }

  async insertCompany(id: string, name: string) {
    await this.pool.query(
      `INSERT INTO companies (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, name],
    )
  }

  async insertUser(input: {
    id: string
    companyId: string
    email: string
    name: string
    role: Role
    passwordHash: string
  }) {
    await this.pool.query(
      `INSERT INTO users (id, company_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [input.id, input.companyId, input.email, input.name, input.role, input.passwordHash],
    )
  }

  async createCompanyAccount(input: {
    companyId: string
    companyName: string
    userId: string
    email: string
    name: string
    passwordHash: string
  }) {
    const email = input.email.trim().toLowerCase()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const existing = await client.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email])
      if (existing.rows[0]) throw new AppError('هذا البريد مسجّل بالفعل. سجّل الدخول بدل إنشاء حساب جديد.', 409, 'EMAIL_TAKEN')
      await client.query('INSERT INTO companies (id, name) VALUES ($1, $2)', [input.companyId, input.companyName])
      await client.query(
        `INSERT INTO users (id, company_id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, 'member', $5)`,
        [input.userId, input.companyId, email, input.name, input.passwordHash],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: string }).code === '23505') {
        throw new AppError('هذا البريد مسجّل بالفعل. سجّل الدخول بدل إنشاء حساب جديد.', 409, 'EMAIL_TAKEN')
      }
      throw error
    } finally {
      client.release()
    }
  }

  async createProviderAccount(input: {
    userId: string
    email: string
    name: string
    passwordHash: string
  }) {
    const email = input.email.trim().toLowerCase()
    try {
      await this.pool.query(
        `INSERT INTO users (id, company_id, email, name, role, password_hash) VALUES ($1, NULL, $2, $3, 'provider', $4)`,
        [input.userId, email, input.name, input.passwordHash],
      )
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: string }).code === '23505') {
        throw new AppError('هذا البريد مسجّل بالفعل. سجّل الدخول بدل إنشاء حساب جديد.', 409, 'EMAIL_TAKEN')
      }
      throw error
    }
  }

  async deleteUser(userId: string) {
    await this.pool.query('DELETE FROM users WHERE id = $1', [userId])
  }

  async upsertCompany(id: string, name: string) {
    await this.pool.query(
      `INSERT INTO companies (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [id, name],
    )
  }

  async renameCompany(companyId: string, name: string) {
    await this.pool.query('UPDATE companies SET name = $1 WHERE id = $2', [name, companyId])
  }

  async updateUserName(userId: string, name: string) {
    await this.pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId])
  }

  async sessionEpoch(userId: string) {
    const { rows } = await this.pool.query('SELECT session_epoch FROM users WHERE id = $1', [userId])
    return Number(rows[0]?.session_epoch ?? 0)
  }

  async bumpSessionEpoch(userId: string) {
    await this.pool.query('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = $1', [userId])
  }

  async upsertUser(input: {
    id: string
    companyId: string
    email: string
    name: string
    role: Role
    passwordHash: string
  }) {
    await this.pool.query(
      `INSERT INTO users (id, company_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         company_id = EXCLUDED.company_id,
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         password_hash = EXCLUDED.password_hash`,
      [input.id, input.companyId, input.email, input.name, input.role, input.passwordHash],
    )
  }

  async removeCompany(companyId: string, userIds: string[]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM chunks WHERE company_id = $1', [companyId])
      if (userIds.length) {
        await client.query('DELETE FROM chunks WHERE document_id IN (SELECT id FROM documents WHERE created_by = ANY($1::text[]))', [userIds])
        await client.query('DELETE FROM documents WHERE company_id = $1 OR created_by = ANY($2::text[])', [companyId, userIds])
        await client.query('DELETE FROM audit_logs WHERE company_id = $1 OR actor_user_id = ANY($2::text[])', [companyId, userIds])
        await client.query('DELETE FROM users WHERE company_id = $1 OR id = ANY($2::text[])', [companyId, userIds])
      } else {
        await client.query('DELETE FROM documents WHERE company_id = $1', [companyId])
        await client.query('DELETE FROM audit_logs WHERE company_id = $1', [companyId])
        await client.query('DELETE FROM users WHERE company_id = $1', [companyId])
      }
      await client.query('DELETE FROM companies WHERE id = $1', [companyId])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async createDocument(
    input: Omit<KnowledgeDocument, 'chunkCount' | 'deletedAt' | 'errorCode' | 'errorMessage'> & {
      errorCode?: string | null
      errorMessage?: string | null
    },
  ) {
    requireCompanyId(input.companyId)
    await this.pool.query(
      `INSERT INTO documents (
        id, company_id, filename, mime_type, byte_size, status, error_code, error_message,
        chunk_count, created_at, updated_at, expires_at, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12)`,
      [
        input.id,
        input.companyId,
        input.filename,
        input.mimeType,
        input.byteSize,
        input.status,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.createdAt,
        input.updatedAt,
        input.expiresAt,
        input.createdBy,
      ],
    )
    return (await this.getDocument(input.companyId, input.id))!
  }

  async listDocuments(companyId: string) {
    requireCompanyId(companyId)
    const { rows } = await this.pool.query(
      `SELECT * FROM documents WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [companyId],
    )
    return rows.map(mapDocument)
  }

  async getDocument(companyId: string, documentId: string) {
    requireCompanyId(companyId)
    const { rows } = await this.pool.query(
      `SELECT * FROM documents WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [documentId, companyId],
    )
    return rows[0] ? mapDocument(rows[0]) : null
  }

  async updateDocument(
    companyId: string,
    documentId: string,
    patch: Partial<Pick<KnowledgeDocument, 'status' | 'errorCode' | 'errorMessage' | 'chunkCount' | 'updatedAt'>>,
  ) {
    const current = await this.getDocument(companyId, documentId)
    if (!current) return null
    const next = { ...current, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() }
    await this.pool.query(
      `UPDATE documents SET status = $1, error_code = $2, error_message = $3, chunk_count = $4, updated_at = $5
       WHERE id = $6 AND company_id = $7 AND deleted_at IS NULL`,
      [next.status, next.errorCode, next.errorMessage, next.chunkCount, next.updatedAt, documentId, companyId],
    )
    return this.getDocument(companyId, documentId)
  }

  async softDeleteDocument(companyId: string, documentId: string, at: string) {
    requireCompanyId(companyId)
    const result = await this.pool.query(
      `UPDATE documents SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND company_id = $3 AND deleted_at IS NULL`,
      [at, documentId, companyId],
    )
    if (!result.rowCount) return false
    await this.pool.query(`DELETE FROM chunks WHERE document_id = $1 AND company_id = $2`, [
      documentId,
      companyId,
    ])
    return true
  }

  async replaceChunks(companyId: string, documentId: string, chunks: Omit<KnowledgeChunk, 'filename'>[]) {
    requireCompanyId(companyId)
    const owned = await this.getDocument(companyId, documentId)
    if (!owned) throw new AppError('المستند غير موجود ضمن شركتك', 404, 'NOT_FOUND')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`DELETE FROM chunks WHERE document_id = $1 AND company_id = $2`, [
        documentId,
        companyId,
      ])
      for (const chunk of chunks) {
        if (chunk.companyId !== companyId) {
          throw new AppError('رفض كتابة مقطع خارج نطاق الشركة', 403, 'TENANT_ISOLATION')
        }
        await client.query(
          `INSERT INTO chunks (id, document_id, company_id, chunk_index, content, embedding)
           VALUES ($1,$2,$3,$4,$5,$6::vector)`,
          [
            chunk.id,
            documentId,
            companyId,
            chunk.chunkIndex,
            chunk.content,
            `[${chunk.embedding.join(',')}]`,
          ],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async searchChunks(companyId: string, queryEmbedding: number[], limit: number) {
    requireCompanyId(companyId)
    const vector = `[${queryEmbedding.join(',')}]`
    const { rows } = await this.pool.query(
      `SELECT c.id, c.document_id, c.company_id, c.chunk_index, c.content, d.filename,
              1 - (c.embedding <=> $2::vector) AS similarity
       FROM chunks c
       INNER JOIN documents d ON d.id = c.document_id
       WHERE c.company_id = $1
         AND d.company_id = $1
         AND d.deleted_at IS NULL
         AND d.status = 'ready'
       ORDER BY c.embedding <=> $2::vector
       LIMIT $3`,
      [companyId, vector, limit],
    )
    return rows
      .filter((row) => row.company_id === companyId)
      .map((row) => ({
        id: row.id,
        documentId: row.document_id,
        companyId: row.company_id,
        chunkIndex: row.chunk_index,
        content: row.content,
        filename: row.filename,
        similarity: Number(row.similarity),
      }))
  }

  async listCompanyUsers(companyId: string) {
    const { rows } = await this.pool.query<{ id: string, email: string, name: string, role: Role, created_at: string }>(
      `SELECT id, email, name, role, created_at FROM users WHERE company_id = $1 ORDER BY created_at ASC`,
      [requireCompanyId(companyId)],
    )
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: accountCreatedAt(row.created_at),
    }))
  }

  async listIndependentClients() {
    const { rows } = await this.pool.query<{ id: string, email: string, name: string, company_id: string, created_at: string }>(
      `SELECT u.id, u.email, u.name, u.company_id, u.created_at
       FROM users u
       WHERE u.role = 'member'
         AND (SELECT COUNT(*) FROM users x WHERE x.company_id = u.company_id) = 1
       ORDER BY u.created_at DESC`,
    )
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      companyId: row.company_id,
      createdAt: accountCreatedAt(row.created_at),
    }))
  }

  async activeActorIds(companyId: string, fromIso: string, toIso: string) {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT DISTINCT a.actor_user_id AS id
       FROM audit_logs a
       JOIN users u ON u.id = a.actor_user_id AND u.company_id = a.company_id
       WHERE a.company_id = $1 AND a.result IN ('ok', 'error') AND a.action = ANY($2::text[])
         AND a.at >= $3 AND a.at <= $4`,
      [companyId, ACTIVITY_ACTIONS, fromIso, toIso],
    )
    return rows.map((row) => row.id)
  }

  async activeActorIdsAll(fromIso: string, toIso: string) {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT DISTINCT a.actor_user_id AS id
       FROM audit_logs a
       JOIN users u ON u.id = a.actor_user_id AND u.company_id = a.company_id
       WHERE a.result IN ('ok', 'error') AND a.action = ANY($1::text[])
         AND a.at >= $2 AND a.at <= $3`,
      [ACTIVITY_ACTIONS, fromIso, toIso],
    )
    return rows.map((row) => row.id)
  }

  async listPlatformCompanies() {
    const { rows } = await this.pool.query<{
      company_id: string
      company_name: string
      company_created: string
      user_id: string | null
      email: string | null
      user_name: string | null
      role: Role | null
      user_created: string | null
    }>(
      `SELECT c.id AS company_id, c.name AS company_name, c.created_at AS company_created,
              u.id AS user_id, u.email, u.name AS user_name, u.role, u.created_at AS user_created
       FROM companies c
       LEFT JOIN users u ON u.company_id = c.id
       ORDER BY c.created_at ASC, u.created_at ASC`,
    )
    return groupCompanies(rows.map((row) => ({
      companyId: row.company_id,
      companyName: row.company_name,
      companyCreated: row.company_created,
      userId: row.user_id,
      email: row.email,
      userName: row.user_name,
      role: row.role,
      userCreated: row.user_created,
      status: null,
      deletedAt: null,
    })))
  }

  async audit(event: AuditEvent) {
    await this.pool.query(
      `INSERT INTO audit_logs (id, actor_user_id, company_id, action, target_type, target_id, ip, result, extra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        newId('aud'),
        event.actorUserId,
        event.companyId,
        event.action,
        event.targetType,
        event.targetId,
        event.ip,
        event.result,
        event.extra ? JSON.stringify(event.extra) : null,
      ],
    )
  }

  async storedEmbeddingDimension() {
    const { rows } = await this.pool.query(
      `SELECT vector_dims(embedding)::int AS d FROM chunks LIMIT 1`,
    )
    const value = rows[0]?.d
    return typeof value === 'number' ? value : null
  }

  async purgeExpired(nowIso: string) {
    const { rows } = await this.pool.query(
      `SELECT id, company_id FROM documents WHERE expires_at IS NOT NULL AND expires_at <= $1`,
      [nowIso],
    )
    for (const row of rows) {
      await this.pool.query(`DELETE FROM chunks WHERE document_id = $1 AND company_id = $2`, [
        row.id,
        row.company_id,
      ])
      await this.pool.query(`DELETE FROM documents WHERE id = $1 AND company_id = $2`, [
        row.id,
        row.company_id,
      ])
      await this.audit({
        actorUserId: null,
        companyId: row.company_id,
        action: 'document.purge_expired',
        targetType: 'document',
        targetId: row.id,
        ip: null,
        result: 'ok',
      })
    }
    return rows.length
  }

  async ping() {
    try {
      const result = await this.pool.query('SELECT 1 AS ok')
      return Number(result.rows[0]?.ok) === 1
    } catch {
      return false
    }
  }

  async close() {
    await this.pool.end()
  }
}

function mapUser(row: {
  id: string
  company_id: string
  email: string
  name: string
  role: Role
  password_hash: string
  company_name: string
}): UserRow {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    companyId: row.company_id ?? '',
    companyName: row.company_name ?? '',
    role: row.role,
    passwordHash: row.password_hash,
  }
}

function mapDocument(row: Record<string, unknown>): KnowledgeDocument {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    byteSize: Number(row.byte_size),
    status: row.status as KnowledgeDocument['status'],
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    chunkCount: Number(row.chunk_count),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    deletedAt: row.deleted_at ? new Date(String(row.deleted_at)).toISOString() : null,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    createdBy: String(row.created_by),
  }
}
