import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
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
