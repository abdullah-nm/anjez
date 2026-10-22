export type StudioOccasion = {
  id: string
  title: string
  date: string
  occasionKey: string | null
}

type CompanyInput = {
  id?: string
  title?: string
  date?: string | null
  status?: string
  occasionKey?: string | null
}

type SystemInput = {
  id?: string
  key?: string
  title?: string
  titleAr?: string
  date?: string | null
}

export function riyadhToday(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Upcoming company-calendar rows for the design studio. Past and completed rows stay out. */
export function upcomingDesignOccasions(
  payload: { events?: CompanyInput[], systemOccasions?: SystemInput[] },
  today: string,
): StudioOccasion[] {
  const company = (payload.events ?? []).flatMap((event) => {
    const row = companyRow(event, today)
    return row ? [row] : []
  })
  const covered = new Set(company.map((event) => event.occasionKey).filter((key): key is string => Boolean(key)))
  const system = (payload.systemOccasions ?? []).flatMap((event) => {
    const row = systemRow(event, today)
    if (!row || (row.occasionKey && covered.has(row.occasionKey))) return []
    const alreadyOnCalendar = company.some((item) => item.date === row.date && sameOccasion(item.title, row.title))
    if (alreadyOnCalendar) return []
    return [row]
  })
  const byId = new Map<string, StudioOccasion>()
  for (const event of [...company, ...system]) {
    if (!byId.has(event.id)) byId.set(event.id, event)
  }
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ar'))
}

function sameOccasion(companyTitle: string, systemTitle: string) {
  const normalized = companyTitle.replace(/\[[^\]]+\]/g, ' ').replace(/\b20\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized || !systemTitle) return false
  if (normalized === systemTitle) return true
  if (normalized.length < 4 || systemTitle.length < 4) return false
  return normalized.includes(systemTitle) || systemTitle.includes(normalized)
}

function companyRow(event: CompanyInput, today: string): StudioOccasion | null {
  const id = event.id?.trim() || ''
  const title = event.title?.trim() || ''
  const date = event.date?.trim() || ''
  if (!id || !title || !date || date < today || event.status === 'done') return null
  return { id, title, date, occasionKey: event.occasionKey?.trim() || null }
}

function systemRow(event: SystemInput, today: string): StudioOccasion | null {
  const key = event.key?.trim() || ''
  const id = event.id?.trim() || (key ? `sys:${key}` : '')
  const title = (event.titleAr || event.title || '').trim()
  const date = event.date?.trim() || ''
  if (!id || !title || !date || date < today) return null
  return { id, title, date, occasionKey: key || null }
}
