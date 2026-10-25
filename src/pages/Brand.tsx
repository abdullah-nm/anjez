import { useEffect, useState, type DragEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { useI18n, type MessageKey } from '../i18n'
import { fetchBrandLogoObjectUrl } from '../brandLogo'
import { useStore } from '../store'
import type { CompanyBrand, Tone } from '../types'

const localNotices = new Set<string>(['localSaveFailed', 'saveBrandFailed', 'uploadLogoFailed', 'loadAccountFailed', 'ownerNameInvalid', 'companyNameInvalid', 'saveAccountFailed', 'nameSaved', 'brandSavedLocal', 'brandSavedServer', 'logoSaved'])

const tones: Tone[] = ['فاخر', 'ودّي', 'رسمي', 'حيوي']
const toneKey: Record<string, MessageKey> = {
  'فاخر': 'toneLuxury',
  'ودّي': 'toneFriendly',
  'رسمي': 'toneFormal',
  'حيوي': 'toneLively',
}

type ServerBrand = CompanyBrand & {
  description: string
  language: 'ar' | 'en'
  logoPath: string | null
}

export function Brand() {
  const { brand, saveBrand } = useStore()
  const { user, refresh } = useAuth()
  const { t, errorText } = useI18n()
  const [form, setForm] = useState<ServerBrand>({
    ...brand,
    description: '',
    language: 'ar',
    logoPath: null,
  })
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(brand.logoUrl || null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!user) return
    void (async () => {
      const response = await fetch('/api/brand', { credentials: 'include' })
      const payload = await response.json()
      if (response.ok && payload.brand) {
        setForm({
          companyName: payload.brand.companyName,
          industry: payload.brand.industry,
          contactName: payload.brand.contactName,
          email: payload.brand.email,
          phone: payload.brand.phone,
          city: payload.brand.city,
          primaryColor: payload.brand.primaryColor,
          accentColor: payload.brand.accentColor,
          slogan: payload.brand.slogan,
          tone: (payload.brand.tone as Tone) || 'فاخر',
          description: payload.brand.description,
          language: payload.brand.language,
          logoPath: payload.brand.logoPath,
        })
        const logoUrl = payload.brand.logoPath ? await fetchBrandLogoObjectUrl() : brand.logoUrl || null
        setLogoPreview(logoUrl)
        saveBrand({
          companyName: payload.brand.companyName,
          industry: payload.brand.industry,
          contactName: payload.brand.contactName,
          email: payload.brand.email,
          phone: payload.brand.phone,
          city: payload.brand.city,
          primaryColor: payload.brand.primaryColor,
          accentColor: payload.brand.accentColor,
          slogan: payload.brand.slogan,
          tone: (payload.brand.tone as Tone) || 'فاخر',
          logoUrl,
        })
      }
    })()
  }, [user])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    if (!user) {
      const ok = saveBrand(form)
      if (ok) setMessage('brandSavedLocal')
      else setError('localSaveFailed')
      return
    }
    const response = await fetch('/api/brand', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const payload = await response.json()
    if (!response.ok) {
      setError(payload.code || 'saveBrandFailed')
      return
    }
    saveBrand({ ...form, logoUrl: form.logoPath ? `/api/brand/logo?t=${Date.now()}` : brand.logoUrl })
    if (payload.user) await refresh()
    document.documentElement.lang = form.language
    document.documentElement.dir = form.language === 'ar' ? 'rtl' : 'ltr'
    setMessage('brandSavedServer')
  }

  async function uploadLogo(file: File) {
    setError(null)
    const localUrl = URL.createObjectURL(file)
    setLogoPreview(localUrl)
    saveBrand({ ...form, logoUrl: localUrl })
    const body = new FormData()
    body.append('file', file)
    const response = await fetch('/api/brand/logo', { method: 'POST', credentials: 'include', body })
    const payload = await response.json()
    if (!response.ok) {
      setError(payload.code || 'uploadLogoFailed')
      return
    }
    const logoUrl = (await fetchBrandLogoObjectUrl()) || localUrl
    setForm((current) => ({ ...current, logoPath: payload.brand.logoPath }))
    setLogoPreview(logoUrl)
    saveBrand({
      companyName: payload.brand.companyName || form.companyName,
      industry: payload.brand.industry || form.industry,
      contactName: payload.brand.contactName || form.contactName,
      email: payload.brand.email || form.email,
      phone: payload.brand.phone || form.phone,
      city: payload.brand.city || form.city,
      primaryColor: payload.brand.primaryColor || form.primaryColor,
      accentColor: payload.brand.accentColor || form.accentColor,
      slogan: payload.brand.slogan || form.slogan,
      tone: (payload.brand.tone as Tone) || form.tone,
      logoUrl,
    })
    setMessage('logoSaved')
  }

  async function deleteLogo() {
    const response = await fetch('/api/brand/logo', { method: 'DELETE', credentials: 'include' })
    if (response.ok) {
      setLogoPreview(null)
      setForm((current) => ({ ...current, logoPath: null }))
      saveBrand({ ...form, logoUrl: null })
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void uploadLogo(file)
  }

  return (
    <div className="stack form-narrow">
      {user && <AccountNames />}
    <form className="stack" onSubmit={onSubmit}>
      <div className="section-head">
        <p className="eyebrow">{t('brandEyebrow')}</p>
        <h1>{t('brandTitle')}</h1>
      </div>
      {!user && (
        <p className="notice">
          {t('brandLogin')} <Link to="/login">{t('login')}</Link>
        </p>
      )}

      {user && (
        <div
          className={`logo-drop ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p>{t('dropLogo')}</p>
          <label className="file-pick">
            <input
              className="file-native"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void uploadLogo(file)
              }}
            />
            <span className="btn btn-ghost">{t('chooseFile')}</span>
          </label>
          <div className="logo-preview-wrap">
            {logoPreview || brand.logoUrl ? (
              <img src={logoPreview || brand.logoUrl || ''} alt={t('logoAlt')} className="logo-preview" />
            ) : (
              <p className="muted">{t('noLogo')}</p>
            )}
            {(logoPreview || brand.logoUrl) && (
              <button type="button" className="btn btn-ghost" onClick={() => void deleteLogo()}>
                {t('deleteLogo')}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid-2">
        <label className="field">
          <span>{t('companyName')}</span>
          <input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('industry')}</span>
          <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('contactParty')}</span>
          <input required value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('city')}</span>
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('brandEmail')}</span>
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('phone')}</span>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('primaryColor')}</span>
          <input type="color" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('accentColor')}</span>
          <input type="color" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('copyLanguage')}</span>
          <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as 'ar' | 'en' })}>
            <option value="ar">{t('arabic')}</option>
            <option value="en">{t('english')}</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span>{t('companyDescription')}</span>
        <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <label className="field">
        <span>{t('slogan')}</span>
        <input value={form.slogan} onChange={(e) => setForm({ ...form, slogan: e.target.value })} />
      </label>
      <fieldset className="field">
        <legend>{t('toneLegend')}</legend>
        <div className="tone-row">
          {tones.map((tone) => (
            <label key={tone} className="tone">
              <input type="radio" name="tone" checked={form.tone === tone} onChange={() => setForm({ ...form, tone })} />
              {t(toneKey[tone])}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="hero-actions">
        <button type="submit" className="btn btn-primary">{t('saveBrand')}</button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setForm((current) => ({
            ...current,
            companyName: '',
            industry: '',
            contactName: '',
            email: '',
            phone: '',
            city: '',
            slogan: '',
            description: '',
            logoPath: null,
          }))}
        >
          {t('clearFields')}
        </button>
      </div>
      {message && <p className="notice ok">{localNotices.has(message) ? t(message as MessageKey) : message}</p>}
      {error && <p className="notice err">{localNotices.has(error) ? t(error as MessageKey) : errorText(error, t('saveBrandFailed'))}</p>}
    </form>
    </div>
  )
}

function AccountNames() {
  const { user, refresh } = useAuth()
  const { t, errorText } = useI18n()
  const [companyName, setCompanyName] = useState(user?.companyName ?? '')
  const [name, setName] = useState(user?.name ?? '')
  const [baseline, setBaseline] = useState({ companyName: user?.companyName ?? '', name: user?.name ?? '' })
  const [canEditCompany, setCanEditCompany] = useState(user?.role === 'admin')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    void fetch('/api/account', { credentials: 'include' })
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled || !payload?.name) return
        setCompanyName(payload.companyName || '')
        setName(payload.name || '')
        setBaseline({ companyName: payload.companyName || '', name: payload.name || '' })
        setCanEditCompany(Boolean(payload.canEditCompany))
      })
      .catch(() => {
        if (!cancelled) setError('loadAccountFailed')
      })
    return () => { cancelled = true }
  }, [user?.id])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setMessage('')
    setError('')
    if (name.trim().length < 2 || name.trim().length > 80) {
      setError('ownerNameInvalid')
      return
    }
    if (canEditCompany && (companyName.trim().length < 2 || companyName.trim().length > 80)) {
      setError('companyNameInvalid')
      return
    }
    setSaving(true)
    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(canEditCompany ? { name: name.trim(), companyName: companyName.trim() } : { name: name.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.code || 'saveAccountFailed')
      const next = { companyName: payload.user?.companyName || companyName, name: payload.user?.name || name }
      setCompanyName(next.companyName)
      setName(next.name)
      setBaseline(next)
      await refresh()
      setMessage('nameSaved')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'saveAccountFailed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack card" onSubmit={onSubmit}>
      <div className="section-head">
        <h2>{t('accountTitle')}</h2>
        <p className="muted">{t('accountHint')}</p>
      </div>
      <label className="field" htmlFor="account-company-name">
        <span>{t('companyName')}</span>
        <input id="account-company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} disabled={!canEditCompany || saving} required={canEditCompany} />
      </label>
      {!canEditCompany && <p className="muted">{t('companyNameLocked')}</p>}
      <label className="field" htmlFor="account-owner-name">
        <span>{t('ownerName')}</span>
        <input id="account-owner-name" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} required />
      </label>
      <div className="hero-actions">
        <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>{saving ? t('saving') : t('save')}</button>
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => { setCompanyName(baseline.companyName); setName(baseline.name); setMessage(''); setError('') }}>{t('cancel')}</button>
      </div>
      {message && <p className="notice ok" role="status">{localNotices.has(message) ? t(message as MessageKey) : message}</p>}
      {error && <p className="notice err" role="alert">{localNotices.has(error) ? t(error as MessageKey) : errorText(error, t('saveAccountFailed'))}</p>}
    </form>
  )
}
