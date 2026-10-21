import { newId } from '../lib/crypto.ts'
import { daysUntil, riyadhYmd } from './occasions.ts'
import type { PlatformStore } from './store.ts'

export function dispatchDueReminders(platform: PlatformStore, now = new Date()) {
  const today = riyadhYmd(now)
  let created = 0
  for (const event of platform.dueEvents()) {
    const remaining = daysUntil(event.date, today)
    for (const offset of event.reminderDays) {
      if (remaining !== offset) continue
      if (!platform.claimDelivery(event.companyId, event.id, offset, today)) continue
      const recipients = platform.companyUserIds(event.companyId, event.createdBy)
      for (const userId of recipients) {
        platform.insertNotification({
          id: newId('ntf'),
          companyId: event.companyId,
          userId,
          eventId: event.id,
          designId: null,
          title: `تذكير: ${event.title}`,
          body: `باقي ${offset} يوم على المناسبة (تقويم الرياض).`,
          readAt: null,
          createdAt: now.toISOString(),
        })
      }
      created += 1
    }
  }
  return { created, day: today }
}
