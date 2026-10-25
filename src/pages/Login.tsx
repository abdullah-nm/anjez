import { type FormEvent, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { homeFor } from '../home'
import { useI18n } from '../i18n'

const SERVICE_IDS = ['print', 'install', 'gifts', 'signage'] as const

export function Login() {
  const { user, login, register, registerProvider } = useAuth()
  const { t, errorText } = useI18n()
  const location = useLocation()
  const providerMode = location.pathname === '/register/provider'
  const registerMode = location.pathname === '/register' || providerMode || new URLSearchParams(location.search).get('mode') === 'register'
  const [companyName, setCompanyName] = useState('')
  const [kind, setKind] = useState<'shop' | 'individual'>('shop')
  const [city, setCity] = useState('')
  const [phone, setPhone] = useState('')
  const [services, setServices] = useState<string[]>(['print'])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const requested = (location.state as { from?: string } | null)?.from

  if (user) return <Navigate to={requested && user.role !== 'provider' ? requested : homeFor(user.role)} replace />

  function toggleService(id: string) {
    setServices((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    const field = (name: string) => {
      const element = event.currentTarget.elements.namedItem(name)
      return element instanceof HTMLInputElement ? element.value : ''
    }
    const emailValue = (email || field('email')).trim()
    const passwordValue = password || field('password')
    const confirmed = confirm || field('confirm-password')
    const companyValue = (companyName || field('organization')).trim()
    const nameValue = (companyName || field('display-name')).trim()
    if (registerMode) {
      if (nameValue.length < 2) {
        setError(errorText('INVALID_NAME'))
        return
      }
      if (providerMode && (city.trim().length < 2 || phone.trim().length < 5 || services.length === 0)) {
        setError(errorText('INVALID_SERVICE'))
        return
      }
      if (!emailValue) {
        setError(errorText('EMAIL_REQUIRED'))
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
        setError(errorText('INVALID_EMAIL'))
        return
      }
      if (!passwordValue) {
        setError(errorText('PASSWORD_REQUIRED'))
        return
      }
      if (passwordValue.length < 8) {
        setError(errorText('WEAK_PASSWORD'))
        return
      }
      if (passwordValue !== confirmed) {
        setError(errorText('PASSWORD_MISMATCH'))
        return
      }
    } else {
      if (!emailValue) {
        setError(errorText('EMAIL_REQUIRED'))
        return
      }
      if (!passwordValue) {
        setError(errorText('PASSWORD_REQUIRED'))
        return
      }
    }
    setSubmitting(true)
    const message = providerMode
      ? await registerProvider({ kind, displayName: nameValue, city: city.trim(), phone: phone.trim(), services, email: emailValue, password: passwordValue, confirm: confirmed })
      : registerMode
        ? await register({ companyName: companyValue, email: emailValue, password: passwordValue, confirm: confirmed })
        : await login(emailValue, passwordValue)
    setSubmitting(false)
    if (message) setError(errorText(message, message))
  }

  return (
    <form className="stack form-narrow" onSubmit={onSubmit} autoComplete="on" noValidate>
      <div className="section-head">
        <h1>{providerMode ? t('providerTitle') : registerMode ? t('registerTitle') : t('loginTitle')}</h1>
        <p className="muted">{providerMode ? t('providerHint') : registerMode ? t('registerHint') : t('loginHint')}</p>
      </div>
      {providerMode && (
        <>
          <label className="field">
            <span>{t('providerKind')}</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as 'shop' | 'individual')}>
              <option value="shop">{t('shop')}</option>
              <option value="individual">{t('individual')}</option>
            </select>
          </label>
          <label className="field" htmlFor="display-name">
            <span>{t('activityName')}</span>
            <input id="display-name" name="display-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required />
          </label>
          <label className="field" htmlFor="provider-city">
            <span>{t('city')}</span>
            <input id="provider-city" value={city} onChange={(event) => setCity(event.target.value)} required />
          </label>
          <label className="field" htmlFor="provider-phone">
            <span>{t('phone')}</span>
            <input id="provider-phone" value={phone} onChange={(event) => setPhone(event.target.value)} required />
          </label>
          <fieldset className="field">
            <legend>{t('services')}</legend>
            {SERVICE_IDS.map((id) => (
              <label key={id} className="check-row">
                <input type="checkbox" checked={services.includes(id)} onChange={() => toggleService(id)} />
                <span>{t(id === 'print' ? 'service_print' : id === 'install' ? 'service_install' : id === 'gifts' ? 'service_gifts' : 'service_signage')}</span>
              </label>
            ))}
          </fieldset>
        </>
      )}
      {registerMode && !providerMode && (
        <label className="field" htmlFor="company-name">
          <span>{t('companyName')}</span>
          <input id="company-name" name="organization" value={companyName} onChange={(event) => setCompanyName(event.target.value)} autoComplete="organization" required />
        </label>
      )}
      <label className="field" htmlFor="account-email">
        <span>{t('email')}</span>
        <input id="account-email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" type="email" inputMode="email" required />
      </label>
      <label className="field" htmlFor="account-password">
        <span>{t('password')}</span>
        <input id="account-password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={registerMode ? 'new-password' : 'current-password'} required />
      </label>
      {registerMode && (
        <label className="field" htmlFor="account-confirm">
          <span>{t('confirmPassword')}</span>
          <input id="account-confirm" name="confirm-password" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
        </label>
      )}
      <button type="submit" className="btn btn-primary" disabled={submitting} aria-busy={submitting}>
        {submitting ? t('saving') : providerMode ? t('createProvider') : registerMode ? t('createCompany') : t('login')}
      </button>
      {registerMode ? (
        <Link className="btn btn-secondary" to="/login">{t('haveCompany')}</Link>
      ) : (
        <>
          <Link className="btn btn-secondary" to="/register">{t('newCompany')}</Link>
          <Link className="btn btn-ghost" to="/register/provider">{t('registerProvider')}</Link>
        </>
      )}
      {error && <p className="notice err" role="alert">{error}</p>}
    </form>
  )
}
