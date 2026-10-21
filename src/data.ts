import type {
  CompanyBrand,
  CompanyEvent,
  PrintProduct,
  Recommendation,
} from './types'

export const defaultBrand: CompanyBrand = {
  companyName: 'نبراس للضيافة',
  industry: 'فعاليات وضيافة شركات',
  contactName: 'سارة العتيبي',
  email: 'sara@nebras.sa',
  phone: '011 420 1180',
  city: 'الرياض',
  primaryColor: '#142433',
  accentColor: '#c4a46a',
  slogan: 'ضيافة تُروى وتُذكر',
  tone: 'فاخر',
}

export const events: CompanyEvent[] = [
  {
    id: 'evt-forum',
    title: 'منتدى القيادة السنوي',
    kind: 'conference',
    date: '2026-11-12',
    venue: 'مركز الملك عبدالعزيز للمؤتمرات',
    audience: 'قيادات تنفيذية وشركاء استراتيجيون',
    attendees: 280,
    notes: 'جلسة مسائية رسمية مع عشاء تكريمي.',
  },
  {
    id: 'evt-launch',
    title: 'إطلاق قائمة الشتاء',
    kind: 'launch',
    date: '2026-11-28',
    venue: 'قاعة الواحة — العليا',
    audience: 'عملاء الشركات ووسائل الإعلام',
    attendees: 120,
    notes: 'تجربة تذوق قصيرة وتصوير للمنتجات.',
  },
  {
    id: 'evt-partners',
    title: 'ملتقى الشركاء',
    kind: 'partners',
    date: '2026-12-08',
    venue: 'مقر نبراس — حي الصحافة',
    audience: 'مديرو الحسابات والموردون',
    attendees: 60,
    notes: 'يوم عمل مفتوح مع ركن هدايا.',
  },
  {
    id: 'evt-yearend',
    title: 'حفل ختام السنة',
    kind: 'celebration',
    date: '2026-12-22',
    venue: 'قصر الثقافة — الدرعية',
    audience: 'فريق الشركة وعائلاتهم',
    attendees: 190,
    notes: 'أجواء احتفالية دافئة مع توزيع هدايا.',
  },
]

export const products: PrintProduct[] = [
  {
    id: 'prd-invite',
    name: 'بطاقات دعوة',
    kind: 'invite',
    summary: 'بطاقة سميكة بحواف ذهبية تناسب الدعوات الرسمية.',
    sizes: ['A6', 'A5'],
    fromPrice: 4.8,
    leadDays: 5,
  },
  {
    id: 'prd-banner',
    name: 'بنر داخلي',
    kind: 'banner',
    summary: 'طباعة قماشية للقاعات والاستقبال بدون لمعان مزعج.',
    sizes: ['200×80 سم', '300×100 سم'],
    fromPrice: 280,
    leadDays: 4,
  },
  {
    id: 'prd-rollup',
    name: 'رول أب',
    kind: 'rollup',
    summary: 'ستاند متنقل سريع التركيب للمعارض والمداخل.',
    sizes: ['85×200 سم'],
    fromPrice: 190,
    leadDays: 3,
  },
  {
    id: 'prd-brochure',
    name: 'بروشور ثلاثي',
    kind: 'brochure',
    summary: 'مطوية تعرض البرنامج والضيافة ومسار الحضور.',
    sizes: ['A4 مطوي'],
    fromPrice: 2.4,
    leadDays: 6,
  },
  {
    id: 'prd-bag',
    name: 'أكياس تسوق',
    kind: 'bag',
    summary: 'كيس كرافت مقوّى مع مقبض قماشي وهوية الشركة.',
    sizes: ['وسط', 'كبير'],
    fromPrice: 6.5,
    leadDays: 8,
  },
  {
    id: 'prd-backdrop',
    name: 'خلفية تصوير',
    kind: 'backdrop',
    summary: 'جدار مطبوع للصور الرسمية والتغطيات الإعلامية.',
    sizes: ['3×2.5 م', '4×3 م'],
    fromPrice: 740,
    leadDays: 7,
  },
  {
    id: 'prd-card',
    name: 'بطاقات عمل',
    kind: 'card',
    summary: 'بطاقة موظفين بلمسة خفيفة وبيانات واضحة.',
    sizes: ['9×5 سم'],
    fromPrice: 1.1,
    leadDays: 4,
  },
  {
    id: 'prd-gift',
    name: 'تغليف هدايا',
    kind: 'giftwrap',
    summary: 'ورق وشريط يحملان شعار الحدث للمخرجات التذكارية.',
    sizes: ['طقم ضيافة'],
    fromPrice: 9.2,
    leadDays: 6,
  },
]

export const recommendations: Recommendation[] = [
  {
    id: 'rec-1',
    eventId: 'evt-forum',
    productId: 'prd-invite',
    reason: 'الحدث رسمي والحضور محدود؛ الدعوة المطبوعة تعكس مستوى الضيافة.',
  },
  {
    id: 'rec-2',
    eventId: 'evt-forum',
    productId: 'prd-backdrop',
    reason: 'جلسة التصوير مع القيادات تحتاج خلفية بهوية ثابتة.',
  },
  {
    id: 'rec-3',
    eventId: 'evt-launch',
    productId: 'prd-rollup',
    reason: 'مدخل القاعة يحتاج رسالة إطلاق سريعة وواضحة.',
  },
  {
    id: 'rec-4',
    eventId: 'evt-launch',
    productId: 'prd-brochure',
    reason: 'الضيوف يسألون عن القائمة الجديدة؛ المطوية تختصر التجربة.',
  },
  {
    id: 'rec-5',
    eventId: 'evt-partners',
    productId: 'prd-bag',
    reason: 'ركن الهدايا يحتاج حملاً أنيقاً يحمل اسم نبراس.',
  },
  {
    id: 'rec-6',
    eventId: 'evt-yearend',
    productId: 'prd-gift',
    reason: 'التغليف التذكاري يبقى بعد الحفل أكثر من أي بنر.',
  },
]

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${iso}T12:00:00`))
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency: 'SAR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 1,
  }).format(value)
}

export function eventById(id: string) {
  return events.find((item) => item.id === id)
}

export function productById(id: string) {
  return products.find((item) => item.id === id)
}

export function suggestionsFor(input: {
  productName: string
  eventTitle: string
  venue: string
  date: string
  brand: CompanyBrand
}) {
  const dateLabel = formatDate(input.date)
  const { brand, eventTitle, venue, productName } = input

  const lines = {
    فاخر: [
      `${brand.companyName} تدعوكم`,
      eventTitle,
      `${dateLabel} — ${venue}`,
    ],
    ودّي: [
      `أهلاً بكم في ${eventTitle}`,
      brand.slogan,
      `${venue} · ${dateLabel}`,
    ],
    رسمي: [
      `دعوة حضور: ${eventTitle}`,
      brand.companyName,
      `${venue} | ${dateLabel}`,
    ],
    حيوي: [
      `${eventTitle} يبدأ هنا`,
      brand.slogan,
      `كونوا معنا في ${venue}`,
    ],
  } as const

  const [headline, subhead, body] = lines[brand.tone]

  return [
    { id: 's1', label: 'نبرة الهوية', headline, subhead, body },
    {
      id: 's2',
      label: 'مباشر للحدث',
      headline: eventTitle,
      subhead: `${productName} من ${brand.companyName}`,
      body: `${dateLabel} في ${venue}`,
    },
    {
      id: 's3',
      label: 'قصير للمدخل',
      headline: brand.companyName,
      subhead: eventTitle,
      body: dateLabel,
    },
  ]
}
