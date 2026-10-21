import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchBrandLogoObjectUrl } from './brandLogo'
import { defaultBrand, events, products } from './data'
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
  eventId: events[0].id,
  headline: defaultBrand.companyName,
  subhead: events[0].title,
  body: defaultBrand.slogan,
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<CompanyBrand>(() =>
    readJson(BRAND_KEY, defaultBrand),
  )
  const [draft, setDraftState] = useState<DesignDraft>(() =>
    readJson(DRAFT_KEY, initialDraft),
  )
  const [orders, setOrders] = useState<PrintOrder[]>(() =>
    readJson(ORDERS_KEY, []),
  )

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/brand', { credentials: 'include' })
      if (!response.ok) return
      const payload = await response.json()
      if (!payload?.brand) return
      const logoUrl = payload.brand.logoPath ? await fetchBrandLogoObjectUrl() : null
      const next: CompanyBrand = {
        companyName: payload.brand.companyName,
        industry: payload.brand.industry,
        contactName: payload.brand.contactName,
        email: payload.brand.email,
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
  }, [])

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
          status: 'مستلم',
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
