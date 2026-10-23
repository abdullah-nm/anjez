export type ProductKind =
  | 'invite'
  | 'banner'
  | 'rollup'
  | 'brochure'
  | 'bag'
  | 'backdrop'
  | 'card'
  | 'giftwrap'

export type EventKind = 'conference' | 'launch' | 'partners' | 'celebration'

export type Tone = 'فاخر' | 'ودّي' | 'رسمي' | 'حيوي'

export interface CompanyBrand {
  companyName: string
  industry: string
  contactName: string
  email: string
  phone: string
  city: string
  primaryColor: string
  accentColor: string
  slogan: string
  tone: Tone
  logoUrl?: string | null
}

export interface CompanyEvent {
  id: string
  title: string
  kind: EventKind
  date: string
  venue: string
  audience: string
  attendees: number
  notes: string
}

export interface PrintProduct {
  id: string
  name: string
  kind: ProductKind
  summary: string
  sizes: string[]
  fromPrice: number
  leadDays: number
}

export interface Recommendation {
  id: string
  eventId: string
  productId: string
  reason: string
}

export interface DesignDraft {
  productId: string
  eventId: string
  eventTitle?: string
  headline: string
  subhead: string
  body: string
  size: string
  generatedImageDataUrl?: string
  savedDesignId?: string
}

export interface PrintOrder {
  id: string
  createdAt: string
  productId: string
  eventId: string
  size: string
  quantity: number
  deliveryDate: string
  address: string
  deliveryCity?: string
  notes: string
  headline: string
  subhead: string
  body: string
  eventTitle?: string
  status: 'مستلم' | 'قيد التجهيز' | 'محفوظ'
}
