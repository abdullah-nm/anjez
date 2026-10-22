import { APP_TIMEZONE, riyadhYmd } from './occasions.ts'

const CALENDAR = 'islamic-umalqura'

export function umalquraAvailable() {
  try {
    return new Intl.DateTimeFormat(`en-u-ca-${CALENDAR}`, { timeZone: APP_TIMEZONE }).resolvedOptions().calendar === CALENDAR
  } catch {
    return false
  }
}

export function hijriParts(ymd: string) {
  if (!umalquraAvailable()) return null
  const parts = new Intl.DateTimeFormat(`en-u-ca-${CALENDAR}`, {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(`${ymd}T12:00:00+03:00`))
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  if (!year || !month || !day) return null
  return { year, month, day }
}

function hijriIndex(ymd: string) {
  const hijri = hijriParts(ymd)
  if (!hijri) return null
  return hijri.year * 400 + hijri.month * 32 + hijri.day
}

/** Gregorian YYYY-MM-DD for a Umm al-Qura day, using the ICU table. */
export function gregorianForHijri(year: number, month: number, day: number) {
  if (!umalquraAvailable()) return null
  const target = year * 400 + month * 32 + day
  const approx = Math.round(year + 622 - year / 33)
  let low = Math.round(Date.parse(`${approx - 1}-01-01T12:00:00+03:00`) / 86400000)
  let high = Math.round(Date.parse(`${approx + 2}-06-01T12:00:00+03:00`) / 86400000)
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const ymd = riyadhYmd(new Date(mid * 86400000 + 12 * 3600000))
    const index = hijriIndex(ymd)
    if (index === target) return ymd
    if (index !== null && index < target) low = mid + 1
    else high = mid - 1
  }
  return null
}

export function nextHijriDate(month: number, day: number, today = riyadhYmd()) {
  const current = hijriParts(today)
  if (!current) return null
  for (const year of [current.year, current.year + 1]) {
    const date = gregorianForHijri(year, month, day)
    if (date && date >= today) return { date, cycle: String(year) }
  }
  return null
}
