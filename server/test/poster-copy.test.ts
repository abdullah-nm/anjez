import { describe, expect, it } from 'vitest'
import { parseGeneratedLines, posterCopy } from '../platform/posterCopy.ts'

describe('poster greeting lines', () => {
  it('reads generated poster lines and rejects a raw description', () => {
    expect(parseGeneratedLines('{"headline":"رمضان كريم","subhead":"كل عام وأنتم بخير"}'))
      .toEqual({ headline: 'رمضان كريم', subhead: 'كل عام وأنتم بخير' })
    expect(parseGeneratedLines('تهنئة رمضانية قصيرة للموظفين')).toBeNull()
  })

  it('replaces a bare occasion title with a greeting and keeps a custom line', () => {
    expect(posterCopy({
      headline: 'رمضان',
      subhead: 'المراعي',
      eventTitle: 'رمضان',
      companyName: 'المراعي',
    })).toEqual({ headline: 'رمضان كريم', subhead: 'كل عام وأنتم بخير' })

    expect(posterCopy({
      headline: 'الف مبروك وعيدكم مبارك',
      subhead: 'من فريق المراعي',
      eventTitle: 'عيد الفطر',
      companyName: 'المراعي',
    })).toEqual({ headline: 'الف مبروك وعيدكم مبارك', subhead: 'من فريق المراعي' })
  })
})