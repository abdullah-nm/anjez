import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { localizedCityName } from '../shared/cities.ts'
import { localeFromStored } from '../shared/locale.ts'
import { pluralCategory } from '../shared/plural.ts'
import { arExtra, enExtra } from '../shared/uiExtra.ts'

export type Locale = 'ar' | 'en'

const ar = {
  brand: 'أنجز',
  loading: 'جارٍ التحميل…',
  save: 'حفظ',
  cancel: 'إلغاء',
  logout: 'خروج',
  login: 'تسجيل الدخول',
  retry: 'إعادة المحاولة',
  language: 'English',
  navHome: 'اللوحة',
  navBrand: 'الهوية',
  navCalendar: 'التقويم',
  navKnowledge: 'المعرفة',
  navAlerts: 'تنبيهات',
  navMonitor: 'المراقبة',
  navDispatch: 'الإسناد',
  navProvider: 'طلباتي',
  navOther: 'صفحات أخرى',
  registerCompany: 'إنشاء حساب شركة',
  registerProvider: 'تسجيل مقدم خدمة',
  stepProduct: 'المنتج',
  stepText: 'النص',
  stepPreview: 'المعاينة',
  stepOrder: 'الطلب',
  stepCaption: 'الخطوة {current} من ٤',
  stepsLabel: 'خطوات التصميم',
  welcomeGuest: 'تصميم مطبوع',
  welcomeHello: 'مرحباً {name}',
  start: 'ابدأ',
  loginTitle: 'تسجيل الدخول',
  loginHint: 'للشركة أو مقدم الخدمة الذي لديه حساب. لن يُنشأ حساب جديد عند الدخول.',
  registerTitle: 'إنشاء حساب شركة جديدة',
  registerHint: 'للشركة التي لم تسجّل سابقًا. الحساب يُحفظ ويمكن الدخول إليه لاحقًا بنفس البريد وكلمة المرور.',
  providerTitle: 'حساب مقدم خدمة',
  providerHint: 'للمحل أو الفرد. لا يستقبل طلبات حتى يعتمده أدمن المنصة.',
  companyName: 'اسم الشركة',
  ownerName: 'اسم صاحب الحساب',
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  confirmPassword: 'تأكيد كلمة المرور',
  saving: 'جارٍ الحفظ…',
  createCompany: 'إنشاء حساب الشركة',
  haveCompany: 'لدي حساب شركة؟ تسجيل الدخول',
  newCompany: 'إنشاء حساب شركة جديدة',
  providerKind: 'نوع مقدم الخدمة',
  shop: 'محل',
  individual: 'فرد',
  activityName: 'اسم النشاط أو الشخص',
  city: 'المدينة',
  phone: 'الهاتف',
  services: 'الخدمات المتاحة',
  createProvider: 'إرسال طلب الحساب',
  orderTitle: 'طلب الطباعة',
  productLine: 'المنتج: {product} · المقاس: {size} · المناسبة: {event}',
  noPreview: 'لا توجد معاينة مولَّدة بعد.',
  backStudio: 'العودة للاستوديو',
  previewNotFile: 'المعاينة ليست ملف طباعة.',
  quantity: 'الكمية',
  deliveryDate: 'تاريخ التسليم المطلوب',
  deliveryCity: 'مدينة التسليم',
  cityExample: 'مثال: الرياض',
  address: 'عنوان التسليم',
  printNotes: 'ملاحظات للطباعة',
  notesExample: 'مثل: لمسة ذهبية على الاسم فقط',
  catalogPrice: 'سعر الكتالوج للوحدة {price} للاستئناس فقط، وليس عرض مقدم خدمة.',
  leadDays: 'المدة المعتادة في الكتالوج {days} أيام عمل.',
  sendOrder: 'إرسال الطلب',
  orderFailed: 'لم يُحفظ الطلب على الخادم.',
  screenPreview: 'معاينة الشاشة · ليست ملف طباعة',
  orderStored: 'يُحفظ الطلب على الخادم، ثم يسنده أدمن المنصة إلى مقدم خدمة معتمد.',
  missingOrder: 'لا يوجد طلب بهذا الرقم',
  missingOrderHint: 'ربما فُتح الرابط على جهاز آخر، أو لم يُحفظ الطلب بعد.',
  backToOrder: 'العودة لنموذج الطلب',
  savedOrder: 'تم إرسال {id}',
  status: 'الحالة',
  companyLine: 'الشركة: {company} · {contact}',
  productBits: 'المنتج: {product} · المقاس {size}',
  occasion: 'المناسبة',
  noOccasion: 'بدون مناسبة',
  notPrintFile: 'التصميم المرفق معاينة وليست ملفاً جاهزاً للطباعة. أدمن المنصة يسند الطلب بعد الحفظ.',
  providerLabel: 'مقدم الخدمة',
  updates: 'التحديثات',
  anotherDesign: 'تصميم آخر',
  toHome: 'إلى اللوحة',
  providerWaiting: 'الحساب بانتظار اعتماد أدمن المنصة. لن تُسند إليك طلبات قبل الاعتماد.',
  providerRejected: 'رُفض اعتماد الحساب. يمكنك تعديل البيانات، والاعتماد يبقى عند أدمن المنصة.',
  assignedOrders: 'الطلبات المسندة',
  noAssigned: 'لا طلبات مسندة حالياً.',
  accept: 'قبول',
  reject: 'رفض',
  startWork: 'قيد التنفيذ',
  completeWork: 'مكتمل',
  rejectNote: 'سبب الرفض',
  profileSaved: 'حُفظت بيانات النشاط.',
  dispatchTitle: 'إسناد الطلبات واعتماد مقدمي الخدمة',
  pendingProviders: 'مقدمو الخدمة',
  noProviders: 'لا حسابات لمقدمي الخدمة.',
  approve: 'اعتماد',
  rejectProvider: 'رفض الاعتماد',
  ordersToAssign: 'الطلبات',
  assign: 'إسناد',
  noOrders: 'لا طلبات.',
  approvedOnly: 'يظهر مقدم الخدمة هنا بعد الاعتماد، وإذا كانت خدمة الطلب ضمن خدماته.',
  companyOnly: 'هذه الصفحة لحساب الشركة.',
  adminOnly: 'هذه الصفحة لأدمن المنصة فقط.',
  providerOnly: 'هذه الصفحة لمقدم الخدمة.',
  accountTitle: 'بيانات الحساب',
  accountHint: 'تعديل اسم الشركة واسم صاحب الحساب. لا يغيّر هذا النموذج الدور أو الصلاحيات.',
  designNew: 'تصميم جديد',
  upcoming: 'أقرب المناسبات',
  platformFollow: 'متابعة المنصة',
  period: 'الفترة الزمنية',
  from: 'من',
  to: 'إلى',
  companyFilter: 'الشركة',
  allCompanies: 'كل الشركات',
  searchCompany: 'ابحث بالاسم',
  allCities: 'كل المدن',
  allOccasions: 'كل المناسبات',
  resetFilters: 'إعادة تعيين الفلاتر',
  registeredCompanies: 'الشركات المسجّلة',
  savedRequests: 'طلبات مراجعة محفوظة',
  dailyAverage: 'متوسط الطلبات اليومي',
  monitorLoading: 'جارٍ تحميل لوحة المتابعة…',
  calendarTitle: 'المناسبات والتذكير قبل الموعد',
  knowledgeTitle: 'مستندات معزولة، واسترجاع دلالي داخل شركتك فقط',
  alertsTitle: 'مركز التنبيهات',
  studioProduct: 'المنتج والنص',
  studioPreview: 'المعاينة',
  occasionLoading: 'جارٍ تحميل مناسبات التقويم…',
  selectedOccasion: 'المناسبة المحددة',
  designLanguage: 'لغة النص على التصميم',
  brandTitle: 'ملف الشركة وعدة الهوية للطباعة والتصميم',
  status_saved: 'محفوظ',
  status_preparing: 'قيد التجهيز',
  status_received: 'مستلم',
  status_assigned: 'مسند',
  status_accepted: 'مقبول',
  status_rejected: 'مرفوض',
  status_progress: 'قيد التنفيذ',
  status_done: 'مكتمل',
  status_cancelled: 'ملغى',
  approval_pending: 'بانتظار الاعتماد',
  approval_approved: 'معتمد',
  approval_rejected: 'مرفوض الاعتماد',
  service_print: 'طباعة',
  service_install: 'تركيب',
  service_gifts: 'هدايا',
  service_signage: 'لوحات',
  product_invite: 'بطاقات دعوة',
  product_banner: 'بنر داخلي',
  product_rollup: 'رول أب',
  product_brochure: 'بروشور',
  product_bag: 'أكياس',
  product_backdrop: 'خلفيات',
  product_card: 'بطاقات عمل',
  product_gift: 'تغليف هدايا',
  product_mug: 'أكواب',
  product_notebook: 'دفاتر',
  product_greeting: 'بطاقات تهنئة',
  product_poster: 'ملصقات',
  err_EMAIL_REQUIRED: 'أدخل البريد الإلكتروني.',
  err_PASSWORD_REQUIRED: 'أدخل كلمة المرور.',
  err_INVALID_CREDENTIALS: 'البريد أو كلمة المرور غير صحيحة.',
  err_INVALID_NAME: 'أدخل الاسم بين حرفين وثمانين حرفًا.',
  err_INVALID_EMAIL: 'البريد الإلكتروني غير صالح.',
  err_WEAK_PASSWORD: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.',
  err_PASSWORD_MISMATCH: 'تأكيد كلمة المرور غير مطابق.',
  err_EMAIL_TAKEN: 'هذا البريد مسجّل بالفعل. سجّل الدخول بدل إنشاء حساب جديد.',
  err_FORBIDDEN: 'صلاحية غير كافية.',
  err_PROVIDER_PENDING: 'حساب مقدم الخدمة غير معتمد بعد.',
  err_INVALID_TRANSITION: 'لا يمكن نقل الطلب إلى هذه الحالة.',
  err_SERVICE_MISMATCH: 'مقدم الخدمة لا يقدّم خدمة هذا الطلب.',
  err_NOT_FOUND: 'العنصر غير موجود.',
  err_INVALID_SERVICE: 'اختر خدمة من القائمة.',
  err_ORDER_EXISTS: 'هذا الطلب محفوظ بالفعل.',
  err_ROLE_FORBIDDEN: 'لا يمكن اختيار الدور من نموذج التسجيل.',
  err_LOGIN_FAILED: 'تعذر تسجيل الدخول.',
  err_REGISTER_FAILED: 'تعذر إنشاء الحساب.',
} as const

