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
  const headline = xmlEscape(input.headline || input.brand.companyName)
  const subhead = xmlEscape(input.subhead)
  const body = xmlEscape(input.body)
  const product = xmlEscape(input.productName)
  const company = xmlEscape(input.brand.companyName)
  const bg = xmlEscape(input.brand.primaryColor)
  const accent = xmlEscape(input.brand.accentColor)
  const safeLogo = input.logoHref ? xmlEscape(input.logoHref) : ''
  const logo = input.logoHref
    ? `<image href="${safeLogo}" xlink:href="${safeLogo}" x="${pad}" y="${pad}" width="${logoBox}" height="${logoBox}" preserveAspectRatio="xMidYMid meet" />`
    : `<rect x="${pad}" y="${pad}" width="${logoBox}" height="${logoBox}" rx="18" fill="${accent}" /><text x="${pad + logoBox / 2}" y="${pad + logoBox / 2 + 8}" text-anchor="middle" font-size="28" fill="${bg}" font-family="IBM Plex Sans Arabic, sans-serif">${company.slice(0, 1)}</text>`
  const artwork = input.backgroundHref
    ? `<image href="${xmlEscape(input.backgroundHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="0.28" />`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${headline}">
  <rect width="100%" height="100%" fill="${bg}"/>
  ${artwork}
  <rect x="${pad / 2}" y="${pad / 2}" width="${width - pad}" height="${height - pad}" fill="none" stroke="${accent}" stroke-width="3" rx="28"/>
  ${logo}
  <text x="${width - pad}" y="${pad + 28}" text-anchor="end" fill="${accent}" font-size="16" font-family="IBM Plex Sans Arabic, sans-serif">${product}</text>
  <text x="${pad}" y="${Math.round(height * 0.48)}" fill="#f7f3ec" font-size="${Math.round(width * 0.055)}" font-weight="700" font-family="IBM Plex Sans Arabic, sans-serif">${headline}</text>
  <text x="${pad}" y="${Math.round(height * 0.58)}" fill="${accent}" font-size="${Math.round(width * 0.028)}" font-family="IBM Plex Sans Arabic, sans-serif">${subhead}</text>
  <text x="${pad}" y="${Math.round(height * 0.68)}" fill="#efe6d6" font-size="${Math.round(width * 0.022)}" font-family="IBM Plex Sans Arabic, sans-serif">${body}</text>
  <text x="${pad}" y="${height - pad}" fill="#d7cbb8" font-size="14" font-family="IBM Plex Sans Arabic, sans-serif">${company}</text>
</svg>`
}
