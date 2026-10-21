import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth'
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
import { StoreProvider } from './store'

export default function App() {
  return (
    <AuthProvider>
      <StoreProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/brand" element={<Brand />} />
              <Route path="/order" element={<Order />} />
              <Route path="/order/:orderId" element={<Confirmation />} />
              <Route path="/knowledge" element={<Knowledge />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </StoreProvider>
    </AuthProvider>
  )
}