const en: Record<keyof typeof ar, string> = {
  brand: 'Anjez',
  loading: 'Loading…',
  save: 'Save',
  cancel: 'Cancel',
  logout: 'Log out',
  login: 'Log in',
  retry: 'Try again',
  language: 'العربية',
  navHome: 'Home',
  navBrand: 'Identity',
  navCalendar: 'Calendar',
  navKnowledge: 'Knowledge',
  navAlerts: 'Alerts',
  navMonitor: 'Monitoring',
  navDispatch: 'Assignment',
  navProvider: 'My orders',
  navOther: 'Other pages',
  registerCompany: 'Create a company account',
  registerProvider: 'Register as a provider',
  stepProduct: 'Product',
  stepText: 'Text',
  stepPreview: 'Preview',
  stepOrder: 'Order',
  stepCaption: 'Step {current} of 4',
  stepsLabel: 'Design steps',
  welcomeGuest: 'Print design',
  welcomeHello: 'Hello {name}',
  start: 'Start',
  loginTitle: 'Log in',
  loginHint: 'For a company or provider that already has an account. Logging in does not create an account.',
  registerTitle: 'Create a new company account',
  registerHint: 'For a company that has not registered before. The account is saved and can be used later with the same email and password.',
  providerTitle: 'Service provider account',
  providerHint: 'For a shop or an individual. Orders are not assigned until a platform admin approves the account.',
  companyName: 'Company name',
  ownerName: 'Account owner',
  email: 'Email',
  password: 'Password',
  confirmPassword: 'Confirm password',
  saving: 'Saving…',
  createCompany: 'Create the company account',
  haveCompany: 'Already have a company account? Log in',
  newCompany: 'Create a new company account',
  providerKind: 'Provider type',
  shop: 'Shop',
  individual: 'Individual',
  activityName: 'Business or person name',
  city: 'City',
  phone: 'Phone',
  services: 'Services offered',
  createProvider: 'Submit account request',
  orderTitle: 'Print order',
  productLine: 'Product: {product} · Size: {size} · Occasion: {event}',
  noPreview: 'There is no generated preview yet.',
  backStudio: 'Back to the studio',
  previewNotFile: 'The preview is not a print file.',
  quantity: 'Quantity',
  deliveryDate: 'Requested delivery date',
  deliveryCity: 'Delivery city',
  cityExample: 'Example: Riyadh',
  address: 'Delivery address',
  printNotes: 'Print notes',
  notesExample: 'Example: gold foil on the name only',
  catalogPrice: 'Catalog unit price {price} is a guide only, not a provider quote.',
  leadDays: 'The catalog lead time is {days} business days.',
  sendOrder: 'Send order',
  orderFailed: 'The order was not saved on the server.',
  screenPreview: 'Screen preview · not a print file',
  orderStored: 'The order is saved on the server. A platform admin then assigns it to an approved provider.',
  missingOrder: 'No order with this number',
  missingOrderHint: 'The link may have been opened on another device, or the order was not saved.',
  backToOrder: 'Back to the order form',
  savedOrder: 'Sent {id}',
  status: 'Status',
  companyLine: 'Company: {company} · {contact}',
  productBits: 'Product: {product} · size {size}',
  occasion: 'Occasion',
  noOccasion: 'No occasion',
  notPrintFile: 'The attached design is a preview, not a print-ready file. A platform admin assigns the order after it is saved.',
  providerLabel: 'Service provider',
  updates: 'Updates',
  anotherDesign: 'Another design',
  toHome: 'To the board',
  providerWaiting: 'This account is waiting for platform-admin approval. Orders will not be assigned before that.',
  providerRejected: 'Approval was rejected. You can edit the profile. Only a platform admin can approve it.',
  assignedOrders: 'Assigned orders',
  noAssigned: 'No orders are assigned right now.',
  accept: 'Accept',
  reject: 'Reject',
  startWork: 'In progress',
  completeWork: 'Completed',
  rejectNote: 'Reason for rejection',
  profileSaved: 'The profile was saved.',
  dispatchTitle: 'Assign orders and approve providers',
  pendingProviders: 'Service providers',
  noProviders: 'There are no provider accounts.',
  approve: 'Approve',
  rejectProvider: 'Reject approval',
  ordersToAssign: 'Orders',
  assign: 'Assign',
  noOrders: 'No orders.',
  approvedOnly: 'A provider appears here after approval, and only when they offer the order’s service.',
  companyOnly: 'This page is for a company account.',
  adminOnly: 'This page is for the platform admin.',
  providerOnly: 'This page is for a service provider.',
  accountTitle: 'Account details',
  accountHint: 'Edit the company name and the account owner. This form does not change role or permissions.',
  designNew: 'New design',
  upcoming: 'Nearest occasions',
  platformFollow: 'Platform monitoring',
  period: 'Time period',
  from: 'From',
  to: 'To',
  companyFilter: 'Company',
  allCompanies: 'All companies',
  searchCompany: 'Search by name',
  allCities: 'All cities',
  allOccasions: 'All occasions',
  resetFilters: 'Reset filters',
  registeredCompanies: 'Registered companies',
  savedRequests: 'Saved review requests',
  dailyAverage: 'Average daily orders',
  monitorLoading: 'Loading the monitoring board…',
  calendarTitle: 'Occasions and reminders',
  knowledgeTitle: 'Isolated documents, with search inside your company only',
  alertsTitle: 'Alerts',
  studioProduct: 'Product and text',
  studioPreview: 'Preview',
  occasionLoading: 'Loading calendar occasions…',
  selectedOccasion: 'Selected occasion',
  designLanguage: 'Language of the text on the design',
  brandTitle: 'Company profile and identity kit',
  status_saved: 'Saved',
  status_preparing: 'Being prepared',
  status_received: 'Received',
  status_assigned: 'Assigned',
  status_accepted: 'Accepted',
  status_rejected: 'Rejected',
  status_progress: 'In progress',
  status_done: 'Completed',
  status_cancelled: 'Cancelled',
  approval_pending: 'Waiting for approval',
  approval_approved: 'Approved',
  approval_rejected: 'Approval rejected',
  service_print: 'Printing',
  service_install: 'Installation',
  service_gifts: 'Gifts',
  service_signage: 'Signage',
  product_invite: 'Invitation cards',
  product_banner: 'Indoor banner',
  product_rollup: 'Roll-up',
  product_brochure: 'Brochure',
  product_bag: 'Bags',
  product_backdrop: 'Backdrops',
  product_card: 'Business cards',
  product_gift: 'Gift wrap',
  product_mug: 'Mugs',
  product_notebook: 'Notebooks',
  product_greeting: 'Greeting cards',
  product_poster: 'Posters',
  err_EMAIL_REQUIRED: 'Enter the email address.',
  err_PASSWORD_REQUIRED: 'Enter the password.',
  err_INVALID_CREDENTIALS: 'The email or password is incorrect.',
  err_INVALID_NAME: 'Enter a name between 2 and 80 characters.',
  err_INVALID_EMAIL: 'The email address is not valid.',
  err_WEAK_PASSWORD: 'The password must be at least 8 characters.',
  err_PASSWORD_MISMATCH: 'The password confirmation does not match.',
  err_EMAIL_TAKEN: 'This email is already registered. Log in instead of creating a new account.',
  err_FORBIDDEN: 'You do not have permission.',
  err_PROVIDER_PENDING: 'This provider account is not approved yet.',
  err_INVALID_TRANSITION: 'The order cannot move to that status.',
  err_SERVICE_MISMATCH: 'This provider does not offer the order’s service.',
  err_NOT_FOUND: 'That item was not found.',
  err_INVALID_SERVICE: 'Choose a service from the list.',
  err_ORDER_EXISTS: 'This order is already saved.',
  err_ROLE_FORBIDDEN: 'The registration form cannot choose a role.',
  err_LOGIN_FAILED: 'Could not log in.',
  err_REGISTER_FAILED: 'Could not create the account.',
}

