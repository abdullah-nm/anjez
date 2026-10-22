import { newId } from '../lib/crypto.ts'
import { addDays, riyadhYmd } from './occasions.ts'
import type { PlatformStore } from './store.ts'

const DEMO_COMPANIES = [
  {
    id: 'company_almarai',
    adminId: 'user_almarai_admin',
    title: '[تجريبي] إطلاق منتج',
    audience: 'عملاء المراعي',
    category: 'launch' as const,
  },
  {
    id: 'company_qimam',
    adminId: 'user_fahd',
    title: '[تجريبي] مؤتمر الشركاء',
    audience: 'شركاء الفعاليات',
    category: 'conference' as const,
  },
]

/** Labeled fixture events only. Never inserts into unknown company_ids. */
export function seedPlatformDemo(platform: PlatformStore) {
  platform.purgeCompany('company_nebras', ['user_sara', 'user_lina'])
  const now = new Date().toISOString()
  const today = riyadhYmd()

  for (const company of DEMO_COMPANIES) {
    platform.reassignEventCreator(company.id, 'seed', company.adminId)
    if (platform.listEvents(company.id).length > 0) continue

    platform.insertEvent({
      id: newId('evt'),
      companyId: company.id,
      title: company.title,
      date: addDays(today, 7),
      time: '10:00',
      description:
        'سجل تجريبي معزول لهذه الشركة فقط. يظهر تذكير اليوم لأن الموعد بعد 7 أيام. احذفه من التقويم إن لم تعد بحاجة إليه.',
      category: company.category,
      audience: company.audience,
      status: 'planned',
      reminderDays: [7, 1],
      occasionKey: 'demo:seed',
      recurring: false,
      dateCertainty: 'official',
      dateNote: 'موعد تجريبي داخل الشركة، وليس مناسبة رسمية.',
      createdBy: company.adminId,
      createdAt: now,
      updatedAt: now,
    })
  }
}
