import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth, type SessionUser } from './auth'
import { Layout } from './components/Layout'
import { homeFor } from './home'
import { useI18n } from './i18n'
import { Brand } from './pages/Brand'
import { Confirmation } from './pages/Confirmation'
import { Dashboard } from './pages/Dashboard'
import { CalendarPage } from './pages/Calendar'
import { Dispatch } from './pages/Dispatch'
import { Knowledge } from './pages/Knowledge'
import { Monitor } from './pages/Monitor'
import { Login } from './pages/Login'
import { NotificationsPage } from './pages/Notifications'
import { Order } from './pages/Order'
import { ProviderDesk } from './pages/ProviderDesk'
import { Studio } from './pages/Studio'
import { Welcome } from './pages/Welcome'
import { StoreProvider } from './store'

function RequireAuth() {
  const { user, loading } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  if (loading) return <p>{t('loading')}</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

function Allow({ roles }: { roles: SessionUser['role'][] }) {
  const { user } = useAuth()
  if (!user) return null
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return <Outlet />
}

export default function App() {
  return (
    <AuthProvider>
      <StoreProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Welcome />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Login />} />
              <Route path="/register/provider" element={<Login />} />
              <Route element={<RequireAuth />}>
                <Route element={<Allow roles={['admin', 'member']} />}>
                  <Route path="/home" element={<Dashboard />} />
                  <Route path="/studio" element={<Studio />} />
                  <Route path="/brand" element={<Brand />} />
                  <Route path="/order" element={<Order />} />
                  <Route path="/order/:orderId" element={<Confirmation />} />
                  <Route path="/knowledge" element={<Knowledge />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                </Route>
                <Route element={<Allow roles={['admin']} />}>
                  <Route path="/monitor" element={<Monitor />} />
                  <Route path="/dispatch" element={<Dispatch />} />
                </Route>
                <Route element={<Allow roles={['provider']} />}>
                  <Route path="/provider" element={<ProviderDesk />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </StoreProvider>
    </AuthProvider>
  )
}
