import { type FormEvent, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

export function Login() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('sara@nebras.sa')
  const [password, setPassword] = useState('AnjzDemo!26')
  const [error, setError] = useState<string | null>(null)
  const redirectTo = (location.state as { from?: string } | null)?.from || '/knowledge'

  if (user) return <Navigate to={redirectTo} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const message = await login(email, password)
    if (message) setError(message)
  }

  return (
    <form className="stack form-narrow" onSubmit={onSubmit}>
      <div className="section-head">
        <p className="eyebrow">دخول الشركات</p>
        <h1>جلسة موثّقة لكل شركة قبل استخدام المعرفة</h1>
      </div>
      <p className="lede">
        هوية الشركة تُؤخذ من الجلسة على الخادم، وليس من المتصفح. حسابان تجريبيان
        معزولان:
      </p>
      <ul className="order-mini">
        <li>نبراس (إدارة): sara@nebras.sa</li>
        <li>نبراس (عضو): lina@nebras.sa — يسأل ولا يرفع</li>
        <li>قمم (إدارة): fahd@qimam.sa</li>
        <li>كلمة المرور: AnjzDemo!26</li>
      </ul>
      <label className="field">
        <span>البريد</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span>كلمة المرور</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <button type="submit" className="btn btn-primary">
        دخول
      </button>
      {error && <p className="notice err">{error}</p>}
    </form>
  )
}
