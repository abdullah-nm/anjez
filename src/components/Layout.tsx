import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth'
import { useStore } from '../store'

const links = [
  { to: '/', label: 'لوحة الشركة' },
  { to: '/studio', label: 'استوديو التصميم' },
  { to: '/brand', label: 'هوية الشركة' },
  { to: '/calendar', label: 'التقويم' },
  { to: '/order', label: 'طلب طباعة' },
  { to: '/knowledge', label: 'معرفة الشركة' },
]

export function Layout() {
  const { brand, orders } = useStore()
  const { user, logout } = useAuth()
  const [unread, setUnread] = useState(0)
  const companyLabel = user?.companyName || brand.companyName

  useEffect(() => {
    if (!user) return
    void fetch('/api/notifications', { credentials: 'include' })
      .then((r) => r.json())
      .then((payload) => setUnread(payload.unread || 0))
  }, [user])

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-mark">
          <span className="logo-mark" aria-hidden="true">
            أ
          </span>
          <div>
            <p className="product-name">طباعة ذكية</p>
            <p className="product-sub">منصة أنجز · {companyLabel}</p>
          </div>
        </div>
        <nav className="nav" aria-label="التنقل الرئيسي">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="session-chip">
          {user ? (
            <>
              <NavLink className="nav-link" to="/notifications">تنبيهات{unread ? ` (${unread})` : ''}</NavLink>
              <span>{user.name}</span>
              <button type="button" className="btn btn-ghost session-logout" onClick={() => void logout()}>
                خروج
              </button>
            </>
          ) : (
            <NavLink className="nav-link" to="/login">
              دخول المعرفة
            </NavLink>
          )}
          <p className="orders-chip">
            {orders.length > 0 ? `${orders.length} طلب محفوظ` : 'لا طلبات بعد'}
          </p>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
