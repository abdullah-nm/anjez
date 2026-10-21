import type { BrandProfile } from './types.ts'

export function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function aspectBox(dimensions: string) {
  if (dimensions.includes('portrait') || dimensions === 'A6' || dimensions === 'A5') {
    return { width: 720, height: 1020 }
  }
  if (dimensions.includes('landscape') || dimensions.includes('بنر') || dimensions.includes('banner')) {
    return { width: 1200, height: 540 }
  }
  return { width: 900, height: 900 }
}

export function brandedSvg(input: {
  brand: BrandProfile
  productName: string
  headline: string
  subhead: string
  body: string
  dimensions: string
  logoHref: string | null
  backgroundHref?: string | null
}) {
  const { width, height } = aspectBox(input.dimensions)
  const pad = Math.round(Math.min(width, height) * 0.08)
  const logoBox = Math.round(Math.min(width, height) * 0.2)
  const rawHeadline = input.headline.trim()
  const headline = xmlEscape(rawHeadline)
  const company = xmlEscape(input.brand.companyName)
  const bg = xmlEscape(input.brand.primaryColor)
  const accent = xmlEscape(input.brand.accentColor)
  const safeLogo = input.logoHref ? xmlEscape(input.logoHref) : ''
  const logoX = width - pad - logoBox
  const logo = input.logoHref
    ? `<image href="${safeLogo}" xlink:href="${safeLogo}" x="${logoX}" y="${pad}" width="${logoBox}" height="${logoBox}" preserveAspectRatio="xMidYMid meet" />`
    : `<rect x="${logoX}" y="${pad}" width="${logoBox}" height="${logoBox}" rx="18" fill="${accent}" /><text x="${logoX + logoBox / 2}" y="${pad + logoBox / 2 + 8}" text-anchor="middle" font-size="28" fill="${bg}" font-family="IBM Plex Sans Arabic, sans-serif">${company.slice(0, 1)}</text>`
  const line = (value: string, y: number, size: number, fill: string, weight = '400') => {
    const text = value.trim()
    if (!text) return ''
    const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length >= (text.match(/[A-Za-z]/g) || []).length
    const maxChars = Math.max(8, Math.floor((width - pad * 2) / (size * (arabic ? 1.05 : 0.58))))
    const words = text.split(/\s+/).filter(Boolean)
    const rows: string[] = []
    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (next.length > maxChars && current) {
        rows.push(current)
        current = word
      } else current = next
    }
    if (current) rows.push(current)
    const x = arabic ? width - pad : pad
    const tspans = rows.slice(0, 4).map((row, index) => (
      `<tspan x="${x}" dy="${index === 0 ? 0 : Math.round(size * 1.35)}">${xmlEscape(row)}</tspan>`
    )).join('')
    return `<text x="${x}" y="${y}" text-anchor="start" direction="${arabic ? 'rtl' : 'ltr'}" unicode-bidi="embed" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="IBM Plex Sans Arabic, sans-serif">${tspans}</text>`
  }
  const artwork = input.backgroundHref
    ? `<image href="${xmlEscape(input.backgroundHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="0.28" />`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${headline}">
  <rect width="100%" height="100%" fill="${bg}"/>
  ${artwork}
  <rect x="${pad / 2}" y="${pad / 2}" width="${width - pad}" height="${height - pad}" fill="none" stroke="${accent}" stroke-width="3" rx="28"/>
  ${logo}
  ${line(input.productName, pad + logoBox + 28, 16, accent)}
  ${line(rawHeadline, Math.round(height * 0.42), rawHeadline.length > 22 ? Math.round(width * 0.04) : Math.round(width * 0.052), '#f7f3ec', '700')}
  ${line(input.subhead, Math.round(height * 0.58), Math.round(width * 0.028), accent)}
  ${line(input.body, Math.round(height * 0.7), Math.round(width * 0.022), '#efe6d6')}
  ${line(input.brand.companyName, height - pad, 14, '#d7cbb8')}
</svg>`
}
