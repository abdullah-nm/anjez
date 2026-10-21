export type Role = 'admin' | 'member'

export type DocumentStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'error'
  | 'unsupported'

export type SessionUser = {
  id: string
  email: string
  name: string
  companyId: string
  companyName: string
  role: Role
}

export type KnowledgeDocument = {
  id: string
  companyId: string
  filename: string
  mimeType: string
  byteSize: number
  status: DocumentStatus
  errorCode: string | null
  errorMessage: string | null
  chunkCount: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  expiresAt: string | null
  createdBy: string
}

export type KnowledgeChunk = {
  id: string
  documentId: string
  companyId: string
  chunkIndex: number
  content: string
  filename: string
  embedding: number[]
}

export type RetrievedChunk = {
  id: string
  documentId: string
  companyId: string
  chunkIndex: number
  content: string
  filename: string
  similarity: number
}

export type EmbeddingProvider = {
  name: string
  dimensions: number
  embed(texts: string[]): Promise<number[][]>
}

export type LlmProvider = {
  name: string
  complete(input: {
    system: string
    user: string
  }): Promise<string>
}

export type AuditEvent = {
  actorUserId: string | null
  companyId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  ip: string | null
  result: 'ok' | 'denied' | 'error'
  extra?: Record<string, string | number | boolean | null>
}
