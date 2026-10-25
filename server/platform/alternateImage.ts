import { AppError } from '../lib/errors.ts'
import { aspectBox } from './svg.ts'

const ENDPOINT = 'https://image.pollinations.ai/prompt/'

const SCENES: Array<[RegExp, string]> = [
  [/تأسيس|تاسيس|founding/i, 'historic Diriyah mud-brick palace, palm trees, warm sandstone courtyard, Saudi Founding Day celebration'],
  [/يوم العلم|flag day/i, 'palm silhouettes with green and white festive light, no flag and no national emblem'],
  [/اليوم الوطني|national day/i, 'palm trees, green and white festive lights, Saudi National Day evening celebration, no flag'],
  [/رمضان|ramadan/i, 'a dark elegant night with a few soft lanterns and a thin crescent, mostly empty dark space'],
  [/عيد الفطر|الفطر|eid al-fitr|eid-fitr/i, 'Eid al-Fitr crescent moon, lanterns, dates and sweets, warm gold light'],
  [/عرفة|arafah/i, 'calm desert plain at sunrise with distant mountains, Day of Arafah'],
  [/أضحى|اضحى|adha/i, 'Eid al-Adha desert morning, warm earth courtyard, festive and calm'],
  [/حج|hajj/i, 'Hajj season, white tones and desert mountains, calm atmosphere, no calligraphy'],
  [/موسم الرياض|riyadh season/i, 'modern Riyadh skyline at night with festive lights'],
  [/جدة|jeddah/i, 'Jeddah corniche and the Red Sea at dusk with festive lights'],
  [/الدرعية|diriyah/i, 'Diriyah mud-brick heritage site in warm evening light'],
  [/العلا|alula|al-ula/i, 'AlUla sandstone cliffs in clear winter light'],
  [/كتاب|book fair/i, 'elegant closed books and warm library light, no readable writing'],
  [/رياض|sport/i, 'sports stadium lights and motion, no team marks'],
  [/ثقاف|cultur/i, 'Saudi cultural gathering beside traditional architecture'],
]

export function alternateScenePrompt(input: {
  headline: string
  eventTitle: string
  purpose: string
  instructions: string
  productName: string
  primaryColor: string
  accentColor: string
  tone: string
}) {
  const source = [input.eventTitle, input.headline, input.instructions, input.purpose].join(' ')
  const scene = SCENES.find(([pattern]) => pattern.test(source))?.[1]
    ?? 'elegant photographic celebration that matches the written subject, not an abstract swirl'
  return [
    `Photorealistic print background for a ${input.productName || 'poster'}.`,
    `Subject: ${scene}.`,
    `Color grade ${input.primaryColor} and ${input.accentColor}. Tone: ${input.tone || 'elegant'}.`,
    'Background photograph only. No frame, no oval, no medallion, no border, no ornament, no calligraphy, and no fake letters.',
    'No numerals, no logo, no watermark, and no flag. Leave the upper area calm for real text added later.',
  ].join(' ')
}

export function alternateImageSize(dimensions: string, size = '') {
  const box = aspectBox(dimensions, size)
  const scale = Math.min(1, 768 / Math.max(box.width, box.height))
  return {
    width: Math.max(256, Math.round(box.width * scale)),
    height: Math.max(256, Math.round(box.height * scale)),
  }
}

function isRaster(bytes: Buffer) {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  return jpeg || png
}

export async function generateAlternateBackground(
  prompt: string,
  size: { width: number; height: number },
) {
  const clipped = prompt.replace(/\s+/g, ' ').trim().slice(0, 500)
  const url = new URL(`${ENDPOINT}${encodeURIComponent(clipped)}`)
  url.searchParams.set('width', String(size.width))
  url.searchParams.set('height', String(size.height))
  url.searchParams.set('nologo', 'true')
  url.searchParams.set('safe', 'true')
  url.searchParams.set('seed', String(Math.floor(Math.random() * 1_000_000_000)))

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'image/jpeg,image/png' },
      signal: AbortSignal.timeout(40_000),
    })
  } catch {
    throw new AppError('تعذر الاتصال بالمزوّد البديل.', 502, 'IMAGE_GENERATION_UNAVAILABLE')
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const type = response.headers.get('content-type') || ''
  if (response.status === 402) {
    throw new AppError('المزوّد البديل يسمح بصورة واحدة كل 45 ثانية.', 429, 'IMAGE_GENERATION_UNAVAILABLE')
  }
  if (!response.ok || !type.startsWith('image/') || !isRaster(bytes)) {
    throw new AppError('تعذر المزوّد البديل.', 502, 'IMAGE_GENERATION_UNAVAILABLE')
  }
  const mime = type.includes('png') ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${bytes.toString('base64')}`
}
