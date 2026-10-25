import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { localizedCityName } from '../../shared/cities.ts'
import { localeFromStored } from '../../shared/locale.ts'
import { pluralCategory } from '../../shared/plural.ts'
import { arExtra, enExtra } from '../../shared/uiExtra.ts'

function dictionaryKeys(source: string, marker: string) {
  const start = source.indexOf(marker)
  const end = source.indexOf('\n}', start)
  const body = source.slice(start, end)
  return [...body.matchAll(/^  (\w+):/gm)].map((match) => match[1]).sort()
}

describe('interface languages', () => {
  it('keeps the Arabic and English catalogs on the same keys', () => {
    expect(Object.keys(enExtra).sort()).toEqual(Object.keys(arExtra).sort())
    const source = readFileSync(new URL('../../src/i18n.tsx', import.meta.url), 'utf8')
    expect(dictionaryKeys(source, 'const en: Record')).toEqual(dictionaryKeys(source, 'const ar = {'))
  })

  it('formats a Riyadh month in the selected language and keeps the calendar value', () => {
    const stamp = new Date('2026-10-24T12:00:00+03:00')
    const english = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(stamp)
    const arabic = new Intl.DateTimeFormat('ar', { month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(stamp)
    expect(english).toBe('October 2026')
    expect(arabic).toContain('2026')
    expect(arabic).not.toContain('October')
  })

  it('uses plural categories for alerts, days, and orders', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 3)).toBe('other')
    expect(pluralCategory('ar', 0)).toBe('zero')
    expect(pluralCategory('ar', 1)).toBe('one')
    expect(pluralCategory('ar', 2)).toBe('two')
    expect(pluralCategory('ar', 5)).toBe('few')
    expect(pluralCategory('ar', 14)).toBe('many')
    expect(arExtra.unreadAlerts).toContain('{count}')
    expect(enExtra.daysLeft).toContain('{count}')
  })

  it('keeps the language choice and translates reference cities without rewriting unknown names', () => {
    expect(localeFromStored('en')).toBe('en')
    expect(localeFromStored('ar')).toBe('ar')
    expect(localeFromStored(null)).toBe('ar')
    expect(localizedCityName('جدة', 'en')).toBe('Jeddah')
    expect(localizedCityName('جدة', 'ar')).toBe('جدة')
    expect(localizedCityName('حي الياسمين', 'en')).toBe('حي الياسمين')
  })
})
