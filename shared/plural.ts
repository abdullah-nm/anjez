export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

export function pluralCategory(locale: 'ar' | 'en', count: number): PluralCategory {
  const value = Math.abs(Math.trunc(count))
  if (locale === 'en') return value === 1 ? 'one' : 'other'
  if (value === 0) return 'zero'
  if (value === 1) return 'one'
  if (value === 2) return 'two'
  const mod = value % 100
  if (mod >= 3 && mod <= 10) return 'few'
  if (mod >= 11 && mod <= 99) return 'many'
  return 'other'
}
