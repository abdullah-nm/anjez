import { type FormEvent, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

export function Login() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const redirectTo = (location.state as { from?: string } | null)?.from || '/studio'

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
        <h1>دخول</h1>
      </div>
      <label className="field">
        <span>البريد</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </label>
      <label className="field">
        <span>كلمة المرور</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </label>
      <button type="submit" className="btn btn-primary">
        دخول
      </button>
      {error && <p className="notice err">{error}</p>}
    </form>
  )
}
