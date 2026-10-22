import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from './lib/crypto.ts'
import { saveOriginal } from './lib/files.ts'
import { ingestBuffer } from './rag.ts'
import type { KnowledgeStore } from './store.ts'
import type { EmbeddingProvider, SessionUser } from './types.ts'
import type { AppConfig } from './config.ts'

const here = dirname(fileURLToPath(import.meta.url))

export const DEMO_PASSWORD = 'AnjzDemo!26'

export const DEMO_COMPANIES = [
  { id: 'company_almarai', name: 'المراعي' },
  { id: 'company_qimam', name: 'قمم للفعاليات' },
] as const

export const DEMO_USERS = [
  {
    id: 'user_almarai_admin',
    companyId: 'company_almarai',
    email: 'nasser@almarai.com',
    name: 'ناصر الحربي',
    role: 'admin' as const,
  },
  {
    id: 'user_fahd',
    companyId: 'company_qimam',
    email: 'fahd@qimam.sa',
    name: 'فهد القحطاني',
    role: 'admin' as const,
  },
  {
    id: 'user_almarai_member',
    companyId: 'company_almarai',
    email: 'hind@almarai.com',
    name: 'هند السبيعي',
    role: 'member' as const,
  },
]

const LEGACY_NEBRAS_USERS = ['user_sara', 'user_lina']

export async function seedAccounts(store: KnowledgeStore) {
  await store.removeCompany('company_nebras', LEGACY_NEBRAS_USERS)
  const passwordHash = hashPassword(DEMO_PASSWORD)
  for (const company of DEMO_COMPANIES) {
    await store.upsertCompany(company.id, company.name)
  }
  for (const user of DEMO_USERS) {
    await store.upsertUser({ ...user, passwordHash })
  }
}

export async function seedDocuments(input: {
  store: KnowledgeStore
  embeddings: EmbeddingProvider
  config: AppConfig
}) {
  const files = [
    {
      companyId: 'company_almarai',
      userId: 'user_almarai_admin',
      filename: 'almarai-print-policy.md',
    },
    {
      companyId: 'company_qimam',
      userId: 'user_fahd',
      filename: 'qimam-print-policy.md',
    },
  ]

  for (const file of files) {
    const user = (await input.store.getUserById(file.userId)) as SessionUser
    const existing = (await input.store.listDocuments(file.companyId)).find(
      (doc) => doc.filename === file.filename && doc.status === 'ready',
    )
    if (existing) continue
    const buffer = readFileSync(join(here, 'fixtures', file.filename))
    const document = await ingestBuffer({
      store: input.store,
      embeddings: input.embeddings,
      user,
      filename: file.filename,
      mimeType: 'text/markdown',
      buffer,
      config: input.config,
    })
    if (document) {
      saveOriginal(input.config.uploadRoot, file.companyId, document.id, file.filename, buffer)
    }
  }
}
