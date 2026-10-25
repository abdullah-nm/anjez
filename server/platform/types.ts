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

export type DateCertainty = 'official' | 'estimated' | 'unannounced'

export type CompanyEventRecord = {
  id: string
  companyId: string
  title: string
  date: string | null
  time: string | null
  description: string
  category: string
  audience: string
  status: 'planned' | 'confirmed' | 'done'
  reminderDays: number[]
  occasionKey: string | null
  recurring: boolean
  dateCertainty: DateCertainty
  dateNote: string
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
  kind: string
  payload: string
  readAt: string | null
  createdAt: string
}

export type OccasionTemplate = {
  key: string
  titleAr: string
  titleEn: string
  category: 'national' | 'islamic' | 'season'
  month?: number
  day?: number
  hijriMonth?: number
  hijriDay?: number
  recurring: boolean
  dateNote: string
}

export type SystemOccasionHistory = {
  date: string | null
  cycle: string
  dateCertainty: DateCertainty
  source: string
  checkedAt: string | null
}

export type SystemOccasionRecord = {
  key: string
  titleAr: string
  titleEn: string
  category: 'national' | 'islamic' | 'season'
  date: string | null
  dateCertainty: DateCertainty
  dateNote: string
  source: string
  cycle: string
  recurring: boolean
  checkedAt: string | null
  syncStatus: 'ok' | 'stale'
  history: SystemOccasionHistory[]
  updatedAt: string
}

export type CalendarSyncState = {
  status: 'ok' | 'stale'
  source: string
  checkedAt: string | null
  attemptedAt: string | null
  message: string
}
