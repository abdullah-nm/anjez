import { describe, expect, it } from 'vitest'
import { brandedSvg } from '../platform/svg.ts'

const brand = {
  companyId: 'company_almarai',
  companyName: 'المراعي',
  industry: '',
  description: '',
  language: 'ar' as const,
  contactName: '',
  email: '',
  phone: '',
  city: '',
  primaryColor: '#1f2937',
  accentColor: '#d1d5db',
  slogan: '',
  tone: 'فاخر',
  logoPath: null,
  logoMime: null,
  updatedAt: '',
}

describe('poster text layout', () => {
  it('keeps the full greeting centered in Tajawal instead of clipping the last word', () => {
    const headline = 'عيدٌ مبارك لنخبة العطاء'
    const subhead = 'بكم نرتقي ونفخر'
    const svg = brandedSvg({
      brand,
      productName: 'ملصقات',
      headline,
      subhead,
      body: '',
      dimensions: 'portrait',
      size: 'A2',
      logoHref: null,
      backgroundHref: 'data:image/jpeg;base64,QQ',
      backgroundOpacity: 1,
    })
    const height = Number(svg.match(/viewBox="0 0 \d+ (\d+)"/)?.[1])
    const lines = [...svg.matchAll(/<text x="\d+" y="(\d+)" text-anchor="middle"[^>]*>([^<]*)<\/text>/g)]
      .map((match) => ({ y: Number(match[1]), text: match[2] }))
    const greeting = lines.filter((line) => line.text.includes('عيد') || line.text.includes('العطاء') || line.text.includes('لنخبة'))
    expect(greeting.some((line) => line.text.includes('العطاء'))).toBe(true)
    expect(lines.some((line) => line.text === 'العط' || line.text.endsWith(' اء') || line.text.includes('العط<'))).toBe(false)
    expect(svg).not.toContain('<tspan')
    expect(svg).toContain('unicode-bidi="isolate"')
    expect(svg).toContain('font-family="Tajawal"')
    expect(greeting[0].y).toBeGreaterThan(height * 0.28)
    expect(greeting[0].y).toBeLessThan(height * 0.62)
  })
})