export type MessageKey = keyof typeof ar | keyof typeof arExtra

const STATUS_KEY: Record<string, MessageKey> = {
  محفوظ: 'status_saved',
  'قيد التجهيز': 'status_preparing',
  مستلم: 'status_received',
  مسند: 'status_assigned',
  مقبول: 'status_accepted',
  مرفوض: 'status_rejected',
  'قيد التنفيذ': 'status_progress',
  مكتمل: 'status_done',
  ملغى: 'status_cancelled',
  ملغاة: 'status_cancelled',
  cancelled: 'status_cancelled',
}

const PRODUCT_KEY: Record<string, MessageKey> = {
  'prd-invite': 'product_invite',
  'prd-banner': 'product_banner',
  'prd-rollup': 'product_rollup',
  'prd-brochure': 'product_brochure',
  'prd-bag': 'product_bag',
  'prd-backdrop': 'product_backdrop',
  'prd-card': 'product_card',
  'prd-gift': 'product_gift',
  'prd-mug': 'product_mug',
  'prd-notebook': 'product_notebook',
  'prd-greeting': 'product_greeting',
  'prd-poster': 'product_poster',
}

const SERVICE_KEY: Record<string, MessageKey> = {
  print: 'service_print',
  install: 'service_install',
  gifts: 'service_gifts',
  signage: 'service_signage',
}

