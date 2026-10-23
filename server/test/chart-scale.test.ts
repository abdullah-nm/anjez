import { describe, expect, it } from 'vitest'
import { countAxisEnd, countAxisTicks } from '../../shared/chartScale.ts'
import { prefillFromOccasion } from '../../src/occasionPrefill.ts'

describe('count axis', () => {
  it('uses 0–5 for small counts and grows without a fixed ceiling', () => {
    expect(countAxisEnd(1)).toBe(5)
    expect(countAxisEnd(4)).toBe(5)
    expect(countAxisEnd(5)).toBe(10)
    expect(countAxisEnd(40)).toBe(50)
    expect(countAxisEnd(120)).toBe(200)
    expect(countAxisEnd(250_000)).toBeGreaterThanOrEqual(250_000)
    expect(countAxisTicks(5)).toEqual([0, 1, 2, 3, 4, 5])
    expect(countAxisTicks(1)).toEqual([0, 1])
  })
})

describe('occasion prefill', () => {
  it('fills editable copy from the occasion and does not invent an unofficial date', () => {
    const first = prefillFromOccasion({
      id: 'sys:eid-fitr',
      title: 'عيد الفطر',
      category: 'islamic',
      companyName: 'المراعي',
      slogan: 'جودة',
      date: '2026-03-20',
      dateOfficial: false,
    })
    const second = prefillFromOccasion({
      id: 'evt-1',
      title: 'إطلاق المنتج',
      category: 'launch',
      companyName: 'المراعي',
      audience: 'الشركاء',
      dateOfficial: true,
      date: '2026-11-02',
    })
    expect(first.headline).toBe('عيد الفطر')
    expect(first.productId).toBe('prd-poster')
    expect(first.imageNote).not.toContain('2026-03-20')
    expect(first.body).not.toContain('2026-03-20')
    expect(second.headline).toBe('إطلاق المنتج')
    expect(second.productId).toBe('prd-invite')
    expect(second.body).toBe('الشركاء')
    expect(second.eventId).not.toBe(first.eventId)
    expect(second.imageNote).toContain('2026-11-02')
    expect(second.headline).not.toContain(second.imageNote)
  })
})
