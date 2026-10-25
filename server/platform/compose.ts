import { newId } from '../lib/crypto.ts'
import { AppError, MissingProviderError } from '../lib/errors.ts'
import type { LlmProvider } from '../types.ts'
import { alternateImageSize, alternateScenePrompt, generateAlternateBackground } from './alternateImage.ts'
import { parseGeneratedLines, posterCopy } from './posterCopy.ts'
import { GeminiImageClient, GeminiTextClient } from './gemini.ts'
import { brandedSvg } from './svg.ts'
import type { LocalObjectStorage } from './storage.ts'
import type { PlatformStore } from './store.ts'
import type { BrandLanguage, BrandProfile, DesignRecord } from './types.ts'

export function previewTemplate(input: {
  brand: BrandProfile
  logoHref: string | null
  productName: string
  headline: string
  subhead: string
  body: string
  dimensions: string
  size?: string
}) {
  return brandedSvg({
    brand: input.brand,
    productName: input.productName,
    headline: input.headline,
    subhead: input.subhead,
    body: input.body,
    dimensions: input.dimensions,
    size: input.size,
    logoHref: input.logoHref,
  })
}

export async function composeDesign(input: {
  platform: PlatformStore
  storage: LocalObjectStorage
  brand: BrandProfile
  userId: string
  companyId: string
  llm: LlmProvider
  geminiText: Pick<GeminiTextClient, 'configured' | 'generateJson'>
  geminiImage: Pick<GeminiImageClient, 'configured' | 'generatePngDataUrl'>
  alternateImage?: (prompt: string, size: { width: number; height: number }) => Promise<string>
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
    size?: string
    instructions: string
    content: string
  }
}): Promise<DesignRecord> {
  const copy = await writeCopy(input)
  const logo = input.storage.readCompanyLogo(input.companyId, input.brand.logoPath, input.brand.logoMime)
  const logoHref = logo.ok ? logo.dataUrl : null
  let backgroundHref: string | null = null
  let backgroundOpacity = 0.55
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
      const reason = error instanceof AppError ? error.message : 'رفض Gemini توليد الصورة.'
      try {
        const alternate = input.alternateImage ?? generateAlternateBackground
        const scenePrompt = alternateScenePrompt({
          headline: copy.headline,
          eventTitle: input.payload.eventTitle,
          purpose: input.payload.purpose,
          instructions: input.payload.instructions,
          productName: input.payload.productName,
          primaryColor: input.brand.primaryColor,
          accentColor: input.brand.accentColor,
          tone: input.payload.style || input.brand.tone,
        })
        backgroundHref = await alternate(scenePrompt, alternateImageSize(input.payload.dimensions, input.payload.size))
        backgroundOpacity = 1
        backgroundKind = 'ai_bitmap_background'
        backgroundNote =
          'تعذر Gemini، فاستُخدمت خلفية من مزود بديل. الشعار النهائي هو الملف الأصلي للشركة، وليس رسماً من النموذج.'
      } catch (alternateError) {
        backgroundHref = null
        backgroundKind = 'branded_svg'
        const alternateReason = alternateError instanceof AppError ? alternateError.message : 'تعذر المزوّد البديل.'
        backgroundNote = `تعذر توليد الخلفية النقطية: ${reason} ${alternateReason} أُنشئ قالب SVG${logoHref ? ' مع الشعار الأصلي' : ' بدون شعار'}.`
      }
    }
  }

  const svg = brandedSvg({
    brand: input.brand,
    productName: input.payload.productName,
    headline: copy.headline,
    subhead: copy.subhead,
    body: copy.body,
    dimensions: input.payload.dimensions,
    size: input.payload.size,
    logoHref,
    backgroundHref,
    backgroundOpacity,
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

function copyPrompt(input: Parameters<typeof composeDesign>[0]) {
  const language = input.payload.language === 'en' ? 'English' : 'العربية'
  return [
    'اكتب نص ملصق مطبوع فقط. أرجع JSON صالحاً بلا شرح:',
    '{"headline":"سطر قصير","subhead":"سطر ثانٍ قصير"}',
    `الشركة: ${input.brand.companyName}. المناسبة: ${input.payload.eventTitle || 'عامة'}.`,
    `وصف المستخدم للنص: ${input.payload.instructions.trim() || 'تهنئة قصيرة تليق بالمناسبة'}.`,
    `الجمهور: ${input.payload.audience.trim() || 'عام'}. النبرة: ${input.payload.style || input.brand.tone}. اللغة: ${language}.`,
    'العنوان من كلمتين إلى أربع كلمات حتى يظهر كبيراً في سطر واحد. السطر الثاني جملة أقصر من العنوان.',
    'لا تضف تاريخاً ولا سعراً ولا هاشتاق، ولا تكرر اسم الشركة في السطرين.',
  ].join('\n')
}

async function writeCopy(input: Parameters<typeof composeDesign>[0]) {
  const brief = input.payload.instructions.trim()
  const eventTitle = input.payload.eventTitle.trim()
  if (input.geminiText.configured() && (brief || eventTitle)) {
    try {
      const generated = parseGeneratedLines(await input.geminiText.generateJson(copyPrompt(input)))
      if (generated) {
        return { headline: generated.headline, subhead: generated.subhead, body: input.payload.audience.trim() }
      }
    } catch (error) {
      if (!(error instanceof MissingProviderError) && !(error instanceof AppError)) throw error
    }
  }
  const lines = posterCopy({
    headline: input.payload.content.trim() || eventTitle,
    subhead: input.payload.purpose.trim(),
    eventTitle,
    companyName: input.brand.companyName,
  })
  return {
    headline: lines.headline,
    subhead: lines.subhead,
    body: input.payload.audience.trim(),
  }
}
