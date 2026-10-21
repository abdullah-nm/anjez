import { newId } from '../lib/crypto.ts'
import { AppError, MissingProviderError } from '../lib/errors.ts'
import type { LlmProvider } from '../types.ts'
import { GeminiImageClient, GeminiTextClient } from './gemini.ts'
import { brandedSvg } from './svg.ts'
import type { LocalObjectStorage } from './storage.ts'
import type { PlatformStore } from './store.ts'
import type { BrandLanguage, BrandProfile, DesignRecord } from './types.ts'

export async function composeDesign(input: {
  platform: PlatformStore
  storage: LocalObjectStorage
  brand: BrandProfile
  userId: string
  companyId: string
  llm: LlmProvider
  geminiText: Pick<GeminiTextClient, 'configured' | 'generateJson'>
  geminiImage: Pick<GeminiImageClient, 'configured' | 'generatePngDataUrl'>
  payload: {
    eventId: string | null
    eventTitle: string
    productId: string
    productName: string
    purpose: string
    audience: string
    language: BrandLanguage
    style: string
    dimensions: string
    instructions: string
    content: string
  }
}): Promise<DesignRecord> {
  const copy = await writeCopy(input)
  const logo = input.storage.readCompanyLogo(input.companyId, input.brand.logoPath, input.brand.logoMime)
  const logoHref = logo.ok ? logo.dataUrl : null
  let backgroundHref: string | null = null
  let backgroundKind: DesignRecord['backgroundKind'] = 'branded_svg'
  let backgroundNote =
    'قالب SVG قابل للتحرير يضم شعار الشركة وألوان الهوية. هذا ليس صورة نقطية مولَّدة بالذكاء الاصطناعي.'

  const imagePrompt = [
    'Create an abstract print background inspired by the attached company logo colors and visual style.',
    'Do not redraw, copy, or include the logo, letters, or any text in the generated image.',
    'Leave clear empty space in the center and top-start for overlay copy and the real logo file.',
    `Brand colors ${input.brand.primaryColor} and ${input.brand.accentColor}. Tone: ${input.payload.style || input.brand.tone}.`,
    `Product: ${input.payload.productName}. Occasion: ${input.payload.eventTitle}. Purpose: ${input.payload.purpose}.`,
    input.payload.instructions,
  ]
    .filter(Boolean)
    .join(' ')

  if (!logo.ok) {
    backgroundNote = `${logo.reason} أُنشئ قالب SVG بدون خلفية نقطية.`
  } else if (!input.geminiImage.configured()) {
    backgroundNote = 'Gemini غير مضبوط. أُنشئ قالب SVG بالشعار الأصلي من ملف الهوية، بدون خلفية نقطية.'
  } else {
    try {
      const reference = logo.geminiInline ? { mimeType: logo.mime, data: logo.buffer.toString('base64') } : null
      backgroundHref = await input.geminiImage.generatePngDataUrl(imagePrompt, reference)
      backgroundKind = 'ai_bitmap_background'
      backgroundNote = reference
        ? 'خلفية Gemini مستلهمة من شعار الهوية وألوانها. الشعار النهائي هو الملف الأصلي للشركة، وليس رسماً من النموذج.'
        : 'الشعار SVG لم يُرسل إلى Gemini كصورة نقطية. الخلفية من الألوان فقط، والملف الأصلي مُدرج في القالب.'
    } catch (error) {
      if (!(error instanceof MissingProviderError) && !(error instanceof AppError)) throw error
      backgroundHref = null
      backgroundKind = 'branded_svg'
      const reason = error instanceof AppError ? error.message : 'رفض Gemini توليد الصورة.'
      backgroundNote = `تعذر توليد الخلفية النقطية: ${reason} أُنشئ قالب SVG${logoHref ? ' مع الشعار الأصلي' : ' بدون شعار'}.`
    }
  }

  const svg = brandedSvg({
    brand: input.brand,
    productName: input.payload.productName,
    headline: copy.headline,
    subhead: copy.subhead,
    body: copy.body,
    dimensions: input.payload.dimensions,
    logoHref,
    backgroundHref,
  })

  const now = new Date().toISOString()
  const design: DesignRecord = {
    id: newId('des'),
    companyId: input.companyId,
    eventId: input.payload.eventId,
    productId: input.payload.productId,
    purpose: input.payload.purpose,
    audience: input.payload.audience,
    language: input.payload.language,
    style: input.payload.style,
    dimensions: input.payload.dimensions,
    instructions: input.payload.instructions,
    headline: copy.headline,
    subhead: copy.subhead,
    body: copy.body,
    svg,
    backgroundKind,
    backgroundNote,
    status: 'draft',
    createdBy: input.userId,
    createdAt: now,
    updatedAt: now,
  }
  input.platform.insertDesign(design)
  return design
}

async function writeCopy(input: Parameters<typeof composeDesign>[0]) {
  const fallback = {
    headline: input.payload.eventTitle || input.brand.companyName,
    subhead: input.brand.slogan || input.payload.purpose,
    body: input.payload.content || input.payload.audience,
  }
  const prompt = `Return JSON {"headline","subhead","body"} for a print ${input.payload.productName}.
Language: ${input.payload.language === 'en' ? 'English' : 'Arabic'}.
Company: ${input.brand.companyName}. Industry: ${input.brand.industry}. Tone: ${input.brand.tone}.
Event: ${input.payload.eventTitle}. Audience: ${input.payload.audience}. Purpose: ${input.payload.purpose}.
User copy: ${input.payload.content}. Extra: ${input.payload.instructions}.
Do not invent prices, stock, suppliers, or fulfillment. Keep each field under 80 characters.`

  try {
    if (input.geminiText.configured()) {
      const raw = await input.geminiText.generateJson(prompt)
      const parsed = JSON.parse(extractJson(raw)) as { headline?: string; subhead?: string; body?: string }
      return {
        headline: parsed.headline || fallback.headline,
        subhead: parsed.subhead || fallback.subhead,
        body: parsed.body || fallback.body,
      }
    }
    const raw = await input.llm.complete({
      system: 'Return only JSON with headline, subhead, body. No extra keys.',
      user: prompt,
    })
    const parsed = JSON.parse(extractJson(raw)) as { headline?: string; subhead?: string; body?: string }
    return {
      headline: parsed.headline || fallback.headline,
      subhead: parsed.subhead || fallback.subhead,
      body: parsed.body || fallback.body,
    }
  } catch {
    return fallback
  }
}

function extractJson(raw: string) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('no json')
  return raw.slice(start, end + 1)
}
