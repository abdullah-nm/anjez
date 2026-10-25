import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type SessionUser = {
  id: string
  email: string
  name: string
  companyId: string
  companyName: string
  role: 'admin' | 'member' | 'provider'
}

export type RagStatus = {
  embeddingsConfigured: boolean
  llmConfigured: boolean
  imageConfigured: boolean
  imageModel: string
  geminiConfigured?: boolean
  embeddingModel: string
  llmModel: string
  vectorBackend: string
  missing: string[]
}

type AuthContextValue = {
  user: SessionUser | null
  rag: RagStatus | null
  loading: boolean
  login: (email: string, password: string) => Promise<string | null>
  register: (input: { companyName: string, email: string, password: string, confirm: string }) => Promise<string | null>
  registerProvider: (input: { kind: 'shop' | 'individual', displayName: string, city: string, phone: string, services: string[], email: string, password: string, confirm: string }) => Promise<string | null>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function readJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [rag, setRag] = useState<RagStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const response = await fetch('/api/session', { credentials: 'include' })
    const payload = await readJson(response)
    setUser(payload?.user ?? null)
    setRag(payload?.rag ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const payload = await readJson(response)
    if (!response.ok) return payload?.code || payload?.error || 'LOGIN_FAILED'
    setUser(payload.user)
    if (payload.rag) setRag(payload.rag)
    return null
  }, [])

  const register = useCallback(async (input: { companyName: string, email: string, password: string, confirm: string }) => {
    const response = await fetch('/api/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const payload = await readJson(response)
    if (!response.ok) return payload?.code || payload?.error || 'REGISTER_FAILED'
    setUser(payload.user)
    if (payload.rag) setRag(payload.rag)
    return null
  }, [])

  const registerProvider = useCallback(async (input: { kind: 'shop' | 'individual', displayName: string, city: string, phone: string, services: string[], email: string, password: string, confirm: string }) => {
    const response = await fetch('/api/register/provider', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const payload = await readJson(response)
    if (!response.ok) return payload?.code || payload?.error || 'REGISTER_FAILED'
    setUser(payload.user)
    if (payload.rag) setRag(payload.rag)
    return null
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' })
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, rag, loading, login, register, registerProvider, logout, refresh }),
    [user, rag, loading, login, register, registerProvider, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
