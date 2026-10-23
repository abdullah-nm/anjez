export type OccasionSource = {
  id: string
  title: string
  date?: string | null
  dateOfficial?: boolean
  audience?: string
  category?: string | null
  companyName: string
  slogan?: string
}

export type OccasionPrefill = {
  eventId: string
  eventTitle: string
  productId: string
  headline: string
  subhead: string
  body: string
  audience: string
  imageNote: string
}

export function suggestedProductId(category: string | null | undefined) {
  if (category === 'national' || category === 'islamic' || category === 'season') return 'prd-poster'
  if (category === 'conference' || category === 'launch') return 'prd-invite'
  return 'prd-poster'
}

export function prefillFromOccasion(source: OccasionSource): OccasionPrefill {
  const title = source.title.trim() || 'مناسبة'
  const company = source.companyName.trim() || 'الشركة'
  const productId = suggestedProductId(source.category)
  const audience = source.audience?.trim() || ''
  const officialDate = source.dateOfficial && source.date ? source.date : ''
  const slogan = source.slogan?.trim() || ''
  return {
    eventId: source.id,
    eventTitle: title,
    productId,
    headline: title,
    subhead: slogan || company,
    body: audience || `رسالة من ${company}`,
    audience,
    imageNote: officialDate
      ? `خلفية بصرية لـ«${title}» بهوية ${company}. الموعد المعروف ${officialDate} يُستخدم فقط إذا بقي في النص الظاهر. لا تضف تاريخًا آخر.`
      : `خلفية بصرية لـ«${title}» بهوية ${company}. لا تكتب تاريخًا أو تفاصيل رسمية غير الموجودة في النص الظاهر.`,
  }
}

export function draftHasWork(draft: { headline?: string; subhead?: string; body?: string; generatedImageDataUrl?: string }) {
  return Boolean(draft.headline?.trim() || draft.subhead?.trim() || draft.body?.trim() || draft.generatedImageDataUrl)
}
