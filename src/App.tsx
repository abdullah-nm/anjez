import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { Layout } from './components/Layout'
import { Brand } from './pages/Brand'
import { Confirmation } from './pages/Confirmation'
import { Dashboard } from './pages/Dashboard'
import { CalendarPage } from './pages/Calendar'
import { Knowledge } from './pages/Knowledge'
import { Login } from './pages/Login'
import { NotificationsPage } from './pages/Notifications'
import { Order } from './pages/Order'
import { Studio } from './pages/Studio'
import { Welcome } from './pages/Welcome'
import { StoreProvider } from './store'

function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <p>جارٍ التحميل…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
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
              <Route element={<RequireAuth />}>
                <Route path="/home" element={<Dashboard />} />
                <Route path="/studio" element={<Studio />} />
                <Route path="/brand" element={<Brand />} />
                <Route path="/order" element={<Order />} />
                <Route path="/order/:orderId" element={<Confirmation />} />
                <Route path="/knowledge" element={<Knowledge />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </StoreProvider>
    </AuthProvider>
  )
}
