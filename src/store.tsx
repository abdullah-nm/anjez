import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './auth'
import { fetchBrandLogoObjectUrl } from './brandLogo'
import { defaultBrand, products } from './data'
import type { CompanyBrand, DesignDraft, PrintOrder } from './types'

const BRAND_KEY = 'anjz-brand'
const ORDERS_KEY = 'anjz-orders'
const DRAFT_KEY = 'anjz-draft'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const initialDraft: DesignDraft = {
  productId: products[0].id,
  eventId: '',
  headline: '',
  subhead: '',
  body: '',
  size: products[0].sizes[0],
}

interface AppStore {
  brand: CompanyBrand
  saveBrand: (next: CompanyBrand) => boolean
  draft: DesignDraft
  setDraft: (next: DesignDraft) => void
  orders: PrintOrder[]
  placeOrder: (order: Omit<PrintOrder, 'id' | 'createdAt' | 'status'>) => PrintOrder | null
}

const StoreContext = createContext<AppStore | null>(null)

function brandFromSession(user: { name: string; email: string; companyName: string }, stored: Partial<CompanyBrand> = {}): CompanyBrand {
  return {
    ...defaultBrand,
    ...stored,
    companyName: user.companyName,
    contactName: user.name,
    email: user.email,
    phone: stored.phone || '',
    city: stored.city || '',
    slogan: stored.slogan || '',
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const seenUser = useRef(false)
  const [brand, setBrand] = useState<CompanyBrand>(() => {
    const stored = readJson<Partial<CompanyBrand>>(BRAND_KEY, {})
    return {
      ...defaultBrand,
      ...stored,
      companyName: stored.companyName || '',
      contactName: stored.contactName || '',
      email: stored.email || '',
      phone: stored.phone || '',
      city: stored.city || '',
      slogan: stored.slogan || '',
    }
  })
  const [draft, setDraftState] = useState<DesignDraft>(() => {
    const stored = readJson(DRAFT_KEY, initialDraft)
    return {
      ...initialDraft,
      ...stored,
      headline: stored.headline || '',
      subhead: '',
      body: '',
    }
  })
  const [orders, setOrders] = useState<PrintOrder[]>(() =>
    readJson(ORDERS_KEY, []),
  )

  useEffect(() => {
    if (user) seenUser.current = true
    if (loading || user || !seenUser.current) return
    setBrand({ ...defaultBrand })
    setDraftState(initialDraft)
    setOrders([])
    seenUser.current = false
  }, [user, loading])

  useEffect(() => {
    if (!user) return
    setBrand((current) => brandFromSession(user, current))
    void (async () => {
      const response = await fetch('/api/brand', { credentials: 'include' })
      if (!response.ok) return
      const payload = await response.json()
      if (!payload?.brand) return
      const logoUrl = payload.brand.logoPath ? await fetchBrandLogoObjectUrl() : null
      const next: CompanyBrand = {
        companyName: payload.brand.companyName || user.companyName,
        industry: payload.brand.industry,
        contactName: payload.brand.contactName || user.name,
        email: payload.brand.email || user.email,
        phone: payload.brand.phone,
        city: payload.brand.city,
        primaryColor: payload.brand.primaryColor,
        accentColor: payload.brand.accentColor,
        slogan: payload.brand.slogan,
        tone: payload.brand.tone || 'فاخر',
        logoUrl,
      }
      setBrand(next)
      try {
        localStorage.setItem(
          BRAND_KEY,
          JSON.stringify({ ...next, logoUrl: payload.brand.logoPath ? '/api/brand/logo' : null }),
        )
      } catch {
        /* ignore quota */
      }
    })().catch(() => undefined)
  }, [user])

  const value = useMemo<AppStore>(
    () => ({
      brand,
      saveBrand: (next) => {
        try {
          localStorage.setItem(BRAND_KEY, JSON.stringify(next))
          setBrand(next)
          return true
        } catch {
          return false
        }
      },
      draft,
      setDraft: (next) => {
        setDraftState(next)
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify(next))
        } catch {
          /* keep memory copy even if storage is full */
        }
      },
      orders,
      placeOrder: (input) => {
        const order: PrintOrder = {
          ...input,
          id: `ORD-${Date.now().toString().slice(-6)}`,
          createdAt: new Date().toISOString(),
          status: 'محفوظ',
        }
        try {
          const next = [order, ...orders]
          localStorage.setItem(ORDERS_KEY, JSON.stringify(next))
          setOrders(next)
          return order
        } catch {
          return null
        }
      },
    }),
    [brand, draft, orders],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
