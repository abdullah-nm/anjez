import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { useI18n, type MessageKey } from '../i18n'

const steps = [
  { id: 1, label: 'stepProduct' as const, to: '/studio' },
  { id: 2, label: 'stepText' as const, to: '/studio' },
  { id: 3, label: 'stepPreview' as const, to: '/studio' },
  { id: 4, label: 'stepOrder' as const, to: '/order' },
]

const companyLinks: { to: string, label: MessageKey }[] = [
  { to: '/home', label: 'navHome' },
  { to: '/brand', label: 'navBrand' },
  { to: '/calendar', label: 'navCalendar' },
  { to: '/knowledge', label: 'navKnowledge' },
]

export function Layout() {
  const { user, logout } = useAuth()
  const { t, locale, setLocale } = useI18n()
  const location = useLocation()
  const [unread, setUnread] = useState(0)
  const [studioStep, setStudioStep] = useState('1')
  const path = location.pathname
  const companyUser = user && user.role !== 'provider'
  const showSteps = Boolean(companyUser) && (path.startsWith('/studio') || path.startsWith('/order') || path.startsWith('/home'))
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
        <NavLink to="/" end className="brand-mark" aria-label={t('brand')}>
          <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="6" y="5" width="14" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 23h12a2 2 0 0 0 2-2V9" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className="product-name">{t('brand')}</span>
        </NavLink>
        <div className="session-chip">
          <nav className="nav" aria-label={t('navOther')}>
            {companyUser && companyLinks.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                {t(link.label)}
              </NavLink>
            ))}
            {companyUser && <NavLink className="nav-link" to="/notifications">{t('navAlerts')}{unread ? ` (${unread})` : ''}</NavLink>}
            {user?.role === 'admin' && <NavLink className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} to="/monitor">{t('navMonitor')}</NavLink>}
            {user?.role === 'admin' && <NavLink className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} to="/dispatch">{t('navDispatch')}</NavLink>}
            {user?.role === 'provider' && <NavLink className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} to="/provider">{t('navProvider')}</NavLink>}
          </nav>
          <button type="button" className="btn btn-ghost lang-toggle" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{t('language')}</button>
          {user ? (
            <>
              <span>{user.name}</span>
              <button type="button" className="btn btn-ghost session-logout" onClick={() => void logout()}>{t('logout')}</button>
            </>
          ) : (
            <>
              <NavLink className="btn btn-secondary nav-cta" to="/register">{t('registerCompany')}</NavLink>
              <NavLink className="btn btn-primary nav-cta" to="/login" state={{ from: location.pathname }}>{t('login')}</NavLink>
            </>
          )}
        </div>
      </header>
      {showSteps && (
        <div className="steps-wrap">
          <p className="steps-caption">{current ? t('stepCaption', { current }) : t('stepsLabel')}</p>
          <ol className="steps" aria-label={t('stepsLabel')}>
            {steps.map((step, index) => (
              <li key={step.id} className="step-item">
                {index > 0 && <span className={step.id <= current ? 'step-line done' : 'step-line'} aria-hidden="true" />}
                <Link
                  to={step.to}
                  className={step.id === current ? 'step current' : step.id < current ? 'step done' : 'step'}
                  aria-current={step.id === current ? 'step' : undefined}
                >
                  <span className="step-index">{step.id}</span>
                  <span>{t(step.label)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
      <main className={path === '/monitor' ? 'page dash-page' : 'page'}>
        <Outlet />
      </main>
    </div>
  )
}
