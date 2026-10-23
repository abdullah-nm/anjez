import { type FormEvent, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

export function Login() {
  const { user, login, register } = useAuth()
  const location = useLocation()
  const registerMode = location.pathname === '/register' || new URLSearchParams(location.search).get('mode') === 'register'
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const redirectTo = (location.state as { from?: string } | null)?.from || '/studio'

  if (user) return <Navigate to={redirectTo} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    if (registerMode) {
      if (companyName.trim().length < 2) {
        setError('أدخل اسم الشركة بين حرفين وثمانين حرفًا.')
        return
      }
      if (!email.trim()) {
        setError('أدخل البريد الإلكتروني.')
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError('البريد الإلكتروني غير صالح.')
        return
      }
      if (!password) {
        setError('أدخل كلمة المرور.')
        return
      }
      if (password.length < 8) {
        setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.')
        return
      }
      if (password !== confirm) {
        setError('تأكيد كلمة المرور غير مطابق.')
        return
      }
    } else {
      if (!email.trim()) {
        setError('أدخل البريد الإلكتروني.')
        return
      }
      if (!password) {
        setError('أدخل كلمة المرور.')
        return
      }
    }
    setSubmitting(true)
    const message = registerMode
      ? await register({ companyName, email, password, confirm })
      : await login(email, password)
    setSubmitting(false)
    if (message) setError(message)
  }

  return (
    <form className="stack form-narrow" onSubmit={onSubmit} autoComplete="on" noValidate>
      <div className="section-head">
        <h1>{registerMode ? 'إنشاء حساب شركة جديدة' : 'تسجيل الدخول'}</h1>
        <p className="muted">
          {registerMode
            ? 'للشركة التي لم تسجّل سابقًا. الحساب يُحفظ ويمكن الدخول إليه لاحقًا بنفس البريد وكلمة المرور.'
            : 'للشركة التي لديها حساب بالفعل. لن يُنشأ حساب جديد عند الدخول.'}
        </p>
      </div>
      {registerMode && (
        <label className="field" htmlFor="company-name">
          <span>اسم الشركة</span>
          <input id="company-name" name="organization" value={companyName} onChange={(event) => setCompanyName(event.target.value)} autoComplete="organization" required />
        </label>
      )}
      <label className="field" htmlFor="account-email">
        <span>البريد الإلكتروني</span>
        <input id="account-email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" type="email" inputMode="email" required />
      </label>
      <label className="field" htmlFor="account-password">
        <span>كلمة المرور</span>
        <input id="account-password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={registerMode ? 'new-password' : 'current-password'} required />
      </label>
      {registerMode && (
        <label className="field" htmlFor="account-confirm">
          <span>تأكيد كلمة المرور</span>
          <input id="account-confirm" name="confirm-password" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
        </label>
      )}
      <button type="submit" className="btn btn-primary" disabled={submitting} aria-busy={submitting}>
        {submitting ? 'جارٍ الحفظ…' : registerMode ? 'إنشاء حساب الشركة' : 'تسجيل الدخول'}
      </button>
      {registerMode ? (
        <Link className="btn btn-secondary" to="/login">لدي حساب شركة؟ تسجيل الدخول</Link>
      ) : (
        <Link className="btn btn-secondary" to="/register">إنشاء حساب شركة جديدة</Link>
      )}
      {error && <p className="notice err" role="alert">{error}</p>}
    </form>
  )
}
