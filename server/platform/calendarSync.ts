import { AppError } from '../lib/errors.ts'
import { hijriParts, nextHijriDate } from './hijri.ts'
import { nextFixedDate, occasionByKey, occasionCatalog, riyadhYmd } from './occasions.ts'
import type { PlatformStore } from './store.ts'
import type { DateCertainty, SystemOccasionRecord } from './types.ts'

export const HIJRI_SOURCE = 'تقويم أم القرى (ICU islamic-umalqura)'
export const FIXED_SOURCE = 'تاريخ ميلادي ثابت في المملكة'
export const SEASON_SOURCE = 'لا يتوفر مصدر آلي رسمي. التحديث من سجل مسؤول النظام بعد الإعلان.'
const FIXED_NOTE = 'تاريخ ميلادي ثابت ويتكرر كل سنة.'
const HIJRI_NOTE = 'تاريخ متوقع وفق تقويم أم القرى. تقديري إلى حين إعلان رؤية الهلال. يلزم التحقق من الإعلان الرسمي.'
const SEASON_NOTE = 'بانتظار الإعلان الرسمي. لا يُعرض كتاريخ مؤكد ولا يُرسل له تذكير.'
const STALE_MESSAGE = 'تعذر تحديث تقويم أم القرى. يُعرض آخر موعد موثوق.'

export type HijriResolution = { date: string, cycle: string } | null

type SyncOptions = {
  resolveHijri?: (month: number, day: number, today: string) => HijriResolution
}

export function isSystemEventId(id: string) {
  return id.startsWith('sys:')
}

export function publicSystemOccasion(row: SystemOccasionRecord) {
  return {
    id: `sys:${row.key}`,
    key: row.key,
    title: row.titleAr,
    titleAr: row.titleAr,
    titleEn: row.titleEn,
    date: row.date,
    category: row.category,
    dateCertainty: row.dateCertainty,
    dateNote: row.dateNote,
    source: row.source,
    cycle: row.cycle,
    recurring: row.recurring,
    checkedAt: row.checkedAt,
    syncStatus: row.syncStatus,
    history: row.history,
    scope: 'system' as const,
  }
}

export function syncSystemOccasions(platform: PlatformStore, now = new Date(), options: SyncOptions = {}) {
  const today = riyadhYmd(now)
  const checkedAt = now.toISOString()
  const resolveHijri = options.resolveHijri ?? nextHijriDate
  let hijriOk = true

  for (const template of occasionCatalog) {
    const existing = platform.getSystemOccasion(template.key)
    if (template.recurring && template.month && template.day) {
      const date = nextFixedDate(template.month, template.day, today)
      platform.upsertSystemOccasion(withHistory(existing, {
        key: template.key,
        titleAr: template.titleAr,
        titleEn: template.titleEn,
        category: template.category,
        date,
        dateCertainty: 'official',
        dateNote: FIXED_NOTE,
        source: FIXED_SOURCE,
        cycle: date.slice(0, 4),
        recurring: true,
        checkedAt,
        syncStatus: 'ok',
        updatedAt: checkedAt,
      }, today))
      continue
    }

    if (template.category === 'season' || !template.hijriMonth || !template.hijriDay) {
      syncSeason(platform, template, existing, checkedAt, today)
      continue
    }

    let resolved: HijriResolution = null
    try {
      resolved = resolveHijri(template.hijriMonth, template.hijriDay, today)
    } catch {
      resolved = null
    }
    if (!resolved) {
      hijriOk = false
      keepStale(platform, template, existing, checkedAt)
      continue
    }
    if (existing?.dateCertainty === 'official' && existing.date && existing.date >= today) {
      platform.upsertSystemOccasion({
        ...existing,
        titleAr: template.titleAr,
        titleEn: template.titleEn,
        checkedAt,
        syncStatus: 'ok',
        updatedAt: checkedAt,
      })
      continue
    }
    platform.upsertSystemOccasion(withHistory(existing, {
      key: template.key,
      titleAr: template.titleAr,
      titleEn: template.titleEn,
      category: template.category,
      date: resolved.date,
      dateCertainty: 'estimated',
      dateNote: HIJRI_NOTE,
      source: HIJRI_SOURCE,
      cycle: resolved.cycle,
      recurring: false,
      checkedAt,
      syncStatus: 'ok',
      updatedAt: checkedAt,
    }, today))
  }

  const previous = platform.calendarSyncState()
  platform.saveCalendarSync(hijriOk
    ? { status: 'ok', source: HIJRI_SOURCE, checkedAt, attemptedAt: checkedAt, message: '' }
    : {
      status: 'stale',
      source: HIJRI_SOURCE,
      checkedAt: previous?.checkedAt ?? null,
      attemptedAt: checkedAt,
      message: STALE_MESSAGE,
    })
  return platform.calendarSyncState()
}

