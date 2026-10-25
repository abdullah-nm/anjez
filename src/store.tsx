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
  placeOrder: (order: Omit<PrintOrder, 'id' | 'createdAt' | 'status'> & { designId?: string }) => Promise<PrintOrder | null>
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
  const [brand, setBrand] = useState<CompanyBrand>({
    ...defaultBrand,
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    city: '',
    slogan: '',
  })
  const [draft, setDraftState] = useState<DesignDraft>(initialDraft)
  const [orders, setOrders] = useState<PrintOrder[]>([])

  useEffect(() => {
    if (loading) return
    if (!user) {
      if (!seenUser.current) return
      setBrand({ ...defaultBrand, companyName: '', contactName: '', email: '', phone: '', city: '', slogan: '' })
      setDraftState(initialDraft)
      setOrders([])
      seenUser.current = false
      return
    }
    seenUser.current = true
    const storedDraft = readJson(`${DRAFT_KEY}:${user.id}`, initialDraft)
    setDraftState({ ...initialDraft, ...storedDraft, headline: storedDraft.headline || '', subhead: '', body: '' })
    const localOrders = readJson<PrintOrder[]>(`${ORDERS_KEY}:${user.id}`, [])
    setOrders(localOrders)
    const storedBrand = readJson<Partial<CompanyBrand>>(`${BRAND_KEY}:${user.id}`, {})
    setBrand(brandFromSession(user, storedBrand))
    void (async () => {
      const response = await fetch('/api/brand', { credentials: 'include' })
      const payload = response.ok ? await response.json() : null
      if (payload?.brand) {
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
            `${BRAND_KEY}:${user.id}`,
            JSON.stringify({ ...next, logoUrl: payload.brand.logoPath ? '/api/brand/logo' : null }),
          )
        } catch {
          /* ignore quota */
        }
      }
      const ordersResponse = await fetch('/api/orders', { credentials: 'include' })
      if (ordersResponse.ok) {
        const ordersPayload = await ordersResponse.json()
        const remote = Array.isArray(ordersPayload?.orders) ? ordersPayload.orders as Partial<PrintOrder>[] : []
        setOrders((current) => {
          const merged = new Map(current.map((order) => [order.id, order]))
          for (const order of remote) {
            if (!order.id) continue
            const existing = merged.get(order.id)
            merged.set(order.id, {
              id: order.id,
              createdAt: order.createdAt || existing?.createdAt || new Date().toISOString(),
              productId: order.productId || existing?.productId || '',
              eventId: existing?.eventId || order.eventId || '',
              size: existing?.size || order.size || '',
              quantity: order.quantity || existing?.quantity || 1,
              deliveryDate: order.deliveryDate || existing?.deliveryDate || '',
              address: existing?.address || order.address || '',
              deliveryCity: order.deliveryCity || existing?.deliveryCity || '',
              notes: existing?.notes || order.notes || '',
              headline: existing?.headline || order.headline || '',
              subhead: existing?.subhead || order.subhead || '',
              body: existing?.body || order.body || '',
              eventTitle: existing?.eventTitle,
              status: order.status || existing?.status || 'محفوظ',
              providerName: order.providerName || '',
              statusNote: order.statusNote || '',
              events: order.events || [],
            })
          }
          const next = [...merged.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          try {
            localStorage.setItem(`${ORDERS_KEY}:${user.id}`, JSON.stringify(next))
          } catch {
            /* keep the memory copy */
          }
          return next
        })
      }
    })().catch(() => undefined)
  }, [user, loading])

  const value = useMemo<AppStore>(
    () => ({
      brand,
      saveBrand: (next) => {
        if (!user) return false
        try {
          localStorage.setItem(`${BRAND_KEY}:${user.id}`, JSON.stringify(next))
          setBrand(next)
          return true
        } catch {
          return false
        }
      },
      draft,
      setDraft: (next) => {
        setDraftState(next)
        if (!user) return
        try {
          localStorage.setItem(`${DRAFT_KEY}:${user.id}`, JSON.stringify(next))
        } catch {
          /* keep memory copy even if storage is full */
        }
      },
      orders,
      placeOrder: async (input) => {
        if (!user || user.role === 'provider') return null
        const { designId, ...rest } = input
        const order: PrintOrder = {
          ...rest,
          id: `ORD-${Date.now().toString().slice(-6)}`,
          createdAt: new Date().toISOString(),
          status: 'محفوظ',
        }
        const response = await fetch('/api/orders', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: order.id,
            productId: order.productId,
            quantity: order.quantity,
            deliveryDate: order.deliveryDate,
            deliveryCity: order.deliveryCity || '',
            designId: designId ?? null,
          }),
        }).catch(() => null)
        if (!response?.ok) return null
        const next = [order, ...orders]
        setOrders(next)
        try {
          localStorage.setItem(`${ORDERS_KEY}:${user.id}`, JSON.stringify(next))
        } catch {
          /* the server copy is the source of truth */
        }
        return order
      },
    }),
    [brand, draft, orders, user],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
