const CANONICAL: { label: string, aliases: string[] }[] = [
  { label: 'الرياض', aliases: ['الرياض', 'رياض', 'riyadh', 'ar riyadh', 'al riyadh'] },
  { label: 'جدة', aliases: ['جدة', 'جده', 'jeddah', 'jedda', 'jidda', 'jidda'] },
  { label: 'مكة المكرمة', aliases: ['مكة', 'مكه', 'مكة المكرمة', 'مكه المكرمه', 'makkah', 'mecca'] },
  { label: 'المدينة المنورة', aliases: ['المدينة', 'المدينه', 'المدينة المنورة', 'المدينه المنوره', 'madinah', 'medina'] },
  { label: 'الدمام', aliases: ['الدمام', 'dammam'] },
  { label: 'الخبر', aliases: ['الخبر', 'khobar', 'al khobar', 'al khobar'] },
  { label: 'الظهران', aliases: ['الظهران', 'dhahran'] },
  { label: 'الأحساء', aliases: ['الأحساء', 'الاحساء', 'الهفوف', 'al ahsa', 'ahsa'] },
  { label: 'القطيف', aliases: ['القطيف', 'qatif'] },
  { label: 'بريدة', aliases: ['بريدة', 'بريده', 'buraydah', 'buraidah'] },
  { label: 'عنيزة', aliases: ['عنيزة', 'عنيزه', 'unaizah'] },
  { label: 'حائل', aliases: ['حائل', 'حايل', 'hail', 'ha\'il'] },
  { label: 'تبوك', aliases: ['تبوك', 'tabuk'] },
  { label: 'أبها', aliases: ['أبها', 'ابها', 'abha'] },
  { label: 'خميس مشيط', aliases: ['خميس مشيط', 'khamis mushait'] },
  { label: 'جازان', aliases: ['جازان', 'جيزان', 'jazan', 'jizan'] },
  { label: 'نجران', aliases: ['نجران', 'najran'] },
  { label: 'الباحة', aliases: ['الباحة', 'الباحه', 'al baha', 'albaha'] },
  { label: 'سكاكا', aliases: ['سكاكا', 'sakaka'] },
  { label: 'عرعر', aliases: ['عرعر', 'arar'] },
  { label: 'ينبع', aliases: ['ينبع', 'yanbu'] },
  { label: 'الطائف', aliases: ['الطائف', 'الطايف', 'taif', 'al taif'] },
  { label: 'الجبيل', aliases: ['الجبيل', 'jubail'] },
  { label: 'حفر الباطن', aliases: ['حفر الباطن', 'hafr al batin'] },
]

export const CITY_NAMES = CANONICAL.map((city) => city.label)

function normalize(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const ALIAS = new Map<string, string>()
for (const city of CANONICAL) {
  for (const alias of city.aliases) ALIAS.set(normalize(alias), city.label)
}

export function groupCity(raw: string | null | undefined) {
  const display = (raw ?? '').replace(/[\u064B-\u0652\u0670\u0640]/g, '').replace(/\s+/g, ' ').trim()
  if (!display) return { key: '', label: 'غير محدد' }
  const canonical = ALIAS.get(normalize(display))
  if (canonical) return { key: normalize(canonical), label: canonical }
  return { key: normalize(display), label: display }
}

export function storedCity(raw: string | null | undefined) {
  const city = groupCity(raw)
  return city.key ? city.label : ''
}
