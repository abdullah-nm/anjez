import { useEffect, useState, type DragEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { fetchBrandLogoObjectUrl } from '../brandLogo'
import { useStore } from '../store'
import type { CompanyBrand, Tone } from '../types'

const tones: Tone[] = ['فاخر', 'ودّي', 'رسمي', 'حيوي']

type ServerBrand = CompanyBrand & {
  description: string
  language: 'ar' | 'en'
  logoPath: string | null
}

export function Brand() {
  const { brand, saveBrand } = useStore()
  const { user, refresh } = useAuth()
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
      if (ok) setMessage('تم حفظ الهوية على هذا الجهاز فقط. سجّل الدخول لحفظها للشركة.')
      else setError('تعذر الحفظ المحلي.')
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
      setError(payload.error || 'تعذر حفظ الهوية على الخادم.')
      return
    }
    saveBrand({ ...form, logoUrl: form.logoPath ? `/api/brand/logo?t=${Date.now()}` : brand.logoUrl })
    if (payload.user) await refresh()
    document.documentElement.lang = form.language
    document.documentElement.dir = form.language === 'ar' ? 'rtl' : 'ltr'
    setMessage('تم حفظ هوية الشركة على الخادم، وستُستخدم في توليد التصاميم.')
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
      setError(payload.error || 'فشل رفع الشعار.')
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
    setMessage('حُفظ الشعار كملف، وسيظهر في استوديو التصميم.')
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
        <p className="eyebrow">هوية الشركة</p>
        <h1>ملف الشركة وعدة الهوية للطباعة والتصميم</h1>
      </div>
      {!user && (
        <p className="notice">
          الحفظ الكامل للشركة يتطلب <Link to="/login">تسجيل الدخول</Link>.
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
          <p>اسحب الشعار هنا أو اختر ملفاً (PNG / JPEG / WebP / SVG، حتى 2MB)</p>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadLogo(file)
            }}
          />
          <div className="logo-preview-wrap">
            {logoPreview || brand.logoUrl ? (
              <img src={logoPreview || brand.logoUrl || ''} alt="شعار الشركة" className="logo-preview" />
            ) : (
              <p className="muted">لا يوجد شعار محفوظ بعد.</p>
            )}
            {(logoPreview || brand.logoUrl) && (
              <button type="button" className="btn btn-ghost" onClick={() => void deleteLogo()}>
                حذف الشعار
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid-2">
        <label className="field">
          <span>اسم الشركة</span>
          <input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        </label>
        <label className="field">
          <span>القطاع</span>
          <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        </label>
        <label className="field">
          <span>جهة التواصل</span>
          <input required value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        </label>
        <label className="field">
          <span>المدينة</span>
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </label>
        <label className="field">
          <span>البريد</span>
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="field">
          <span>الهاتف</span>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </label>
        <label className="field">
          <span>اللون الأساسي</span>
          <input type="color" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
        </label>
        <label className="field">
          <span>لون الإبراز</span>
          <input type="color" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} />
        </label>
        <label className="field">
          <span>لغة الواجهة والنصوص</span>
          <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as 'ar' | 'en' })}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span>وصف الشركة</span>
        <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <label className="field">
        <span>الشعار اللفظي</span>
        <input value={form.slogan} onChange={(e) => setForm({ ...form, slogan: e.target.value })} />
      </label>
      <fieldset className="field">
        <legend>نبرة النصوص</legend>
        <div className="tone-row">
          {tones.map((tone) => (
            <label key={tone} className="tone">
              <input type="radio" name="tone" checked={form.tone === tone} onChange={() => setForm({ ...form, tone })} />
              {tone}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="hero-actions">
        <button type="submit" className="btn btn-primary">حفظ الهوية</button>
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
          مسح الحقول
        </button>
      </div>
      {message && <p className="notice ok">{message}</p>}
      {error && <p className="notice err">{error}</p>}
    </form>
    </div>
  )
}

function AccountNames() {
  const { user, refresh } = useAuth()
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
        if (!cancelled) setError('تعذر تحميل بيانات الحساب.')
      })
    return () => { cancelled = true }
  }, [user?.id])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setMessage('')
    setError('')
    if (name.trim().length < 2 || name.trim().length > 80) {
      setError('اسم صاحب الحساب بين حرفين وثمانين حرفًا.')
      return
    }
    if (canEditCompany && (companyName.trim().length < 2 || companyName.trim().length > 80)) {
      setError('اسم الشركة بين حرفين وثمانين حرفًا.')
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
      if (!response.ok) throw new Error(payload.error || 'تعذر حفظ بيانات الحساب.')
      const next = { companyName: payload.user?.companyName || companyName, name: payload.user?.name || name }
      setCompanyName(next.companyName)
      setName(next.name)
      setBaseline(next)
      await refresh()
      setMessage('حُفظ الاسم في الحساب، وسيظهر في الشريط والصفحات.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'تعذر حفظ بيانات الحساب.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack card" onSubmit={onSubmit}>
      <div className="section-head">
        <h2>بيانات الحساب</h2>
        <p className="muted">تعديل اسم الشركة واسم صاحب الحساب. لا يغيّر هذا النموذج الدور أو الصلاحيات.</p>
      </div>
      <label className="field" htmlFor="account-company-name">
        <span>اسم الشركة</span>
        <input id="account-company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} disabled={!canEditCompany || saving} required={canEditCompany} />
      </label>
      {!canEditCompany && <p className="muted">اسم الشركة يظهر للجميع في الحساب، وتعديله متاح لحساب الشركة.</p>}
      <label className="field" htmlFor="account-owner-name">
        <span>اسم صاحب الحساب</span>
        <input id="account-owner-name" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} required />
      </label>
      <div className="hero-actions">
        <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => { setCompanyName(baseline.companyName); setName(baseline.name); setMessage(''); setError('') }}>إلغاء</button>
      </div>
      {message && <p className="notice ok" role="status">{message}</p>}
      {error && <p className="notice err" role="alert">{error}</p>}
    </form>
  )
}