type I18nValue = {
  locale: Locale
  dir: 'rtl' | 'ltr'
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  statusLabel: (status: string) => string
  productLabel: (id: string, fallback: string) => string
  serviceLabel: (id: string) => string
  errorText: (code: string | null | undefined, fallback?: string | null) => string
  formatNumber: (value: number) => string
  formatDate: (iso: string) => string
  formatMoney: (value: number) => string
  formatDateTime: (iso: string) => string
  formatPercent: (ratio: number) => string
  monthTitle: (year: number, month: number) => string
  weekdayLabels: () => string[]
  monthNames: () => string[]
  cityLabel: (label: string) => string
  occasionLabel: (key: string | null | undefined, fallback: string) => string
  failureLabel: (code: string | null | undefined) => string
  countText: (base: 'daysLeft' | 'unreadAlerts' | 'ntfBody' | 'newInPeriod', count: number) => string
  formatDuration: (value: number | null) => string
}

const I18nContext = createContext<I18nValue | null>(null)
const STORAGE_KEY = 'anjz-locale'

function readLocale(): Locale {
  try {
    return localeFromStored(localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'ar'
  }
}

function fill(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale)
  const setLocale = (next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* keep the in-memory choice */
    }
  }
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.title = locale === 'ar' ? 'طباعة ذكية — أنجز' : 'Smart print — Anjez'
  }, [locale])
  const value = useMemo<I18nValue>(() => {
    const messages: Record<MessageKey, string> = locale === 'ar' ? { ...ar, ...arExtra } : { ...en, ...enExtra }
    const tag = locale === 'ar' ? 'ar' : 'en-GB'
    const t = (key: MessageKey, vars?: Record<string, string | number>) => fill(messages[key], vars)
    const countText = (base: 'daysLeft' | 'unreadAlerts' | 'ntfBody' | 'newInPeriod', count: number) => {
      const category = pluralCategory(locale, count)
      const suffix = category === 'one' ? 'One' : category === 'two' ? 'Two' : category === 'few' ? 'Few' : category === 'many' ? 'Many' : ''
      const key = `${base}${suffix}` as MessageKey
      return fill(messages[key] || messages[base as MessageKey], { count })
    }
    return {
      locale,
      dir: locale === 'ar' ? 'rtl' : 'ltr',
      setLocale,
      t,
      statusLabel: (status) => {
        const key = STATUS_KEY[status]
        return key ? messages[key] : status
      },
      productLabel: (id, fallback) => {
        const key = PRODUCT_KEY[id]
        return key ? messages[key] : fallback
      },
      serviceLabel: (id) => {
        const key = SERVICE_KEY[id]
        return key ? messages[key] : id
      },
      errorText: (code, fallback) => {
        const key = code ? `err_${code}` : ''
        if (key && key in messages) return messages[key as MessageKey]
        return fallback || messages.err_LOGIN_FAILED
      },
      formatNumber: (value) => new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(value),
      formatDate: (iso) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(new Date(`${iso.slice(0, 10)}T12:00:00+03:00`)),
      formatMoney: (value) => new Intl.NumberFormat(tag, {
        style: 'currency',
        currency: 'SAR',
        maximumFractionDigits: value % 1 === 0 ? 0 : 1,
      }).format(value),
      formatDateTime: (iso) => new Intl.DateTimeFormat(tag, { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)),
      formatPercent: (ratio) => new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 0 }).format(ratio),
      monthTitle: (year, month) => new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(new Date(Date.UTC(year, month - 1, 1, 12))),
      weekdayLabels: () => Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + index)))),
      monthNames: () => Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1)))),
      cityLabel: (label) => {
        if (!label || label === 'غير محدد') return messages.unspecified
        if (label === 'مدن أخرى') return messages.otherCities
        return localizedCityName(label, locale)
      },
      occasionLabel: (key, fallback) => {
        if (!key) return fallback
        const messageKey = `occasion_${key.replace(/-/g, '_')}` as MessageKey
        return messages[messageKey] || fallback
      },
      failureLabel: (code) => {
        const map: Record<string, MessageKey> = {
          QUOTA: 'failQuota',
          TIMEOUT: 'failTimeout',
          INVALID_OUTPUT: 'failInvalidOutput',
          IMAGE_RATE_LIMITED: 'failImageRate',
          COMPOSE_RATE_LIMIT: 'failComposeRate',
          FAILED: 'failGeneric',
          INVALID: 'failInvalid',
        }
        return messages[map[code || ''] || 'failGeneric']
      },
      countText,
      formatDuration: (value) => {
        if (value === null) return messages.unavailable
        const amount = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(value >= 1000 ? value / 1000 : value)
        return `${amount} ${value >= 1000 ? messages.seconds : messages.ms}`
      },
    }
  }, [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
