const GREETINGS: Array<[RegExp, { headline: string; subhead: string }]> = [
  [/تأسيس|تاسيس/, { headline: 'يوم التأسيس', subhead: 'كل عام والوطن بخير' }],
  [/يوم العلم/, { headline: 'يوم العلم', subhead: 'دام عز الوطن' }],
  [/اليوم الوطني/, { headline: 'اليوم الوطني', subhead: 'دام عزك يا وطن' }],
  [/رمضان/, { headline: 'رمضان كريم', subhead: 'كل عام وأنتم بخير' }],
  [/عيد الفطر|(?:^|\s)الفطر(?:\s|$)/, { headline: 'عيدكم مبارك', subhead: 'كل عام وأنتم بخير' }],
  [/عرفة/, { headline: 'تقبل الله منكم', subhead: 'يوم عرفة مبارك' }],
  [/أضحى|اضحى/, { headline: 'عيد أضحى مبارك', subhead: 'كل عام وأنتم بخير' }],
  [/حج/, { headline: 'حج مبرور', subhead: 'وسعي مشكور' }],
  [/موسم الرياض/, { headline: 'موسم الرياض', subhead: 'أهلاً بكم' }],
  [/موسم جدة|جدة/, { headline: 'موسم جدة', subhead: 'أهلاً بكم' }],
  [/الدرعية/, { headline: 'موسم الدرعية', subhead: 'أهلاً بكم' }],
  [/العلا/, { headline: 'شتاء العلا', subhead: 'أهلاً بكم' }],
]

function bare(value: string) {
  return value.replace(/\[[^\]]*\]/g, '').replace(/20\d{2}/g, '').replace(/\s+/g, ' ').trim()
}

export function parseGeneratedLines(raw: string) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { headline?: unknown; subhead?: unknown }
    const headline = typeof parsed.headline === 'string' ? parsed.headline.replace(/\s+/g, ' ').trim() : ''
    const subhead = typeof parsed.subhead === 'string' ? parsed.subhead.replace(/\s+/g, ' ').trim() : ''
    if (headline.length < 2 || headline.length > 80) return null
    return { headline, subhead: subhead.slice(0, 90) }
  } catch {
    return null
  }
}

export function posterCopy(input: {
  headline: string
  subhead: string
  eventTitle: string
  companyName: string
}) {
  const greeting = GREETINGS.find(([pattern]) => pattern.test(`${input.eventTitle} ${input.headline}`))?.[1]
  const headline = input.headline.trim()
  const subhead = input.subhead.trim()
  if (!greeting) return { headline, subhead }
  const title = bare(input.eventTitle)
  const current = bare(headline)
  const company = input.companyName.trim()
  return {
    headline: !current || current === title ? greeting.headline : headline,
    subhead: !subhead || subhead === company || subhead === title ? greeting.subhead : subhead,
  }
}
