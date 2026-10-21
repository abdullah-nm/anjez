export type BrandLanguage = 'ar' | 'en'
export type DesignStatus = 'draft' | 'approved' | 'revision'

export type BrandProfile = {
  companyId: string
  companyName: string
  industry: string
  description: string
  language: BrandLanguage
  contactName: string
  email: string
  phone: string
  city: string
  primaryColor: string
  accentColor: string
  slogan: string
  tone: string
  logoPath: string | null
  logoMime: string | null
  updatedAt: string
}

export type CompanyEventRecord = {
  id: string
  companyId: string
  title: string
  date: string
  time: string | null
  description: string
  category: string
  audience: string
  status: 'planned' | 'confirmed' | 'done'
  reminderDays: number[]
  occasionKey: string | null
  recurring: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type DesignRecord = {
  id: string
  companyId: string
  eventId: string | null
  productId: string
  purpose: string
  audience: string
  language: BrandLanguage
  style: string
  dimensions: string
  instructions: string
  headline: string
  subhead: string
  body: string
  svg: string
  backgroundKind: 'branded_svg' | 'ai_bitmap_background'
  backgroundNote: string
  status: DesignStatus
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type NotificationRecord = {
  id: string
  companyId: string
  userId: string
  eventId: string | null
  designId: string | null
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

export type OccasionTemplate = {
  key: string
  titleAr: string
  titleEn: string
  category: string
  date: string
  recurring: boolean
  dateNote: string
}
