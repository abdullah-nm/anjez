const CANONICAL: { label: string, labelEn: string, aliases: string[] }[] = [
  { label: 'الرياض', labelEn: 'Riyadh', aliases: ['الرياض', 'رياض', 'riyadh', 'ar riyadh', 'al riyadh'] },
  { label: 'جدة', labelEn: 'Jeddah', aliases: ['جدة', 'جده', 'jeddah', 'jedda', 'jidda'] },
  { label: 'مكة المكرمة', labelEn: 'Makkah', aliases: ['مكة', 'مكه', 'مكة المكرمة', 'مكه المكرمه', 'makkah', 'mecca'] },
  { label: 'المدينة المنورة', labelEn: 'Madinah', aliases: ['المدينة', 'المدينه', 'المدينة المنورة', 'المدينه المنوره', 'madinah', 'medina'] },
  { label: 'الدمام', labelEn: 'Dammam', aliases: ['الدمام', 'dammam'] },
  { label: 'الخبر', labelEn: 'Khobar', aliases: ['الخبر', 'khobar', 'al khobar'] },
  { label: 'الظهران', labelEn: 'Dhahran', aliases: ['الظهران', 'dhahran'] },
  { label: 'الأحساء', labelEn: 'Al-Ahsa', aliases: ['الأحساء', 'الاحساء', 'الهفوف', 'al ahsa', 'ahsa'] },
  { label: 'القطيف', labelEn: 'Qatif', aliases: ['القطيف', 'qatif'] },
  { label: 'بريدة', labelEn: 'Buraydah', aliases: ['بريدة', 'بريده', 'buraydah', 'buraidah'] },
  { label: 'عنيزة', labelEn: 'Unaizah', aliases: ['عنيزة', 'عنيزه', 'unaizah'] },
  { label: 'حائل', labelEn: 'Hail', aliases: ['حائل', 'حايل', 'hail', 'ha\'il'] },
  { label: 'تبوك', labelEn: 'Tabuk', aliases: ['تبوك', 'tabuk'] },
  { label: 'أبها', labelEn: 'Abha', aliases: ['أبها', 'ابها', 'abha'] },
  { label: 'خميس مشيط', labelEn: 'Khamis Mushait', aliases: ['خميس مشيط', 'khamis mushait'] },
  { label: 'جازان', labelEn: 'Jazan', aliases: ['جازان', 'جيزان', 'jazan', 'jizan'] },
  { label: 'نجران', labelEn: 'Najran', aliases: ['نجران', 'najran'] },
  { label: 'الباحة', labelEn: 'Al-Baha', aliases: ['الباحة', 'الباحه', 'al baha', 'albaha'] },
  { label: 'سكاكا', labelEn: 'Sakaka', aliases: ['سكاكا', 'sakaka'] },
  { label: 'عرعر', labelEn: 'Arar', aliases: ['عرعر', 'arar'] },
  { label: 'ينبع', labelEn: 'Yanbu', aliases: ['ينبع', 'yanbu'] },
  { label: 'الطائف', labelEn: 'Taif', aliases: ['الطائف', 'الطايف', 'taif', 'al taif'] },
  { label: 'الجبيل', labelEn: 'Jubail', aliases: ['الجبيل', 'jubail'] },
  { label: 'حفر الباطن', labelEn: 'Hafr Al-Batin', aliases: ['حفر الباطن', 'hafr al batin'] },
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

export function localizedCityName(label: string, locale: 'ar' | 'en') {
  const found = CANONICAL.find((city) => city.label === label)
  if (!found) return label
  return locale === 'en' ? found.labelEn : found.label
}