export function applyCalendarUpdate(
  platform: PlatformStore,
  input: { key: string, date: string | null, dateCertainty: DateCertainty, source: string },
  now = new Date(),
) {
  const template = occasionByKey(input.key)
  if (!template) throw new AppError('المناسبة غير موجودة في التقويم المركزي.', 404, 'NOT_FOUND')
  if (template.recurring) throw new AppError('المناسبة الميلادية الثابتة تتجدد تلقائياً.', 400, 'FIXED_DATE')
  if (input.dateCertainty === 'unannounced' && input.date) {
    throw new AppError('الموعد غير المعلن يبقى بلا تاريخ.', 400, 'DATE_REQUIRED')
  }
  if (input.dateCertainty !== 'unannounced' && !input.date) {
    throw new AppError('أدخل التاريخ مع حالة التأكيد.', 400, 'DATE_REQUIRED')
  }
  const today = riyadhYmd(now)
  const checkedAt = now.toISOString()
  const existing = platform.getSystemOccasion(template.key)
  const hijri = input.date ? hijriParts(input.date) : null
  const cycle = template.category === 'islamic' && hijri ? String(hijri.year) : (input.date?.slice(0, 4) ?? '')
  const dateNote = input.dateCertainty === 'official'
    ? 'تاريخ مؤكد سجّله مسؤول النظام بعد الإعلان الرسمي.'
    : input.dateCertainty === 'estimated'
      ? 'تاريخ تقديري سجّله مسؤول النظام. يلزم التحقق من الإعلان الرسمي.'
      : template.dateNote
  const saved = withHistory(existing, {
    key: template.key,
    titleAr: template.titleAr,
    titleEn: template.titleEn,
    category: template.category,
    date: input.dateCertainty === 'unannounced' ? null : input.date,
    dateCertainty: input.dateCertainty,
    dateNote,
    source: input.source,
    cycle,
    recurring: false,
    checkedAt,
    syncStatus: 'ok',
    updatedAt: checkedAt,
  }, today)
  platform.upsertSystemOccasion(saved)
  return platform.getSystemOccasion(template.key)
}

function syncSeason(
  platform: PlatformStore,
  template: (typeof occasionCatalog)[number],
  existing: SystemOccasionRecord | null,
  checkedAt: string,
  today: string,
) {
  if (!existing || existing.dateCertainty === 'unannounced') {
    platform.upsertSystemOccasion({
      key: template.key,
      titleAr: template.titleAr,
      titleEn: template.titleEn,
      category: template.category,
      date: null,
      dateCertainty: 'unannounced',
      dateNote: SEASON_NOTE,
      source: SEASON_SOURCE,
      cycle: '',
      recurring: false,
      checkedAt,
      syncStatus: 'ok',
      history: existing?.history ?? [],
      updatedAt: checkedAt,
    })
    return
  }
  if (existing.date && existing.date < today) {
    platform.upsertSystemOccasion(withHistory(existing, {
      ...existing,
      titleAr: template.titleAr,
      titleEn: template.titleEn,
      date: null,
      dateCertainty: 'unannounced',
      dateNote: SEASON_NOTE,
      source: SEASON_SOURCE,
      cycle: '',
      checkedAt,
      syncStatus: 'ok',
      updatedAt: checkedAt,
    }, today))
  }
}

function keepStale(
  platform: PlatformStore,
  template: (typeof occasionCatalog)[number],
  existing: SystemOccasionRecord | null,
  attemptedAt: string,
) {
  if (existing) {
    platform.upsertSystemOccasion({ ...existing, syncStatus: 'stale', updatedAt: attemptedAt })
    return
  }
  platform.upsertSystemOccasion({
    key: template.key,
    titleAr: template.titleAr,
    titleEn: template.titleEn,
    category: template.category,
    date: null,
    dateCertainty: 'unannounced',
    dateNote: 'تعذر قراءة تقويم أم القرى، ولم يُحفظ موعد سابق.',
    source: HIJRI_SOURCE,
    cycle: '',
    recurring: false,
    checkedAt: null,
    syncStatus: 'stale',
    history: [],
    updatedAt: attemptedAt,
  })
}

function withHistory(
  existing: SystemOccasionRecord | null,
  next: Omit<SystemOccasionRecord, 'history'>,
  today: string,
): SystemOccasionRecord {
  if (!existing) return { ...next, history: [] }
  const cycleChanged = existing.cycle !== '' && next.cycle !== '' && existing.cycle !== next.cycle
  const previousPassed = Boolean(existing.date && existing.date < today)
  if (!cycleChanged && !previousPassed) return { ...next, history: existing.history }
  return {
    ...next,
    history: [...existing.history, {
      date: existing.date,
      cycle: existing.cycle,
      dateCertainty: existing.dateCertainty,
      source: existing.source,
      checkedAt: existing.checkedAt,
    }].slice(-8),
  }
}
