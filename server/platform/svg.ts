import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrandProfile } from './types.ts'

const fontDir = join(dirname(fileURLToPath(import.meta.url)), '../assets/fonts')
const tajawalRegular = readFileSync(join(fontDir, 'Tajawal-400.ttf')).toString('base64')
const tajawalBold = readFileSync(join(fontDir, 'Tajawal-700.ttf')).toString('base64')

const NEUTRAL = '#1e3a5f'
const FONT = 'Tajawal'

export function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const PAPER_MM: Record<string, [number, number]> = {
  A6: [105, 148],
  A5: [148, 210],
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  A0: [841, 1189],
}

function scaleMm(widthMm: number, heightMm: number) {
  const long = Math.max(widthMm, heightMm)
  const scale = 1400 / long
  return {
    width: Math.max(360, Math.round(widthMm * scale)),
    height: Math.max(360, Math.round(heightMm * scale)),
  }
}

export function aspectBox(dimensions: string, size = '') {
  const source = `${size} ${dimensions}`
  const paper = source.match(/\bA[0-6]\b/i)
  if (paper) {
    const [width, height] = PAPER_MM[paper[0].toUpperCase()]
    return scaleMm(width, height)
  }
  const measured = source.match(/(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*(سم|م|mm|cm|m)?/)
  if (measured) {
    let width = Number(measured[1])
    let height = Number(measured[2])
    const unit = measured[3] || ''
    if (unit === 'سم' || unit === 'cm') {
      width *= 10
      height *= 10
    } else if (unit === 'م' || unit === 'm') {
      width *= 1000
      height *= 1000
    } else if (!unit && width <= 30 && height <= 30) {
      width *= 10
      height *= 10
    }
    return scaleMm(width, height)
  }
  if (dimensions.includes('portrait') || dimensions.includes('rollup') || dimensions.includes('رول')) {
    return { width: 794, height: 1123 }
  }
  if (dimensions.includes('landscape') || dimensions.includes('banner') || dimensions.includes('بنر')) {
    return { width: 1400, height: 560 }
  }
  return { width: 1000, height: 1000 }
}

function hexToRgb(hex: string) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

function rgbToHex(r: number, g: number, b: number) {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

function shade(hex: string, amount: number) {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const mix = 1 - amount
  return rgbToHex(rgb.r * mix, rgb.g * mix, rgb.b * mix)
}

function luminance(hex: string) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const channel = (value: number) => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

function inkFor(background: string) {
  return luminance(background) > 0.42 ? '#172033' : '#ffffff'
}

function isArabic(value: string) {
  return (value.match(/[\u0600-\u06FF]/g) || []).length >= (value.match(/[A-Za-z]/g) || []).length
}

function wrapLines(value: string, maxWidth: number, size: number) {
  const arabic = isArabic(value)
  const factor = arabic ? 0.78 : 0.58
  const maxChars = Math.max(4, Math.floor(maxWidth / (size * factor)))
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const rows: string[] = []
  let current = ''
  const push = (word: string) => {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      rows.push(current)
      current = word
    } else current = next
  }
    for (const word of words) push(word)
  if (current) rows.push(current)
  return rows
}

function svgId(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function balanceLines(lines: string[]) {
  if (lines.length < 2) return lines
  const next = [...lines]
  const last = next[next.length - 1].split(/\s+/).filter(Boolean)
  const prev = next[next.length - 2].split(/\s+/).filter(Boolean)
  if (last.length === 1 && prev.length >= 2) {
    const moved = prev.pop()
    next[next.length - 2] = prev.join(' ')
    next[next.length - 1] = `${moved} ${last[0]}`
  }
  return next
}

function fitSize(value: string, maxWidth: number, start: number, min: number, maxLines: number) {
  let size = start
  while (size > min && wrapLines(value, maxWidth, size).length > maxLines) size -= 2
  return size
}

export function brandedSvg(input: {
  brand: BrandProfile
  productName: string
  headline: string
  subhead: string
  body: string
  dimensions: string
  size?: string
  logoHref: string | null
  backgroundHref?: string | null
  backgroundOpacity?: number
}) {
  const { width, height } = aspectBox(input.dimensions, input.size || '')
  const margin = Math.round(Math.min(width, height) * 0.06)
  const landscape = width > height * 1.15
  const primary = hexToRgb(input.brand.primaryColor) ? input.brand.primaryColor : NEUTRAL
  const accent = hexToRgb(input.brand.accentColor) ? input.brand.accentColor : '#dbe4f0'
  const deep = shade(primary, 0.38)
  const footerFill = shade(primary, 0.5)
  const ink = inkFor(primary)
  const footerInk = inkFor(footerFill)
  const muted = ink === '#ffffff' ? 'rgba(255,255,255,0.82)' : 'rgba(23,32,51,0.78)'
  const uid = svgId(`${width}x${height}:${input.headline}:${input.productName}`)
  const company = input.brand.companyName.trim()
  const headline = input.headline.trim()
  const product = input.productName.trim()
  const subtitle = input.subhead.trim() || input.body.trim() || 'تصميم للطباعة'
  const sizeLabel = (input.size || '').trim()
  const footerH = Math.round(height * (landscape ? 0.16 : 0.1))
  const logoSide = Math.round(Math.min(width, height) * (landscape ? 0.2 : 0.16))
  const cardPad = Math.round(logoSide * 0.14)
  const card = logoSide + cardPad * 2
  const cardX = width - margin - card
  const cardY = margin
  const textWidth = Math.round(width * (landscape ? 0.72 : 0.78))
  const textX = Math.round(width / 2)
  const contentTop = cardY + card + margin
  const contentBottom = height - footerH - margin
  const maxHeadlineLines = 2

  let headlineSize = Math.min(92, Math.round(Math.min(width, height) * (landscape ? 0.11 : 0.078)))
  let subSize = Math.max(22, Math.round(headlineSize * 0.46))
  const pack = () => ({
    headlineLines: headline ? balanceLines(wrapLines(headline, textWidth, headlineSize)) : [],
    subLines: subtitle ? balanceLines(wrapLines(subtitle, textWidth, subSize)) : [],
  })
  const widerThan = (lines: string[], size: number) => lines.some((line) => (
    line.length * size * (isArabic(line) ? 0.78 : 0.58) > textWidth
  ))
  let packed = pack()
  while (
    (packed.headlineLines.length > maxHeadlineLines || packed.subLines.length > 2 || widerThan(packed.headlineLines, headlineSize) || widerThan(packed.subLines, subSize))
    && (headlineSize > 28 || subSize > 18)
  ) {
    if (packed.headlineLines.length > maxHeadlineLines && headlineSize > 28) headlineSize -= 2
    else if (subSize > 18) subSize -= 1
    else headlineSize -= 2
    subSize = Math.max(18, Math.min(subSize, Math.round(headlineSize * 0.46)))
    packed = pack()
  }
  const headlineLines = packed.headlineLines
  const subLines = packed.subLines.length ? packed.subLines : wrapLines(subtitle, textWidth, subSize)
  const lineGap = 1.38
  const headBlock = headlineLines.length * headlineSize * lineGap
  const subBlock = subLines.length * subSize * lineGap
  const blockGap = Math.round(headlineSize * 0.55)
  const blockHeight = headBlock + (subLines.length ? blockGap + subBlock : 0)
  const room = Math.max(headlineSize, contentBottom - contentTop)
  const centered = contentTop + (room - blockHeight) / 2 - room * 0.04
  const blockTop = Math.round(Math.max(contentTop, Math.min(centered, contentBottom - blockHeight)))
  const headlineY = Math.round(blockTop + headlineSize)
  const subY = Math.round(blockTop + headBlock + blockGap + subSize)
  const plateTop = Math.round(blockTop - headlineSize * 0.35)
  const plateBottom = Math.round(subY + Math.max(0, subLines.length - 1) * subSize * lineGap + subSize * 0.45)
  const plateX = Math.round((width - textWidth) / 2 - 36)
  const plateWidth = textWidth + 72

  let pillSize = product ? fitSize(product, Math.round(width * 0.34), 22, 14, 1) : 0
  let pillText = product ? wrapLines(product, Math.round(width * 0.34), pillSize)[0] || '' : ''
  const pillWidth = pillText
    ? Math.min(Math.round(width * 0.34), Math.round(pillText.length * pillSize * (isArabic(pillText) ? 0.72 : 0.58) + pillSize * 1.8))
    : 0
  const pillX = margin
  const pillY = margin
  const pillHeight = pillText ? Math.round(pillSize * 1.85) : 0

  const text = (lines: string[], y: number, size: number, fill: string, weight: string) => lines.map((row, index) => {
    const arabic = isArabic(row)
    const lineY = y + index * Math.round(size * lineGap)
    return `<text x="${textX}" y="${lineY}" text-anchor="middle" direction="${arabic ? 'rtl' : 'ltr'}" unicode-bidi="isolate" xml:lang="${arabic ? 'ar' : 'en'}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="${FONT}">${xmlEscape(row)}</text>`
  }).join('')

  const logoInner = input.logoHref
    ? `<image href="${xmlEscape(input.logoHref)}" xlink:href="${xmlEscape(input.logoHref)}" x="${cardX + cardPad}" y="${cardY + cardPad}" width="${logoSide}" height="${logoSide}" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="${cardX + card / 2}" y="${cardY + card / 2 + Math.round(logoSide * 0.16)}" text-anchor="middle" fill="${xmlEscape(primary)}" font-size="${Math.round(logoSide * 0.42)}" font-weight="700" font-family="${FONT}">${xmlEscape(company.slice(0, 1) || '•')}</text>`

  const backgroundOpacity = input.backgroundOpacity ?? 0.55
  const artwork = input.backgroundHref
    ? `<image href="${xmlEscape(input.backgroundHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="${backgroundOpacity}"/>`
    : ''
  const photo = Boolean(input.backgroundHref) && backgroundOpacity >= 0.75

  const companyArabic = isArabic(company)
  const companyX = companyArabic ? width - margin : margin
  const sizeX = companyArabic ? margin : width - margin
  const sizeAnchor = companyArabic ? 'end' : 'start'
  const footerSize = Math.max(14, Math.round(footerH * (company.length > 24 ? 0.22 : 0.28)))

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(headline || product)}">
  <defs>
    <style type="text/css"><![CDATA[
      @font-face { font-family: 'Tajawal'; font-weight: 400; src: url('data:font/ttf;base64,${tajawalRegular}') format('truetype'); }
      @font-face { font-family: 'Tajawal'; font-weight: 700; src: url('data:font/ttf;base64,${tajawalBold}') format('truetype'); }
    ]]></style>
    <linearGradient id="bg${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${xmlEscape(primary)}"/>
      <stop offset="100%" stop-color="${xmlEscape(deep)}"/>
    </linearGradient>
    <pattern id="geo${uid}" width="72" height="72" patternUnits="userSpaceOnUse">
      <path d="M36 8 L42 30 L64 36 L42 42 L36 64 L30 42 L8 36 L30 30 Z" fill="${ink}"/>
      <path d="M12 12 L20 12 L12 20 Z M60 52 L52 60 L60 60 Z" fill="${ink}"/>
    </pattern>
    <filter id="logoShadow${uid}" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#0b1220" flood-opacity="0.28"/>
    </filter>
    <clipPath id="frame${uid}"><rect width="${width}" height="${height}" rx="0"/></clipPath>
  </defs>
  <g clip-path="url(#frame${uid})">
    <rect width="${width}" height="${height}" fill="url(#bg${uid})"/>
    ${artwork}
    <rect width="${width}" height="${height}" fill="url(#geo${uid})" opacity="${photo ? '0' : '0.08'}"/>
    <circle cx="${margin}" cy="${height - footerH - margin}" r="${Math.round(Math.min(width, height) * 0.34)}" fill="${xmlEscape(accent)}" opacity="${photo ? '0' : '0.18'}"/>
    <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.78)}" r="${Math.round(Math.min(width, height) * 0.16)}" fill="${xmlEscape(accent)}" opacity="${photo ? '0' : '0.12'}"/>
    <rect x="${cardX}" y="${cardY}" width="${card}" height="${card}" rx="${Math.round(card * 0.16)}" fill="#ffffff" filter="url(#logoShadow${uid})"/>
    ${logoInner}
    ${pillText ? `<rect x="${pillX}" y="${pillY}" width="${pillWidth}" height="${pillHeight}" rx="${pillHeight / 2}" fill="${xmlEscape(accent)}" opacity="0.94"/>
    <text x="${pillX + pillWidth / 2}" y="${Math.round(pillY + pillHeight * 0.68)}" text-anchor="middle" fill="${inkFor(accent)}" font-size="${pillSize}" font-weight="700" font-family="${FONT}">${xmlEscape(pillText)}</text>` : ''}
    ${photo && (headlineLines.length || subLines.length) ? `<rect x="${Math.max(margin, plateX)}" y="${Math.max(margin, plateTop)}" width="${Math.min(width - margin * 2, plateWidth)}" height="${Math.max(headlineSize, plateBottom - plateTop)}" rx="32" fill="#07140f" opacity="0.58"/>` : ''}
    ${text(headlineLines, headlineY, headlineSize, photo ? '#ffffff' : ink, '700')}
    ${text(subLines, subY, subSize, photo ? 'rgba(255,255,255,0.92)' : muted, '400')}
    <rect x="0" y="${height - footerH}" width="${width}" height="${footerH}" fill="${xmlEscape(footerFill)}"/>
    <text x="${companyX}" y="${height - footerH / 2 + 6}" text-anchor="start" direction="${companyArabic ? 'rtl' : 'ltr'}" fill="${footerInk}" font-size="${footerSize}" font-weight="700" font-family="${FONT}">${xmlEscape(company)}</text>
    ${sizeLabel ? `<text x="${sizeX}" y="${height - footerH / 2 + 6}" text-anchor="${sizeAnchor}" direction="rtl" fill="${footerInk}" font-size="${Math.max(13, Math.round(footerSize * 0.86))}" font-family="${FONT}">${xmlEscape(`المقاس: ${sizeLabel}`)}</text>` : ''}
  </g>
</svg>`
}
