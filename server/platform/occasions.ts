import type { DateCertainty, OccasionTemplate } from './types.ts'

/**
 * Asia/Riyadh (UTC+3, no DST). Dates are YYYY-MM-DD in Riyadh.
 * Fixed Gregorian days roll forward each year.
 * Hijri occasions and seasons are not converted into a repeating civil date.
 */
export const APP_TIMEZONE = 'Asia/Riyadh'

export function riyadhYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function daysUntil(ymd: string, from = riyadhYmd()) {
  const a = Date.parse(`${from}T00:00:00+03:00`)
  const b = Date.parse(`${ymd}T00:00:00+03:00`)
  return Math.round((b - a) / 86400000)
}

export function addDays(ymd: string, days: number) {
  return riyadhYmd(new Date(Date.parse(`${ymd}T00:00:00+03:00`) + days * 86400000))
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function nextFixedDate(month: number, day: number, today = riyadhYmd()) {
  const year = Number(today.slice(0, 4))
  const candidate = `${year}-${pad(month)}-${pad(day)}`
  if (candidate >= today) return candidate
  return `${year + 1}-${pad(month)}-${pad(day)}`
}

const fixedNote = 'تاريخ ميلادي ثابت ويتكرر كل سنة.'
const hijriNote = 'مناسبة هجرية. الموعد المتوقع يأتي من تقويم أم القرى ويبقى تقديرياً إلى حين الإعلان الرسمي لرؤية الهلال.'
const seasonNote = 'لا يوجد موعد مضمون كل سنة. يبقى «بانتظار الإعلان» إلى أن يسجّل مسؤول النظام موعداً بعد الإعلان الرسمي.'

export const occasionCatalog: OccasionTemplate[] = [
  { key: 'founding-day', titleAr: 'يوم التأسيس', titleEn: 'Founding Day', category: 'national', month: 2, day: 22, recurring: true, dateNote: fixedNote },
  { key: 'flag-day', titleAr: 'يوم العلم', titleEn: 'Saudi Flag Day', category: 'national', month: 3, day: 11, recurring: true, dateNote: fixedNote },
  { key: 'national-day', titleAr: 'اليوم الوطني السعودي', titleEn: 'Saudi National Day', category: 'national', month: 9, day: 23, recurring: true, dateNote: fixedNote },
  { key: 'ramadan', titleAr: 'رمضان', titleEn: 'Ramadan', category: 'islamic', hijriMonth: 9, hijriDay: 1, recurring: false, dateNote: hijriNote },
  { key: 'eid-fitr', titleAr: 'عيد الفطر', titleEn: 'Eid al-Fitr', category: 'islamic', hijriMonth: 10, hijriDay: 1, recurring: false, dateNote: hijriNote },
  { key: 'arafah', titleAr: 'يوم عرفة', titleEn: 'Day of Arafah', category: 'islamic', hijriMonth: 12, hijriDay: 9, recurring: false, dateNote: hijriNote },
  { key: 'eid-adha', titleAr: 'عيد الأضحى', titleEn: 'Eid al-Adha', category: 'islamic', hijriMonth: 12, hijriDay: 10, recurring: false, dateNote: hijriNote },
  { key: 'hajj-season', titleAr: 'موسم الحج', titleEn: 'Hajj season', category: 'islamic', hijriMonth: 12, hijriDay: 8, recurring: false, dateNote: hijriNote },
  { key: 'riyadh-season', titleAr: 'موسم الرياض', titleEn: 'Riyadh Season', category: 'season', recurring: false, dateNote: seasonNote },
  { key: 'jeddah-season', titleAr: 'موسم جدة', titleEn: 'Jeddah Season', category: 'season', recurring: false, dateNote: seasonNote },
  { key: 'diriyah-season', titleAr: 'موسم الدرعية', titleEn: 'Diriyah Season', category: 'season', recurring: false, dateNote: seasonNote },
  { key: 'alula-winter', titleAr: 'فعاليات العلا الشتوية', titleEn: 'AlUla winter events', category: 'season', recurring: false, dateNote: seasonNote },
  { key: 'book-fair', titleAr: 'معارض الكتب', titleEn: 'Book fairs', category: 'season', recurring: false, dateNote: seasonNote },
  { key: 'cultural-major', titleAr: 'فعالية ثقافية كبرى', titleEn: 'Major cultural event', category: 'season', recurring: false, dateNote: seasonNote },
  { key: 'sports-major', titleAr: 'فعالية رياضية كبرى', titleEn: 'Major sports event', category: 'season', recurring: false, dateNote: seasonNote },
]

export function occasionByKey(key: string) {
  return occasionCatalog.find((item) => item.key === key) ?? null
}

export function presentOccasion(template: OccasionTemplate, today = riyadhYmd()) {
  if (template.recurring && template.month && template.day) {
    const date = nextFixedDate(template.month, template.day, today)
    return {
      ...template,
      date,
      certainty: 'official' as DateCertainty,
      needsAnnualUpdate: false,
    }
  }
  return {
    ...template,
    date: null as string | null,
    certainty: 'unannounced' as DateCertainty,
    needsAnnualUpdate: true,
  }
}

export function presentOccasions(today = riyadhYmd()) {
  return occasionCatalog.map((item) => presentOccasion(item, today))
}

export const reminderOffsets = [30, 14, 7, 3, 1] as const

export function suggestedProducts(category: string) {
  if (category === 'national' || category === 'islamic' || category === 'season') {
    return ['prd-poster', 'prd-banner', 'prd-greeting', 'prd-mug']
  }
  if (category === 'conference' || category === 'launch') {
    return ['prd-invite', 'prd-rollup', 'prd-notebook', 'prd-backdrop']
  }
  return ['prd-card', 'prd-gift', 'prd-invite']
}
