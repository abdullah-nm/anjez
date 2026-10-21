import { useState, type FormEvent } from 'react'
import { defaultBrand } from '../data'
import { useStore } from '../store'
import type { CompanyBrand, Tone } from '../types'

const tones: Tone[] = ['فاخر', 'ودّي', 'رسمي', 'حيوي']

export function Brand() {
  const { brand, saveBrand } = useStore()
  const [form, setForm] = useState<CompanyBrand>(brand)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    const ok = saveBrand(form)
    if (ok) setMessage('تم حفظ هوية الشركة على هذا الجهاز.')
    else setError('تعذر حفظ الهوية. تحقق من مساحة المتصفح ثم أعد المحاولة.')
  }

  return (
    <form className="stack form-narrow" onSubmit={onSubmit}>
      <div className="section-head">
        <p className="eyebrow">هوية الشركة</p>
        <h1>بيانات تظهر في التوصيات والتصميم والطلب</h1>
      </div>

      <div className="grid-2">
        <label className="field">
          <span>اسم الشركة</span>
          <input
            required
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
        </label>
        <label className="field">
          <span>القطاع</span>
          <input
            value={form.industry}
            onChange={(e) => setForm({ ...form, industry: e.target.value })}
          />
        </label>
        <label className="field">
          <span>جهة التواصل</span>
          <input
            required
            value={form.contactName}
            onChange={(e) => setForm({ ...form, contactName: e.target.value })}
          />
        </label>
        <label className="field">
          <span>المدينة</span>
          <input
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
        </label>
        <label className="field">
          <span>البريد</span>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label className="field">
          <span>الهاتف</span>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
        <label className="field">
          <span>اللون الأساسي</span>
          <input
            type="color"
            value={form.primaryColor}
            onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
          />
        </label>
        <label className="field">
          <span>لون الإبراز</span>
          <input
            type="color"
            value={form.accentColor}
            onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
          />
        </label>
      </div>

      <label className="field">
        <span>الشعار اللفظي</span>
        <input
          value={form.slogan}
          onChange={(e) => setForm({ ...form, slogan: e.target.value })}
        />
      </label>

      <fieldset className="field">
        <legend>نبرة النصوص المقترحة</legend>
        <div className="tone-row">
          {tones.map((tone) => (
            <label key={tone} className="tone">
              <input
                type="radio"
                name="tone"
                checked={form.tone === tone}
                onChange={() => setForm({ ...form, tone })}
              />
              {tone}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="hero-actions">
        <button type="submit" className="btn btn-primary">
          حفظ الهوية
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setForm(defaultBrand)
            setMessage(null)
            setError(null)
          }}
        >
          إعادة النموذج الافتراضي
        </button>
      </div>

      {message && <p className="notice ok">{message}</p>}
      {error && <p className="notice err">{error}</p>}
    </form>
  )
}
