import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { homeFor } from '../home'
import { useI18n } from '../i18n'

export function Welcome() {
  const { user, loading } = useAuth()
  const { t } = useI18n()

  return (
    <section className="welcome">
      <svg className="welcome-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="6" y="5" width="14" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 23h12a2 2 0 0 0 2-2V9" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <h1>{t('brand')}</h1>
      <p>{user ? t('welcomeHello', { name: user.name }) : t('welcomeGuest')}</p>
      {loading ? null : user ? (
        <Link className="btn btn-primary" to={homeFor(user.role)}>{t('start')}</Link>
      ) : (
        <span className="welcome-actions">
          <Link className="btn btn-primary" to="/login">{t('login')}</Link>
          <Link className="btn btn-secondary" to="/register">{t('newCompany')}</Link>
          <Link className="btn btn-ghost" to="/register/provider">{t('registerProvider')}</Link>
        </span>
      )}
    </section>
  )
}
