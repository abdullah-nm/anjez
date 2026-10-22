import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

const steps = [
  { id: 1, label: 'المنتج', to: '/studio' },
  { id: 2, label: 'النص', to: '/studio' },
  { id: 3, label: 'المعاينة', to: '/studio' },
  { id: 4, label: 'الطلب', to: '/order' },
]

const links = [
  { to: '/home', label: 'اللوحة' },
  { to: '/brand', label: 'الهوية' },
  { to: '/calendar', label: 'التقويم' },
  { to: '/knowledge', label: 'المعرفة' },
]

export function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [unread, setUnread] = useState(0)
  const [studioStep, setStudioStep] = useState('1')
  const path = location.pathname
  const showSteps = path.startsWith('/studio') || path.startsWith('/order') || path.startsWith('/home')
  const current = path.startsWith('/order') ? 4 : path.startsWith('/studio') ? Number(studioStep) || 1 : 0

  useEffect(() => {
    const sync = () => setStudioStep(sessionStorage.getItem('anjz-step') || '1')
    sync()
    window.addEventListener('anjz-step', sync)
    return () => window.removeEventListener('anjz-step', sync)
  }, [path])

  useEffect(() => {
    if (!user) return
    void fetch('/api/notifications', { credentials: 'include' })
      .then((r) => r.json())
      .then((payload) => setUnread(payload.unread || 0))
  }, [user])

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" end className="brand-mark" aria-label="أنجز">
          <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="6" y="5" width="14" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 23h12a2 2 0 0 0 2-2V9" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className="product-name">أنجز</span>
        </NavLink>
        <div className="session-chip">
          <nav className="nav" aria-label="صفحات أخرى">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {link.label}
              </NavLink>
            ))}
            {user && <NavLink className="nav-link" to="/notifications">تنبيهات{unread ? ` (${unread})` : ''}</NavLink>}
            {user?.role === 'admin' && <NavLink className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} to="/monitor">المراقبة</NavLink>}
          </nav>
          {user ? (
            <>
              <span>{user.name}</span>
              <button type="button" className="btn btn-ghost session-logout" onClick={() => void logout()}>خروج</button>
            </>
          ) : (
            <NavLink className="btn btn-primary nav-cta" to="/login" state={{ from: location.pathname }}>دخول</NavLink>
          )}
        </div>
      </header>
      {showSteps && (
        <div className="steps-wrap">
          <p className="steps-caption">{current ? `الخطوة ${current} من ٤` : 'الخطوات'}</p>
          <ol className="steps" aria-label="خطوات التصميم">
            {steps.map((step, index) => (
              <li key={step.id} className="step-item">
                {index > 0 && <span className={step.id <= current ? 'step-line done' : 'step-line'} aria-hidden="true" />}
                <Link
                  to={step.to}
                  className={step.id === current ? 'step current' : step.id < current ? 'step done' : 'step'}
                  aria-current={step.id === current ? 'step' : undefined}
                >
                  <span className="step-index">{step.id}</span>
                  <span>{step.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
