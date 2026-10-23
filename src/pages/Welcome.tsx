import { Link } from 'react-router-dom'
import { useAuth } from '../auth'

export function Welcome() {
  const { user, loading } = useAuth()

  return (
    <section className="welcome">
      <svg className="welcome-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="6" y="5" width="14" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 23h12a2 2 0 0 0 2-2V9" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <h1>أنجز</h1>
      <p>{user ? `مرحباً ${user.name}` : 'تصميم مطبوع'}</p>
      {loading ? null : user ? (
        <Link className="btn btn-primary" to="/studio">ابدأ</Link>
      ) : (
        <span className="welcome-actions">
          <Link className="btn btn-primary" to="/login">تسجيل الدخول</Link>
          <Link className="btn btn-secondary" to="/register">إنشاء حساب شركة جديدة</Link>
        </span>
      )}
    </section>
  )
}
